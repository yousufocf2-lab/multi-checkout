// WhatsApp inbox: conversations Growpefy started for an order, customer replies, and store replies.
// Rules:
//  - A conversation exists only after Growpefy sent an order message to that number for that store.
//    Messages from any other number are ignored, and nobody can start a chat with a number they type in.
//  - Each conversation belongs to one store; stores only ever see their own.
//  - Store can reply only after the customer has replied. Within 24 h of the customer's last message:
//    free text (₹0.07 from the wallet). After that: the follow-up template only (₹1.50).
import { and, desc, eq, sql } from "drizzle-orm";
import { db, waConversations, waMessages, type Store } from "~/db.server";
import { messaging, waApproved, waReady } from "./rto.server";
import { chargeUsage } from "./wallet.server";

export const WINDOW_MS = 24 * 3600_000;

export const windowOpen = (lastInboundAt: Date | string | null | undefined) =>
  Boolean(lastInboundAt && Date.now() - new Date(lastInboundAt).getTime() < WINDOW_MS);

/** Logs a message Growpefy sent (order template, auto reply…). Creates the conversation the first time. */
export async function logOutbound(storeId: number, phone: string, m: { kind: string; body: string; waMessageId?: string | null; orderId?: string | null; name?: string; sentBy?: string; chargedPaise?: number }) {
  const [conv] = await db.insert(waConversations).values({ storeId, phone, name: m.name ?? "", lastMessageAt: new Date() })
    .onConflictDoUpdate({
      target: [waConversations.storeId, waConversations.phone],
      set: { lastMessageAt: new Date(), ...(m.name ? { name: sql`case when ${waConversations.name} = '' then ${m.name} else ${waConversations.name} end` } : {}) },
    }).returning();
  await db.insert(waMessages).values({
    conversationId: conv.id, storeId, direction: "out", kind: m.kind, body: m.body.slice(0, 4000),
    waMessageId: m.waMessageId ?? null, status: m.waMessageId ? "sent" : null, orderId: m.orderId ?? null, sentBy: m.sentBy ?? null, chargedPaise: m.chargedPaise ?? 0,
  });
  return conv;
}

type InboundMessage = {
  from?: string; id?: string; type?: string;
  context?: { id?: string };
  text?: { body?: string };
  button?: { text?: string };
  interactive?: { button_reply?: { title?: string }; list_reply?: { title?: string } };
  image?: { caption?: string }; video?: { caption?: string }; document?: { filename?: string; caption?: string };
  audio?: unknown; sticker?: unknown; location?: { name?: string; address?: string };
};

function inboundBody(msg: InboundMessage) {
  switch (msg.type) {
    case "text": return { kind: "text", body: msg.text?.body ?? "" };
    case "button": return { kind: "button", body: msg.button?.text ?? "" };
    case "interactive": return { kind: "button", body: msg.interactive?.button_reply?.title ?? msg.interactive?.list_reply?.title ?? "" };
    case "image": return { kind: "media", body: `📷 Photo${msg.image?.caption ? `: ${msg.image.caption}` : ""}` };
    case "video": return { kind: "media", body: `🎥 Video${msg.video?.caption ? `: ${msg.video.caption}` : ""}` };
    case "document": return { kind: "media", body: `📄 ${msg.document?.filename ?? "Document"}` };
    case "audio": return { kind: "media", body: "🎤 Voice message" };
    case "sticker": return { kind: "media", body: "Sticker" };
    case "location": return { kind: "media", body: `📍 ${msg.location?.name ?? msg.location?.address ?? "Location"}` };
    default: return { kind: "media", body: "Message (open WhatsApp to view)" };
  }
}

/**
 * Saves a customer message to the right store's conversation:
 * the store whose message they replied to, else the store that messaged this number most recently.
 * Numbers Growpefy never messaged are ignored.
 */
export async function recordInbound(msg: InboundMessage, profileName?: string) {
  const phone = (msg.from ?? "").replace(/\D/g, "").replace(/^91(?=\d{10}$)/, "");
  if (!/^\d{10}$/.test(phone) || !msg.id) return null;
  const [dupe] = await db.select({ id: waMessages.id }).from(waMessages).where(eq(waMessages.waMessageId, msg.id)).limit(1);
  if (dupe) return null; // Meta retries webhooks

  let convId: number | null = null;
  if (msg.context?.id) {
    const [replied] = await db.select({ conv: waMessages.conversationId }).from(waMessages).where(eq(waMessages.waMessageId, msg.context.id)).limit(1);
    convId = replied?.conv ?? null;
  }
  const [conv] = convId
    ? await db.select().from(waConversations).where(and(eq(waConversations.id, convId), eq(waConversations.phone, phone))).limit(1)
    : await db.select().from(waConversations).where(eq(waConversations.phone, phone)).orderBy(desc(waConversations.lastMessageAt)).limit(1);
  if (!conv) return null;

  const { kind, body } = inboundBody(msg);
  await db.insert(waMessages).values({ conversationId: conv.id, storeId: conv.storeId, direction: "in", kind, body: body.slice(0, 4000) || "(empty)", waMessageId: msg.id });
  await db.update(waConversations).set({
    lastInboundAt: new Date(), lastMessageAt: new Date(), unread: sql`${waConversations.unread} + 1`,
    ...(profileName && !conv.name ? { name: profileName.slice(0, 80) } : {}),
  }).where(eq(waConversations.id, conv.id));
  return conv;
}

const RANK: Record<string, number> = { sent: 1, delivered: 2, read: 3, failed: 4 };
/** Delivery / read ticks from Meta's status webhooks. */
export async function updateStatus(waMessageId: string | undefined, status: string | undefined) {
  if (!waMessageId || !status || !RANK[status]) return;
  const [m] = await db.select({ id: waMessages.id, status: waMessages.status }).from(waMessages).where(eq(waMessages.waMessageId, waMessageId)).limit(1);
  if (!m || (RANK[m.status ?? ""] ?? 0) >= RANK[status]) return;
  await db.update(waMessages).set({ status }).where(eq(waMessages.id, m.id));
}

/** Loads a conversation only if it belongs to this store. */
export async function storeConversation(storeId: number, id: number) {
  const [c] = await db.select().from(waConversations).where(and(eq(waConversations.id, id), eq(waConversations.storeId, storeId))).limit(1);
  return c ?? null;
}

const NOT_VERIFIED = "WhatsApp messages are off until Growpefy verifies your store. Send your details from WhatsApp settings.";

type SendResult = { ok: true } | { ok: false; error: string };

async function postToMeta(body: Record<string, unknown>) {
  const m = await messaging();
  const res = await fetch(`https://graph.facebook.com/v21.0/${m.waPhoneNumberId}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${m.waToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ messaging_product: "whatsapp", ...body }),
    signal: AbortSignal.timeout(10_000),
  });
  const j = (await res.json().catch(() => ({}))) as { messages?: { id: string }[]; error?: { message?: string; code?: number } };
  if (!res.ok || !j.messages?.length) return { id: null, error: j.error?.message ?? `WhatsApp error ${res.status}`, code: j.error?.code };
  return { id: j.messages[0].id, error: null };
}

/** Store's free-text reply. Only inside the 24-hour window after the customer's last message. */
export async function sendReply(store: Store, convId: number, text: string, by: string): Promise<SendResult> {
  const conv = await storeConversation(store.id, convId);
  if (!conv) return { ok: false, error: "Conversation not found" };
  if (!waApproved(store)) return { ok: false, error: NOT_VERIFIED };
  const body = text.trim().slice(0, 1000);
  if (!body) return { ok: false, error: "Type a message" };
  if (!conv.lastInboundAt) return { ok: false, error: "You can reply once the customer messages you." };
  if (!windowOpen(conv.lastInboundAt)) return { ok: false, error: "More than 24 hours since the customer's last message. Send the follow-up instead." };
  if (!waReady(await messaging())) return { ok: false, error: "WhatsApp isn't set up yet." };
  const r = await postToMeta({ to: `91${conv.phone}`, type: "text", text: { body, preview_url: false } });
  if (!r.id) return { ok: false, error: r.error ?? "Couldn't send" };
  const tx = await chargeUsage(store.id, "wa_reply", `wa:${r.id}`, `Inbox reply to +91 ${conv.phone.slice(0, 2)}xxxxxx${conv.phone.slice(-2)}`).catch(() => null);
  await logOutbound(store.id, conv.phone, { kind: "text", body, waMessageId: r.id, sentBy: by, chargedPaise: tx ? Math.abs(tx.entry.amountPaise) : 0 });
  return { ok: true };
}

/** After the 24-hour window: the approved follow-up template, asking the customer to reply. */
export async function sendFollowup(store: Store, convId: number, by: string): Promise<SendResult> {
  const conv = await storeConversation(store.id, convId);
  if (!conv) return { ok: false, error: "Conversation not found" };
  if (!waApproved(store)) return { ok: false, error: NOT_VERIFIED };
  if (!conv.lastInboundAt) return { ok: false, error: "You can message once the customer has replied at least once." };
  if (windowOpen(conv.lastInboundAt)) return { ok: false, error: "The chat is open. Just type your reply." };
  const m = await messaging();
  if (!waReady(m) || !m.waFollowupTemplate) return { ok: false, error: "The follow-up template isn't set up yet." };
  const r = await postToMeta({
    to: `91${conv.phone}`, type: "template",
    template: { name: m.waFollowupTemplate, language: { code: m.waLang || "en" }, components: [{ type: "body", parameters: [{ type: "text", text: conv.name || "there" }, { type: "text", text: store.name }] }] },
  });
  if (!r.id) return { ok: false, error: r.error ?? "Couldn't send" };
  const tx = await chargeUsage(store.id, "wa_followup", `wa:${r.id}`, `Inbox follow-up to +91 ${conv.phone.slice(0, 2)}xxxxxx${conv.phone.slice(-2)}`).catch(() => null);
  await logOutbound(store.id, conv.phone, { kind: "followup", body: `Follow-up sent: ${store.name} asked the customer to reply`, waMessageId: r.id, sentBy: by, chargedPaise: tx ? Math.abs(tx.entry.amountPaise) : 0 });
  return { ok: true };
}

export async function unreadCount(storeId: number) {
  const [r] = await db.select({ n: sql<number>`coalesce(sum(${waConversations.unread}), 0)::int` }).from(waConversations).where(eq(waConversations.storeId, storeId));
  return Number(r?.n ?? 0);
}
