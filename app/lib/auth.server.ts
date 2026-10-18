import { createCookieSessionStorage, redirect } from "@remix-run/node";
import { and, asc, eq } from "drizzle-orm";
import crypto from "node:crypto";
import { promisify } from "node:util";
import { db, stores, users, type Store, type User } from "~/db.server";
import { env } from "./env.server";

const scrypt = promisify(crypto.scrypt) as (pw: string, salt: Buffer, len: number) => Promise<Buffer>;

type SessionData = { admin?: boolean; uid?: number; seen?: number };

/** Logged out after this long without activity (dashboard pings while the user is active). */
export const IDLE_MS = (Number(process.env.SESSION_IDLE_MINUTES) > 0 ? Number(process.env.SESSION_IDLE_MINUTES) : 10) * 60 * 1000;
const isIdle = (seen: number | undefined) => !seen || Date.now() - seen > IDLE_MS;

let storage: ReturnType<typeof createCookieSessionStorage<SessionData>> | null = null;
function getStorage() {
  storage ??= createCookieSessionStorage<SessionData>({
    cookie: {
      name: "__cx_session",
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 60 * 24, // rolling; idle limit is enforced by `seen`
      secrets: [env.sessionSecret],
    },
  });
  return storage;
}

// ---------- passwords ----------

export async function hashPassword(pw: string) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(pw, salt, 64);
  return `scrypt$${salt.toString("hex")}$${key.toString("hex")}`;
}

async function verifyPassword(pw: string, stored: string) {
  const [, saltHex, keyHex] = stored.split("$");
  if (!saltHex || !keyHex) return false;
  const key = await scrypt(pw, Buffer.from(saltHex, "hex"), 64);
  const want = Buffer.from(keyHex, "hex");
  return key.length === want.length && crypto.timingSafeEqual(key, want);
}

function safeEqual(a: string, b: string) {
  const ha = crypto.createHash("sha256").update(a).digest();
  const hb = crypto.createHash("sha256").update(b).digest();
  return crypto.timingSafeEqual(ha, hb);
}

// ---------- viewer ----------

export type Viewer =
  | { role: "admin"; name: string; email: string }
  | { role: "owner"; name: string; email: string; userId: number };

export function adminEmail() {
  return (process.env.ADMIN_EMAIL || "admin").trim().toLowerCase();
}

export function signupOpen() {
  return process.env.ALLOW_SIGNUP !== "false";
}

export async function getViewer(request: Request): Promise<Viewer | null> {
  const s = await getStorage().getSession(request.headers.get("Cookie"));
  if (isIdle(s.get("seen"))) return null;
  if (s.get("admin")) return { role: "admin", name: "Super admin", email: adminEmail() };
  const uid = s.get("uid");
  if (!uid) return null;
  const [u] = await db.select().from(users).where(eq(users.id, uid)).limit(1);
  if (!u || !u.active) return null;
  return { role: "owner", name: u.name, email: u.email, userId: u.id };
}

export async function requireViewer(request: Request) {
  const v = await getViewer(request);
  if (!v) {
    const to = new URL(request.url);
    const s = await getStorage().getSession(request.headers.get("Cookie"));
    const expired = (s.get("admin") || s.get("uid")) ? "expired=1&" : "";
    throw redirect(`/login?${expired}next=${encodeURIComponent(to.pathname + to.search)}`);
  }
  return v;
}

export async function requireAdmin(request: Request) {
  const v = await requireViewer(request);
  if (v.role !== "admin") throw new Response("Not allowed", { status: 403 });
  return v;
}

/** Stores the viewer can manage. */
export async function viewerStores(v: Viewer) {
  const q = db.select().from(stores).orderBy(asc(stores.name));
  return v.role === "admin" ? q : q.where(eq(stores.ownerId, v.userId));
}

/** Loads a store if the viewer may manage it, else 404. */
export async function requireStore(v: Viewer, id: string | number | undefined): Promise<Store> {
  const sid = Number(id);
  if (!Number.isInteger(sid)) throw new Response("Store not found", { status: 404 });
  const where = v.role === "admin" ? eq(stores.id, sid) : and(eq(stores.id, sid), eq(stores.ownerId, v.userId));
  const [s] = await db.select().from(stores).where(where).limit(1);
  if (!s) throw new Response("Store not found", { status: 404 });
  return s;
}

// ---------- login / signup / logout ----------

export async function login(email: string, password: string): Promise<{ admin: true } | { user: User } | null> {
  const e = email.trim().toLowerCase();
  if (e === adminEmail() && safeEqual(password, env.adminPassword)) return { admin: true };
  const [u] = await db.select().from(users).where(eq(users.email, e)).limit(1);
  if (u && u.active && (await verifyPassword(password, u.passwordHash))) return { user: u };
  return null;
}

export async function createUser(input: { name: string; email: string; password: string }) {
  const [u] = await db
    .insert(users)
    .values({ name: input.name.trim(), email: input.email.trim().toLowerCase(), passwordHash: await hashPassword(input.password) })
    .returning();
  return u;
}

export async function startSession(request: Request, who: { admin: true } | { user: User }, next = "/dashboard") {
  const st = getStorage();
  const s = await st.getSession(request.headers.get("Cookie"));
  s.unset("admin");
  s.unset("uid");
  if ("admin" in who) s.set("admin", true);
  else s.set("uid", who.user.id);
  s.set("seen", Date.now());
  const safeNext = next.startsWith("/dashboard") ? next : "/dashboard";
  return redirect(safeNext, { headers: { "Set-Cookie": await st.commitSession(s) } });
}

export async function endSession(request: Request, reason?: string) {
  const st = getStorage();
  const s = await st.getSession(request.headers.get("Cookie"));
  return redirect(reason === "idle" ? "/login?expired=1" : "/login", { headers: { "Set-Cookie": await st.destroySession(s) } });
}

/** Marks the session as active now. Returns a Set-Cookie value, or null if the session is gone or idle. */
export async function touchSession(request: Request) {
  const st = getStorage();
  const s = await st.getSession(request.headers.get("Cookie"));
  if (!(s.get("admin") || s.get("uid")) || isIdle(s.get("seen"))) return null;
  s.set("seen", Date.now());
  return st.commitSession(s);
}
