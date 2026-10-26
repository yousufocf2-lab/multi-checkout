import { createCookieSessionStorage, redirect } from "@remix-run/node";
import { and, asc, eq } from "drizzle-orm";
import crypto from "node:crypto";
import { promisify } from "node:util";
import { db, stores, teamMembers, users, type SignupProfile, type Store, type TeamMember, type User } from "~/db.server";
import { env } from "./env.server";
import type { Attribution } from "./attribution";
import { kycIncomplete } from "./kyc";
import { memberMayOpen } from "./team";

const scrypt = promisify(crypto.scrypt) as (pw: string, salt: Buffer, len: number) => Promise<Buffer>;

type SessionData = { admin?: boolean; uid?: number; tid?: number; seen?: number };

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

/** A team login acting inside the super admin's panel (staff) or a store owner's dashboard (member). */
export type Staff = { id: number; name: string; perms: string[] };
export type Member = { id: number; name: string; perms: string[]; storeIds: number[] | null };

export type Viewer =
  | { role: "admin"; name: string; email: string; staff?: Staff }
  | { role: "owner"; name: string; email: string; userId: number; kycStatus: string; kycDone: boolean; member?: Member };

/** Super admin or the store owner themself (not a team login). */
export const isPrincipal = (v: Viewer) => (v.role === "admin" ? !v.staff : !v.member);
/** Permission check: the super admin / owner can do everything; team logins need the permission. */
export function can(v: Viewer, perm: string) {
  if (v.role === "admin") return !v.staff || v.staff.perms.includes(perm);
  return !v.member || v.member.perms.includes(perm);
}

/** What we show for an owner: email, or the mobile number for mobile signups. */
export const ownerContact = (u: Pick<User, "email" | "phone">) => u.email ?? (u.phone ? `+91 ${u.phone}` : "");

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
  const tid = s.get("tid");
  if (tid) return memberViewer(tid);
  const uid = s.get("uid");
  if (!uid) return null;
  const [u] = await db.select().from(users).where(eq(users.id, uid)).limit(1);
  if (!u || !u.active) return null;
  return { role: "owner", name: u.name, email: ownerContact(u), userId: u.id, kycStatus: u.kycStatus, kycDone: !kycIncomplete(u) };
}

async function memberViewer(tid: number): Promise<Viewer | null> {
  const [m] = await db.select().from(teamMembers).where(eq(teamMembers.id, tid)).limit(1);
  if (!m || !m.active) return null;
  const contact = m.login.includes("@") ? m.login : `+91 ${m.login}`;
  if (m.scope === "platform") return { role: "admin", name: m.name, email: contact, staff: { id: m.id, name: m.name, perms: m.perms } };
  if (!m.ownerId) return null;
  const [u] = await db.select().from(users).where(eq(users.id, m.ownerId)).limit(1);
  if (!u || !u.active) return null;
  return {
    role: "owner", name: u.name, email: contact, userId: u.id, kycStatus: u.kycStatus, kycDone: !kycIncomplete(u),
    member: { id: m.id, name: m.name, perms: m.perms, storeIds: m.storeIds ?? null },
  };
}

/** Team logins may only open the dashboard pages their permissions allow (checked on every loader and action). */
function memberBlocked(v: Viewer, request: Request) {
  const path = new URL(request.url).pathname;
  if (!path.startsWith("/dashboard")) return false;
  if (v.role === "admin" && v.staff) return !memberMayOpen("platform", v.staff.perms, path);
  if (v.role === "owner" && v.member) return !memberMayOpen("owner", v.member.perms, path);
  return false;
}

export async function requireViewer(request: Request) {
  const v = await getViewer(request);
  if (!v) {
    const to = new URL(request.url);
    const s = await getStorage().getSession(request.headers.get("Cookie"));
    const expired = (s.get("admin") || s.get("uid") || s.get("tid")) ? "expired=1&" : "";
    throw redirect(`/login?${expired}next=${encodeURIComponent(to.pathname + to.search)}`);
  }
  if (memberBlocked(v, request)) throw new Response("You don't have access to this page. Ask your admin to give you access.", { status: 403 });
  return v;
}

/** Super admin only (not staff), e.g. managing the platform team's own permissions. */
export async function requireSuperAdmin(request: Request) {
  const v = await requireViewer(request);
  if (v.role !== "admin" || v.staff) throw new Response("Not allowed", { status: 403 });
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
  if (v.role === "admin") return q;
  const list = await q.where(eq(stores.ownerId, v.userId));
  const only = v.role === "owner" ? v.member?.storeIds : null;
  return only ? list.filter((s) => only.includes(s.id)) : list;
}

/** Loads a store if the viewer may manage it, else 404. */
export async function requireStore(v: Viewer, id: string | number | undefined): Promise<Store> {
  const sid = Number(id);
  if (!Number.isInteger(sid)) throw new Response("Store not found", { status: 404 });
  const where = v.role === "admin" ? eq(stores.id, sid) : and(eq(stores.id, sid), eq(stores.ownerId, v.userId));
  const [s] = await db.select().from(stores).where(where).limit(1);
  if (!s) throw new Response("Store not found", { status: 404 });
  if (v.role === "owner" && v.member?.storeIds && !v.member.storeIds.includes(s.id)) throw new Response("Store not found", { status: 404 });
  return s;
}

// ---------- login / signup / logout ----------

export type LoginResult = { admin: true } | { user: User } | { member: TeamMember };

/** Team logins are stored as a lowercase email or a 10-digit mobile number. */
export function teamLogin(raw: string) {
  const e = raw.trim().toLowerCase();
  if (e.includes("@")) return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) ? e : null;
  const phone = e.replace(/\D/g, "").replace(/^(91|0)(?=\d{10}$)/, "");
  return /^[6-9]\d{9}$/.test(phone) ? phone : null;
}

export async function login(email: string, password: string): Promise<LoginResult | null> {
  const e = email.trim().toLowerCase();
  if (e === adminEmail() && safeEqual(password, env.adminPassword)) return { admin: true };
  // Owners can use their email or mobile number with a password
  const phone = e.replace(/\D/g, "").replace(/^(91|0)(?=\d{10}$)/, "");
  const [u] = await db.select().from(users).where(e.includes("@") ? eq(users.email, e) : eq(users.phone, phone)).limit(1);
  if (u && u.active && u.passwordHash && (await verifyPassword(password, u.passwordHash))) return { user: u };
  // Team members (Growpefy staff or a store's employees)
  const key = teamLogin(email);
  if (key) {
    const [m] = await db.select().from(teamMembers).where(eq(teamMembers.login, key)).limit(1);
    if (m && m.active && (await verifyPassword(password, m.passwordHash))) {
      await db.update(teamMembers).set({ lastLoginAt: new Date() }).where(eq(teamMembers.id, m.id));
      return { member: m };
    }
  }
  return null;
}

/** True when this email / mobile is already used by an owner, a team member or the admin. */
export async function loginTaken(key: string) {
  if (key === adminEmail()) return true;
  const [u] = await db.select({ id: users.id }).from(users).where(key.includes("@") ? eq(users.email, key) : eq(users.phone, key)).limit(1);
  if (u) return true;
  const [m] = await db.select({ id: teamMembers.id }).from(teamMembers).where(eq(teamMembers.login, key)).limit(1);
  return Boolean(m);
}

export async function verifyMemberPassword(id: number, password: string) {
  const [m] = await db.select().from(teamMembers).where(eq(teamMembers.id, id)).limit(1);
  return Boolean(m && (await verifyPassword(password, m.passwordHash)));
}

/** Signed, short-lived proof that the owner verified an OTP to reset the password. Stops working once the password changes. */
export function resetTicket(u: Pick<User, "id" | "passwordHash">, exp = Date.now() + 15 * 60_000) {
  const body = `${u.id}.${exp}`;
  const sig = crypto.createHmac("sha256", env.sessionSecret).update(`reset:${body}:${u.passwordHash ?? ""}`).digest("base64url");
  return `${body}.${sig}`;
}
export async function userFromResetTicket(ticket: string) {
  const [id, exp, sig] = ticket.split(".");
  if (!id || !exp || !sig || Number(exp) < Date.now()) return null;
  const [u] = await db.select().from(users).where(eq(users.id, Number(id))).limit(1);
  if (!u || !u.active) return null;
  const good = resetTicket(u, Number(exp)).split(".")[2];
  return good.length === sig.length && crypto.timingSafeEqual(Buffer.from(good), Buffer.from(sig)) ? u : null;
}

export async function setPassword(userId: number, password: string) {
  await db.update(users).set({ passwordHash: await hashPassword(password) }).where(eq(users.id, userId));
}

/** Finds an owner by the mobile number or email they log in with. */
export async function findOwner(channel: "phone" | "email", target: string) {
  const [u] = await db.select().from(users).where(channel === "phone" ? eq(users.phone, target) : eq(users.email, target)).limit(1);
  return u ?? null;
}

/** OTP signup: brand name + mobile or email. Password is optional (null). KYC comes next. */
export async function createOwner(input: { brandName: string; channel: "phone" | "email"; target: string; attribution?: Attribution | null; signup?: SignupProfile | null }) {
  const [u] = await db
    .insert(users)
    .values({
      name: input.brandName.trim().slice(0, 120),
      email: input.channel === "email" ? input.target : null,
      phone: input.channel === "phone" ? input.target : null,
      signupWith: input.channel,
      passwordHash: null,
      kyc: {
        brandName: input.brandName.trim().slice(0, 120),
        ...(input.channel === "email" ? { email: input.target } : { phone: input.target, whatsapp: input.target }),
        ...(input.signup?.websites?.[0] ? { website: input.signup.websites[0].url } : {}),
      },
      kycStatus: "pending",
      attribution: input.attribution ?? null,
      signup: input.signup ?? null,
    })
    .returning();
  return u;
}

/** Owners must finish KYC before using the dashboard. */
export function needsKyc(v: Viewer) {
  return v.role === "owner" && !v.member && !v.kycDone;
}

export async function createUser(input: { name: string; email: string; password: string }) {
  const [u] = await db
    .insert(users)
    .values({ name: input.name.trim(), email: input.email.trim().toLowerCase(), passwordHash: await hashPassword(input.password) })
    .returning();
  return u;
}

export async function startSession(request: Request, who: LoginResult, next = "/dashboard") {
  const st = getStorage();
  const s = await st.getSession(request.headers.get("Cookie"));
  s.unset("admin");
  s.unset("uid");
  s.unset("tid");
  if ("admin" in who) s.set("admin", true);
  else if ("member" in who) s.set("tid", who.member.id);
  else s.set("uid", who.user.id);
  s.set("seen", Date.now());
  const pending = "user" in who && kycIncomplete(who.user);
  const safeNext = pending ? "/onboarding" : next.startsWith("/dashboard") ? next : "/dashboard";
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
  if (!(s.get("admin") || s.get("uid") || s.get("tid")) || isIdle(s.get("seen"))) return null;
  s.set("seen", Date.now());
  return st.commitSession(s);
}
