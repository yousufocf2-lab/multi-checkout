// Read-only report in the server logs: checkouts where MSG91 refused to send the OTP ("IPBlocked"), and whether
// that customer still ended up with an order (same checkout, or the same phone in any store within 3 days).
import { and, eq, gte, inArray, sql } from "drizzle-orm";
import { checkoutEvents, checkoutSessions, db, orders, stores } from "~/db.server";

const DAYS = 30;
const digits = (p: unknown) => String(p ?? "").replace(/\D/g, "").slice(-10);
const ist = (d: Date) => new Date(d.getTime() + 330 * 60_000).toISOString().slice(0, 10);

let ran = false;
export async function logOtpBlockAudit() {
  if (ran) return;
  ran = true;
  try {
    const since = new Date(Date.now() - DAYS * 86400_000);
    const blocked = await db.select({ sessionId: checkoutEvents.sessionId, storeId: checkoutEvents.storeId, at: checkoutEvents.at })
      .from(checkoutEvents)
      .where(and(eq(checkoutEvents.type, "otp_error"), gte(checkoutEvents.at, since), sql`${checkoutEvents.data}->>'m' ilike '%IPBlocked%'`, sql`${checkoutEvents.data}->>'stage' = 'send'`));
    if (!blocked.length) { console.log(`[otp-block-audit] no IPBlocked sends in ${DAYS} days`); return; }
    const ids = [...new Set(blocked.map((b) => b.sessionId))];
    const firstBlock = new Map<string, Date>();
    const tries = new Map<string, number>();
    for (const b of blocked) {
      if (!firstBlock.has(b.sessionId) || b.at < firstBlock.get(b.sessionId)!) firstBlock.set(b.sessionId, b.at);
      tries.set(b.sessionId, (tries.get(b.sessionId) ?? 0) + 1);
    }
    const sessions = await db.select().from(checkoutSessions).where(inArray(checkoutSessions.id, ids));
    const sessById = new Map(sessions.map((s) => [s.id, s]));
    // did the OTP go through later in the same checkout?
    const later = await db.select({ sessionId: checkoutEvents.sessionId, type: checkoutEvents.type, at: checkoutEvents.at }).from(checkoutEvents)
      .where(and(inArray(checkoutEvents.sessionId, ids), inArray(checkoutEvents.type, ["otp_sent", "otp_verified"])));
    const recent = await db.select({ id: orders.id, storeId: orders.storeId, sessionId: orders.sessionId, status: orders.status, customer: orders.customer, total: orders.total, createdAt: orders.createdAt })
      .from(orders).where(gte(orders.createdAt, since));
    const storeNames = new Map((await db.select({ id: stores.id, name: stores.name }).from(stores)).map((s) => [s.id, s.name]));

    type Row = { blockedCheckouts: number; phones: Set<string>; orderSameCheckout: number; otpWorkedLater: number; orderedLater: number; lost: number; lostPhones: Set<string>; lostValue: number; tries: number; byDay: Record<string, { blocked: number; lost: number }> };
    const per = new Map<number, Row>();
    const lostList: string[] = [];
    for (const id of ids) {
      const s = sessById.get(id);
      const storeId = s?.storeId ?? blocked.find((b) => b.sessionId === id)!.storeId;
      const r = per.get(storeId) ?? { blockedCheckouts: 0, phones: new Set(), orderSameCheckout: 0, otpWorkedLater: 0, orderedLater: 0, lost: 0, lostPhones: new Set(), lostValue: 0, tries: 0, byDay: {} };
      per.set(storeId, r);
      const at = firstBlock.get(id)!;
      const day = ist(at);
      r.byDay[day] ??= { blocked: 0, lost: 0 };
      r.blockedCheckouts++;
      r.byDay[day].blocked++;
      r.tries += tries.get(id) ?? 0;
      const phone = digits(s?.customer?.phone);
      if (phone) r.phones.add(phone);
      if (later.some((e) => e.sessionId === id && e.at > at)) r.otpWorkedLater++;
      if (recent.some((o) => o.sessionId === id)) { r.orderSameCheckout++; continue; }
      const sameLater = phone && recent.some((o) => digits(o.customer?.phone) === phone && o.createdAt >= new Date(at.getTime() - 3600_000) && o.createdAt <= new Date(at.getTime() + 3 * 86400_000));
      if (sameLater) { r.orderedLater++; continue; }
      if (phone && r.lostPhones.has(phone)) continue; // same person, another checkout: count once
      r.lost++;
      r.byDay[day].lost++;
      if (phone) r.lostPhones.add(phone);
      r.lostValue += s?.cartValue ?? 0;
      lostList.push(`${storeId}|${day}|${phone ? `xxxxxx${phone.slice(-4)}` : "no-phone"}|${Math.round((s?.cartValue ?? 0) / 100)}`);
    }
    const first = blocked.reduce((a, b) => (b.at < a ? b.at : a), blocked[0].at);
    for (const [storeId, r] of per) {
      console.log(`[otp-block-audit] store ${storeId} ${storeNames.get(storeId) ?? ""}: ${JSON.stringify({
        days: DAYS, firstBlockedIST: ist(first), blockedCheckouts: r.blockedCheckouts, uniquePhones: r.phones.size, blockedTries: r.tries,
        otpWorkedLaterSameCheckout: r.otpWorkedLater, orderSameCheckout: r.orderSameCheckout, orderedLaterSamePhone: r.orderedLater,
        lostCustomers: r.lost, lostCartRs: Math.round(r.lostValue / 100),
        byDayIST: Object.fromEntries(Object.entries(r.byDay).sort()),
      })}`);
    }
    console.log(`[otp-block-audit] lost list store|day|phone|cartRs: ${lostList.join(", ")}`);
  } catch (e) {
    console.error("[otp-block-audit]", e instanceof Error ? e.message : e);
  }
}
