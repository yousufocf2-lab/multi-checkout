// Face ID / fingerprint login (passkeys): options for the browser, then the check that starts the session.
import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { sessionCookie } from "~/lib/auth.server";
import { requireAppHost } from "~/lib/host.server";
import { finishLogin, loginOptions } from "~/lib/passkeys.server";

export const loader = () => json({ error: "POST only" }, { status: 405 });

export async function action({ request }: ActionFunctionArgs) {
  requireAppHost(request);
  const body = (await request.json().catch(() => ({}))) as { step?: string; response?: unknown; next?: string };
  if (body.step === "options") return json(await loginOptions());
  try {
    const who = await finishLogin(body.response as Parameters<typeof finishLogin>[0]);
    const next = typeof body.next === "string" && body.next.startsWith("/dashboard") ? body.next : "/dashboard";
    const { cookie, to } = await sessionCookie(request, who, next);
    return json({ to }, { headers: { "Set-Cookie": cookie } });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "Couldn't log in with this device." }, { status: 400 });
  }
}
