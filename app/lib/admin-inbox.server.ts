// Growpefy's own WhatsApp inbox (super admin only): leads, signups, store owners and anyone else who messages
// Growpefy's WhatsApp number about Growpefy itself. Store order chats stay in each store's inbox (inbox.server.ts).
// Replies are free text inside WhatsApp's 24-hour window, after that the approved follow-up template.
import { desc, eq, sql } from "drizzle-orm";
import { adminWaConversations, adminWaMessages, callbackRequests, db, metaLeads, users } from "~/db.server";
import { messaging, waReady } from "./rto.server";

export const WINDOW_MS = 24 * 3600_000;
export const windowOpen = (lastInboundAt: Date | string | null | undefined) =>
  Boolean(lastInboundAt && Date.now() - new Date(lastInboundAt).getTime() < WINDOW_MS);

const phone10 = (p: string) => p.replace(/\D/g, "").replace(/^91(?=\d{10}$)/, "").replace(/^0(?=\d{10}$)/, "");

/** Logs something Growpefy sent from its number (welcome, payment entry, reply…). Creates the conversation. */
export async function logAdminOutbound(phone: string, m: { kind: string; body: string; waMessageId?: string | null; name?: string; sentBy?: string }) {
  const p = phone10(phone);
  if (!/^\d{10}$/.test(p)) return null;
  try {
    const [conv] = await db.insert(adminWaConversations).values({ phone: p, name: m.name ?? "", lastMessageAt: new Date() })
      .onConflictDoUpdate({
        target: adminWaConversations.phone,
        set: { lastMessageAt: new Date(), ...(m.name ? { name: sql`case when ${adminWaConversations.name} = '' then ${m.name} else ${adminWaConversations.name} end` } : {}) },
      }).returning();
    await db.insert(adminWaMessages).values({
      conversationId: conv.id, direction: "out", kind: m.kind, body: m.body.slice(0, 4000),
      waMessageId: m.waMessageId ?? null, status: m.waMessageId ? "sent" : null, sentBy: m.sentBy ?? null,
    });
    return conv;
  } catch (e) {
    console.error("[admin-inbox] log:", e instanceof Error ? e.message : e);
    return null;
  }
}

/** Saves an incoming message to Growpefy's inbox (called when it isn't a reply to a store's order chat). */
export async function recordAdminInbound(phone: string, waMessageId: string, kind: string, body: string, profileName?: string) {
  const [dupe] = await db.select({ id: adminWaMessages.id }).from(adminWaMessages).where(eq(adminWaMessages.waMessageId, waMessageId)).limit(1);
  if (dupe) return null;
  const [conv] = await db.insert(adminWaConversations).values({ phone, name: profileName?.slice(0, 80) ?? "", lastMessageAt: new Date(), lastInboundAt: new Date(), unread: 1 })
    .onConflictDoUpdate({
      target: adminWaConversations.phone,
      set: {
        lastMessageAt: new Date(), lastInboundAt: new Date(), unread: sql`${adminWaConversations.unread} + 1`,
        ...(profileName ? { name: sql`case when ${adminWaConversations.name} = '' then ${profileName.slice(0, 80)} else ${adminWaConversations.name} end` } : {}),
      },
    }).returning();
  await db.insert(adminWaMessages).values({ conversationId: conv.id, direction: "in", kind, body: body.slice(0, 4000) || "(empty)", waMessageId });
  return conv;
}

/** Did Growpefy's own inbox send this WhatsApp message id? (for routing replies) */
export async function adminMessageConv(waMessageId: string) {
  const [m] = await db.select({ conv: adminWaMessages.conversationId }).from(adminWaMessages).where(eq(adminWaMessages.waMessageId, waMessageId)).limit(1);
  return m?.conv ?? null;
}

export async function adminConvByPhone(phone: string) {
  const [c] = await db.select().from(adminWaConversations).where(eq(adminWaConversations.phone, phone)).limit(1);
  return c ?? null;
}

const RANK: Record<string, number> = { sent: 1, delivered: 2, read: 3, failed: 4 };
export async function updateAdminStatus(waMessageId: string, status: string) {
  if (!RANK[status]) return;
  const [m] = await db.select({ id: adminWaMessages.id, status: adminWaMessages.status }).from(adminWaMessages).where(eq(adminWaMessages.waMessageId, waMessageId)).limit(1);
  if (!m || (RANK[m.status ?? ""] ?? 0) >= RANK[status]) return;
  await db.update(adminWaMessages).set({ status }).where(eq(adminWaMessages.id, m.id));
}

export async function adminUnread() {
  const [r] = await db.select({ n: sql<number>`coalesce(sum(${adminWaConversations.unread}), 0)::int` }).from(adminWaConversations);
  return Number(r?.n ?? 0);
}

/** Who this number is to Growpefy: Meta lead, website callback or a signed-up account (newest first). */
export async function whoIs(phones: string[]) {
  const out = new Map<string, { label: string; href: string; name: string }>();
  if (!phones.length) return out;
  const list = sql.join(phones.map((p) => sql`${p}`), sql`, `);
  const [u, c, m] = await Promise.all([
    db.select({ id: users.id, phone: users.phone, name: users.name }).from(users).where(sql`${users.phone} in (${list})`),
    db.select({ id: callbackRequests.id, phone: callbackRequests.phone, name: callbackRequests.name }).from(callbackRequests).where(sql`${callbackRequests.phone} in (${list})`).orderBy(desc(callbackRequests.createdAt)),
    db.select({ id: metaLeads.id, phone: metaLeads.phone, name: metaLeads.name }).from(metaLeads).where(sql`${metaLeads.phone} in (${list})`).orderBy(desc(metaLeads.createdAt)),
  ]);
  for (const x of m) if (x.phone && !out.has(x.phone)) out.set(x.phone, { label: "Meta lead", href: `/dashboard/leads/meta-${x.id}`, name: x.name ?? "" });
  for (const x of c) if (!out.has(x.phone)) out.set(x.phone, { label: "Website callback", href: `/dashboard/leads/callback-${x.id}`, name: x.name });
  for (const x of u) if (x.phone) out.set(x.phone, { label: "Growpefy account", href: `/dashboard/leads/signup-${x.id}`, name: x.name });
  return out;
}

type SendResult = { ok: true } | { ok: false; error: string };

async function postToMeta(body: Record<string, unknown>) {
  const m = await messaging();
  const res = await fetch(`https://graph.facebook.com/v21.0/${m.waPhoneNumberId}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${m.waToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ messaging_product: "whatsapp", ...body }),
    signal: AbortSignal.timeout(10_000),
  }).catch(() => null);
  if (!res) return { id: null, error: "Couldn't reach WhatsApp" };
  const j = (await res.json().catch(() => ({}))) as { messages?: { id: string }[]; error?: { message?: string } };
  if (!res.ok || !j.messages?.length) return { id: null, error: j.error?.message ?? `WhatsApp error ${res.status}` };
  return { id: j.messages[0].id, error: null };
}

async function conv(id: number) {
  const [c] = await db.select().from(adminWaConversations).where(eq(adminWaConversations.id, id)).limit(1);
  return c ?? null;
}

/** Free-text reply from Growpefy, inside the 24-hour window after the person's last message. */
export async function adminReply(convId: number, text: string, by: string): Promise<SendResult> {
  const c = await conv(convId);
  if (!c) return { ok: false, error: "Conversation not found" };
  const body = text.trim().slice(0, 1000);
  if (!body) return { ok: false, error: "Type a message" };
  if (!c.lastInboundAt) return { ok: false, error: "You can reply once they message you." };
  if (!windowOpen(c.lastInboundAt)) return { ok: false, error: "More than 24 hours since their last message. Send the follow-up instead." };
  if (!waReady(await messaging())) return { ok: false, error: "WhatsApp isn't set up yet." };
  const r = await postToMeta({ to: `91${c.phone}`, type: "text", text: { body, preview_url: true } });
  if (!r.id) return { ok: false, error: r.error ?? "Couldn't send" };
  await logAdminOutbound(c.phone, { kind: "text", body, waMessageId: r.id, sentBy: by });
  return { ok: true };
}

/** After the 24-hour window: the approved follow-up template ({{1}} name, {{2}} "Growpefy"), asking them to reply. */
export async function adminFollowup(convId: number, by: string): Promise<SendResult> {
  const c = await conv(convId);
  if (!c) return { ok: false, error: "Conversation not found" };
  if (c.lastInboundAt && windowOpen(c.lastInboundAt)) return { ok: false, error: "The chat is open. Just type your reply." };
  const m = await messaging();
  if (!waReady(m) || !m.waFollowupTemplate) return { ok: false, error: "The follow-up template isn't set up yet (Wallets → Messaging)." };
  const r = await postToMeta({
    to: `91${c.phone}`, type: "template",
    template: { name: m.waFollowupTemplate, language: { code: m.waLang || "en" }, components: [{ type: "body", parameters: [{ type: "text", text: (c.name || "there").slice(0, 60) }, { type: "text", text: "Growpefy" }] }] },
  });
  if (!r.id) return { ok: false, error: r.error ?? "Couldn't send" };
  await logAdminOutbound(c.phone, { kind: "followup", body: "Follow-up sent: Growpefy asked them to reply", waMessageId: r.id, sentBy: by });
  return { ok: true };
}
