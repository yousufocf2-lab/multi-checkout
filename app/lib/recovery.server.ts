// Abandoned checkout recovery on WhatsApp (Growpefy's number). Only for stores the admin verified.
// The store chooses 1 or 2 messages and when they go; each message costs the wallet's waRecovery rate (₹2.50).
import { and, desc, eq, gt, isNotNull, lt, sql } from "drizzle-orm";
import { checkoutSessions, db, orders, stores, type Store } from "~/db.server";
import { logOutbound } from "./inbox.server";
import { messaging, waApproved } from "./rto.server";
import { canUse, chargeUsage } from "./wallet.server";
import { resolveRecovery } from "./whatsapp-gate";

const LINK_DAYS = 7; // recovery links work for 7 days

type SessionRow = typeof checkoutSessions.$inferSelect;

const itemsText = (s: SessionRow) => {
  const c = s.cartSnapshot ?? [];
  if (!c.length) return "your items";
  const first = c[0].title.slice(0, 60);
  return c.length > 1 ? `${first} + ${c.length - 1} more` : first;
};

/** Sessions of a store that are due for their next recovery message. */
export async function dueSessions(store: Store, now = new Date()) {
  const { delays } = resolveRecovery(store.recovery);
  const out: { s: SessionRow; step: number }[] = [];
  for (let step = 0; step < delays.length; step++) {
    const rows = await db.select().from(checkoutSessions).where(and(
      eq(checkoutSessions.storeId, store.id),
      eq(checkoutSessions.recoverySent, step),
      isNotNull(checkoutSessions.cartSnapshot),
      sql`length(coalesce(${checkoutSessions.customer}->>'phone', '')) = 10`,
      gt(checkoutSessions.createdAt, new Date(now.getTime() - LINK_DAYS * 86400_000)),
      lt(checkoutSessions.updatedAt, new Date(now.getTime() - delays[step] * 60_000)),
      // a failed send waits 30 minutes before trying again
      sql`(${checkoutSessions.recoveryAt} is null or ${checkoutSessions.recoveryAt} < ${new Date(now.getTime() - 30 * 60_000).toISOString()}::timestamptz)`,
      // no order from this checkout
      sql`not exists (select 1 from ${orders} o where o.session_id = ${checkoutSessions.id} and o.status in ('paid','cod_placed'))`,
      // the customer didn't order on this store since starting this checkout
      sql`not exists (select 1 from ${orders} o where o.store_id = ${checkoutSessions.storeId} and o.customer->>'phone' = ${checkoutSessions.customer}->>'phone' and o.created_at > ${checkoutSessions.createdAt} and o.status in ('paid','cod_placed'))`,
      // only the customer's latest checkout on this store gets messages
      sql`not exists (select 1 from ${checkoutSessions} n where n.store_id = ${checkoutSessions.storeId} and n.customer->>'phone' = ${checkoutSessions.customer}->>'phone' and n.created_at > ${checkoutSessions.createdAt})`,
    )).orderBy(desc(checkoutSessions.updatedAt)).limit(100);
    for (const s of rows) out.push({ s, step });
  }
  return out;
}

/** Link in the message: https://<CHECKOUT_DOMAIN>/r/<session> (a fixed base, so one Meta template works for every store). */
export const recoveryBase = () => {
  const root = (process.env.CHECKOUT_DOMAIN ?? "").trim().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  return root ? `https://${root}` : (process.env.APP_URL ?? "").replace(/\/+$/, "");
};

/** Sends one recovery message. Never throws. */
export async function sendRecovery(store: Store, s: SessionRow, step: number) {
  try {
    const m = await messaging();
    if (!m.waPhoneNumberId || !m.waToken || !m.waRecoveryTemplate) return false;
    if (!waApproved(store) || !(await canUse(store.id, "wa_recovery"))) return false;
    // claim this step first so two runs never send the same message twice
    const [claimed] = await db.update(checkoutSessions).set({ recoveryAt: new Date() })
      .where(and(eq(checkoutSessions.id, s.id), eq(checkoutSessions.recoverySent, step),
        sql`(${checkoutSessions.recoveryAt} is null or ${checkoutSessions.recoveryAt} < now() - interval '30 minutes')`))
      .returning({ id: checkoutSessions.id });
    if (!claimed) return false;
    const c = s.customer ?? {};
    const phone = String(c.phone);
    const res = await fetch(`https://graph.facebook.com/v21.0/${m.waPhoneNumberId}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${m.waToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        messaging_product: "whatsapp", to: `91${phone}`, type: "template",
        template: {
          name: m.waRecoveryTemplate, language: { code: m.waLang || "en" },
          components: [
            { type: "body", parameters: [
              { type: "text", text: c.firstName || "there" },
              { type: "text", text: store.name },
              { type: "text", text: itemsText(s) },
            ] },
            { type: "button", sub_type: "url", index: "0", parameters: [{ type: "text", text: s.id }] },
          ],
        },
      }),
      signal: AbortSignal.timeout(10_000),
    });
    const body = (await res.json().catch(() => ({}))) as { messages?: { id: string }[]; error?: { message?: string } };
    if (!res.ok || !body.messages?.length) {
      console.error(`[recovery] ${s.id}:`, res.status, body.error?.message);
      return false;
    }
    await db.update(checkoutSessions).set({ recoverySent: step + 1, recoveryAt: new Date() }).where(eq(checkoutSessions.id, s.id));
    const tx = await chargeUsage(store.id, "wa_recovery", `rec:${s.id}:${step + 1}`, `Abandoned cart · message ${step + 1}`);
    await logOutbound(store.id, phone, {
      kind: "template", waMessageId: body.messages[0].id, chargedPaise: tx ? Math.abs(tx.entry.amountPaise) : 0,
      name: [c.firstName, c.lastName].filter(Boolean).join(" "),
      body: `Abandoned cart reminder ${step + 1} · ${itemsText(s)}\n[Complete my order]`,
    }).catch(() => {});
    return true;
  } catch (e) {
    console.error(`[recovery] ${s.id}:`, e instanceof Error ? e.message : e);
    return false;
  }
}

export async function runRecovery() {
  const m = await messaging();
  if (!m.waPhoneNumberId || !m.waToken || !m.waRecoveryTemplate) return { sent: 0 };
  const list = (await db.select().from(stores).where(eq(stores.active, true)))
    .filter((s) => resolveRecovery(s.recovery).on && waApproved(s));
  let sent = 0;
  for (const store of list) {
    for (const { s, step } of await dueSessions(store)) if (await sendRecovery(store, s, step)) sent++;
  }
  return { sent };
}

/** This month: messages sent, and checkouts that turned into orders after a message. */
export async function recoveryStats(storeId: number, since: Date) {
  const [r] = await db.select({
    messaged: sql<number>`count(*)::int`,
    // written out in full: inside a select list column names aren't table-qualified
    recovered: sql<number>`count(*) filter (where exists (select 1 from orders o where o.session_id = checkout_sessions.id and o.status in ('paid','cod_placed') and o.created_at > checkout_sessions.recovery_at))::int`,
  }).from(checkoutSessions).where(and(eq(checkoutSessions.storeId, storeId), gt(checkoutSessions.recoverySent, 0), gt(checkoutSessions.createdAt, since)));
  return { messaged: Number(r?.messaged ?? 0), recovered: Number(r?.recovered ?? 0) };
}

const EVERY_MS = 5 * 60_000;
declare global {
  // eslint-disable-next-line no-var
  var __recoveryWatcher: ReturnType<typeof setInterval> | undefined;
  // eslint-disable-next-line no-var
  var __recoveryRunning: boolean | undefined;
}

export function startRecoveryWatcher() {
  if (globalThis.__recoveryWatcher || !process.env.DATABASE_URL) return;
  const tick = async () => {
    if (globalThis.__recoveryRunning) return;
    globalThis.__recoveryRunning = true;
    try { await runRecovery(); } catch (e) { console.error("[recovery] job:", e instanceof Error ? e.message : e); }
    finally { globalThis.__recoveryRunning = false; }
  };
  globalThis.__recoveryWatcher = setInterval(() => void tick(), EVERY_MS);
  globalThis.__recoveryWatcher.unref?.();
  setTimeout(() => void tick(), 45_000).unref?.();
}

