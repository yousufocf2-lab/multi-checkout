import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { recordInbound, updateStatus } from "~/lib/inbox.server";
import { handleWhatsappReply, messaging, verifyMetaSignature } from "~/lib/rto.server";

/**
 * Meta WhatsApp Cloud API webhook.
 * GET: Meta checks the callback URL with the verify token. POST: messages (Confirm / Cancel button replies).
 */
export async function loader({ request }: LoaderFunctionArgs) {
  const u = new URL(request.url);
  const m = await messaging();
  if (u.searchParams.get("hub.mode") === "subscribe" && m.waVerifyToken && u.searchParams.get("hub.verify_token") === m.waVerifyToken) {
    return new Response(u.searchParams.get("hub.challenge") ?? "", { headers: { "Content-Type": "text/plain" } });
  }
  return new Response("Forbidden", { status: 403 });
}

type Payload = { entry?: { changes?: { field?: string; value?: {
  messages?: (Parameters<typeof handleWhatsappReply>[0] & Parameters<typeof recordInbound>[0])[];
  contacts?: { wa_id?: string; profile?: { name?: string } }[];
  statuses?: { id?: string; status?: string }[];
} }[] }[] };

export async function action({ request }: ActionFunctionArgs) {
  const raw = await request.text();
  const m = await messaging();
  // Without the app secret anyone could post fake replies, so it's required
  if (!m.waAppSecret || !verifyMetaSignature(raw, request.headers.get("x-hub-signature-256"), m.waAppSecret)) {
    console.warn("[whatsapp] webhook signature missing or wrong");
    return new Response("Bad signature", { status: 401 });
  }
  let data: Payload;
  try { data = JSON.parse(raw) as Payload; } catch { return new Response("ok"); }
  for (const e of data.entry ?? []) {
    for (const c of e.changes ?? []) {
      for (const st of c.value?.statuses ?? []) {
        try { await updateStatus(st.id, st.status); } catch (err) { console.error("[whatsapp] status:", err instanceof Error ? err.message : err); }
      }
      for (const msg of c.value?.messages ?? []) {
        const name = c.value?.contacts?.find((x) => x.wa_id === msg.from)?.profile?.name;
        try { await recordInbound(msg, name); } catch (err) { console.error("[inbox] inbound:", err instanceof Error ? err.message : err); }
        try { await handleWhatsappReply(msg); } catch (err) { console.error("[whatsapp] reply:", err instanceof Error ? err.message : err); }
      }
    }
  }
  // Always 200 so Meta doesn't keep retrying
  return new Response("ok");
}
