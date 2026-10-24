// Server-to-server notifications from payment gateways. The body only tells us which payment to re-check;
// the result always comes from the gateway's own status API.
import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { ADAPTERS, handleWebhook } from "~/lib/gateways/index.server";

export const loader = () => json({ ok: true, hint: "Payment gateway webhooks POST here" });

export async function action({ request, params }: ActionFunctionArgs) {
  const gateway = String(params.gateway);
  if (!ADAPTERS[gateway]) return json({ ok: false, error: "Unknown gateway" }, { status: 404 });
  let body: Record<string, unknown> = {};
  try {
    const type = request.headers.get("content-type") ?? "";
    if (type.includes("application/json")) body = (await request.json()) as Record<string, unknown>;
    else (await request.formData()).forEach((v, k) => { if (typeof v === "string") body[k] = v; });
  } catch {
    return json({ ok: false, error: "unreadable body" }, { status: 400 });
  }
  try {
    const r = await handleWebhook(gateway, body);
    return json({ ok: true, ...r });
  } catch (e) {
    console.error(`[${gateway} webhook]`, e instanceof Error ? e.message : e);
    return json({ ok: true });
  }
}
