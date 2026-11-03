// Turning on Face ID / fingerprint login for the logged-in person (and removing it).
import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { requireViewer } from "~/lib/auth.server";
import { finishRegistration, registrationOptions, removePasskey } from "~/lib/passkeys.server";

export const loader = () => json({ error: "POST only" }, { status: 405 });

export async function action({ request }: ActionFunctionArgs) {
  const v = await requireViewer(request);
  const body = (await request.json().catch(() => ({}))) as { step?: string; response?: unknown; device?: string; id?: number };
  try {
    if (body.step === "options") return json(await registrationOptions(v));
    if (body.step === "remove") { await removePasskey(v, Number(body.id)); return json({ ok: true }); }
    await finishRegistration(v, body.response as Parameters<typeof finishRegistration>[1], String(body.device ?? ""));
    return json({ ok: true });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "Couldn't set this up." }, { status: 400 });
  }
}
