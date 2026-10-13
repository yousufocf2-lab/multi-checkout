import { createCookieSessionStorage, redirect } from "@remix-run/node";
import crypto from "node:crypto";
import { env } from "./env.server";

type AdminSession = { admin: boolean };
let storage: ReturnType<typeof createCookieSessionStorage<AdminSession>> | null = null;
function getStorage() {
  storage ??= createCookieSessionStorage<AdminSession>({
    cookie: {
      name: "__cx_admin",
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 60 * 24 * 14,
      secrets: [env.sessionSecret],
    },
  });
  return storage;
}

export async function requireAdmin(request: Request) {
  const s = await getStorage().getSession(request.headers.get("Cookie"));
  if (s.get("admin") !== true) throw redirect("/admin-login");
}

export function checkPassword(input: string) {
  const a = Buffer.from(crypto.createHash("sha256").update(input).digest("hex"));
  const b = Buffer.from(crypto.createHash("sha256").update(env.adminPassword).digest("hex"));
  return crypto.timingSafeEqual(a, b);
}

export async function loginRedirect(request: Request) {
  const st = getStorage();
  const s = await st.getSession(request.headers.get("Cookie"));
  s.set("admin", true);
  return redirect("/admin", { headers: { "Set-Cookie": await st.commitSession(s) } });
}

export async function logoutRedirect(request: Request) {
  const st = getStorage();
  const s = await st.getSession(request.headers.get("Cookie"));
  return redirect("/admin-login", { headers: { "Set-Cookie": await st.destroySession(s) } });
}
