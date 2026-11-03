// Checkout diagnostics (admin): why customers who reach the checkout don't end up with an order.
// Joins what the browser reported (checkout_events), what the gateway said (payment_events) and the orders.
import { and, asc, desc, eq, gte, inArray, lt } from "drizzle-orm";
import { bankOffers, checkoutEvents, checkoutSessions, db, orders, paymentEvents, type Store } from "~/db.server";
import { storeGateways, syncOrderPayment } from "./gateways/index.server";

export type Device = { os: "android" | "ios" | "desktop" | "other"; app: "instagram" | "facebook" | "browser" };
export function deviceOf(ua: string | null | undefined): Device {
  const u = ua ?? "";
  const os = /android/i.test(u) ? "android" : /iphone|ipad|ipod/i.test(u) ? "ios" : /windows|macintosh|linux|cros/i.test(u) ? "desktop" : "other";
  const app = /instagram/i.test(u) ? "instagram" : /FBAN|FBAV|FB_IAB|FB4A|FBIOS|\[FB/i.test(u) ? "facebook" : "browser";
  return { os, app };
}
export const deviceLabel = (d: Device) => `${{ android: "Android", ios: "iPhone", desktop: "Computer", other: "Other" }[d.os]} · ${{ instagram: "Instagram app", facebook: "Facebook app", browser: "Browser" }[d.app]}`;

/** What happened to an online payment, in plain words, from the gateway's own answer. */
export function outcomeOf(status: string, detail: Record<string, string> | null): { key: string; label: string } {
  if (status === "paid" || status === "cod_placed") return { key: "paid", label: "Paid" };
  const s = `${detail?.unmappedstatus ?? ""} ${detail?.status ?? ""}`.toLowerCase();
  const err = detail?.error_Message ?? detail?.error_message ?? detail?.field9 ?? "";
  if (!detail) return { key: "unknown", label: "Not checked with the gateway yet" };
  if (/not.?found/.test(s)) return { key: "never", label: "Never reached the gateway (no transaction there)" };
  if (/usercancel|cancel/.test(s)) return { key: "cancelled", label: "Customer cancelled on the payment page" };
  if (/bounce/.test(s)) return { key: "bounced", label: "Opened the payment page and left without paying" };
  if (/dropped/.test(s)) return { key: "dropped", label: "Started paying (UPI / bank) and didn't finish" };
  if (/pending|progress|initiated/.test(s)) return { key: "pending", label: "Still pending at the gateway" };
  if (/fail/.test(s)) return { key: "failed", label: err ? `Failed: ${err}` : "Failed at the bank / gateway" };
  return { key: "other", label: s.trim() || "Unknown" };
}

export async function diagnostics(store: Store, days: number) {
  const since = new Date(Date.now() - days * 86400_000);
  const [sessions, events, online, offers] = await Promise.all([
    db.select({ id: checkoutSessions.id, tracking: checkoutSessions.tracking, customer: checkoutSessions.customer, attempted: checkoutSessions.paymentAttempted, at: checkoutSessions.createdAt })
      .from(checkoutSessions).where(and(eq(checkoutSessions.storeId, store.id), gte(checkoutSessions.createdAt, since))).orderBy(desc(checkoutSessions.createdAt)).limit(3000),
    db.select().from(checkoutEvents).where(and(eq(checkoutEvents.storeId, store.id), gte(checkoutEvents.at, since))).orderBy(asc(checkoutEvents.at)).limit(20000),
    db.select().from(orders).where(and(eq(orders.storeId, store.id), gte(orders.createdAt, since), inArray(orders.paymentMethod, ["prepaid", "partial"]))).orderBy(desc(orders.createdAt)).limit(300),
    db.select({ title: bankOffers.title, key: bankOffers.payuOfferKey, active: bankOffers.active }).from(bankOffers).where(eq(bankOffers.storeId, store.id)),
  ]);
  const allOrders = await db.select({ id: orders.id, sessionId: orders.sessionId, status: orders.status, method: orders.paymentMethod })
    .from(orders).where(and(eq(orders.storeId, store.id), gte(orders.createdAt, since)));
  const ids = online.map((o) => o.id);
  const pev = ids.length ? await db.select().from(paymentEvents).where(and(eq(paymentEvents.storeId, store.id), inArray(paymentEvents.orderId, ids))).orderBy(asc(paymentEvents.createdAt)) : [];

  // ---- gateway setup ----
  const gateways = storeGateways(store).map((g) => ({ id: g.id, mode: g.mode, on: g.on }));
  const warnings: string[] = [];
  for (const g of gateways) if (g.on && g.mode !== "live") warnings.push(`${g.id.toUpperCase()} is in TEST mode: real customers can't pay with real UPI / cards.`);
  if (!gateways.some((g) => g.on)) warnings.push("No online payment gateway is switched on.");
  const offerKeys = offers.filter((o) => o.active && o.key);
  if (offerKeys.length) warnings.push(`${offerKeys.length} active bank offer${offerKeys.length === 1 ? "" : "s"} send a PayU offer key with every payment (${offerKeys.map((o) => o.title).join(", ")}). A wrong or expired key makes PayU refuse the payment.`);

  // ---- sessions by device ----
  const evBySession = new Map<string, typeof events>();
  for (const e of events) { const l = evBySession.get(e.sessionId) ?? []; l.push(e); evBySession.set(e.sessionId, l); }
  const orderBySession = new Map<string, { status: string; method: string }>();
  for (const o of allOrders) if (o.sessionId && (o.status === "paid" || o.status === "cod_placed")) orderBySession.set(o.sessionId, { status: o.status, method: o.method });

  type Row = { label: string; sessions: number; phone: number; address: number; tried: number; orders: number; prepaid: number };
  const byDevice = new Map<string, Row>();
  for (const s of sessions) {
    const label = deviceLabel(deviceOf(s.tracking?.ua));
    const r = byDevice.get(label) ?? { label, sessions: 0, phone: 0, address: 0, tried: 0, orders: 0, prepaid: 0 };
    r.sessions++;
    if (s.customer?.phone) r.phone++;
    if (s.customer?.address1) r.address++;
    if (s.attempted) r.tried++;
    const o = orderBySession.get(s.id);
    if (o) { r.orders++; if (o.method !== "cod") r.prepaid++; }
    byDevice.set(label, r);
  }

  // ---- online payments ----
  const payments = online.map((o) => {
    const evs = pev.filter((e) => e.orderId === o.id);
    const lastVerify = [...evs].reverse().find((e) => e.kind === "verify" || e.kind === "payment");
    const detail = lastVerify ? Object.fromEntries(Object.entries((lastVerify.payload ?? {}) as Record<string, unknown>).filter(([, v]) => typeof v === "string" || typeof v === "number").map(([k, v]) => [k, String(v)])) : null;
    const cx = o.sessionId ? (evBySession.get(o.sessionId) ?? []).filter((e) => e.orderId === o.id || e.type.startsWith("pay_")) : [];
    const outcome = outcomeOf(o.status, lastVerify ? { ...detail, status: detail?.status ?? lastVerify.status ?? "" } : null);
    return {
      id: o.id, at: o.createdAt.toISOString(), status: o.status, method: o.paymentMethod, amount: o.advance ?? o.total, gateway: o.gateway,
      phone: o.customer.phone ? `${o.customer.phone.slice(0, 2)}xxxxxx${o.customer.phone.slice(-2)}` : "",
      device: deviceLabel(deviceOf(o.tracking?.ua)), outcome,
      payPages: cx.filter((e) => e.type === "pay_page").length, cameBack: cx.filter((e) => e.type === "pay_back").length,
      detail, error: o.error,
    };
  });
  const outcomes = new Map<string, { label: string; n: number }>();
  for (const p of payments) { const k = p.outcome.key; const c = outcomes.get(k) ?? { label: p.outcome.label.replace(/^Failed: .*/, "Failed at the bank / gateway"), n: 0 }; c.n++; outcomes.set(k, c); }

  // ---- what the browser reported ----
  const count = (t: string) => new Set(events.filter((e) => e.type === t).map((e) => e.sessionId)).size;
  const errorsShown = new Map<string, number>();
  for (const e of events) if (e.type === "error") { const m = String((e.data as { form?: string } | null)?.form ?? "Field errors"); errorsShown.set(m, (errorsShown.get(m) ?? 0) + 1); }
  const jsErrors = new Map<string, number>();
  for (const e of events) if (e.type === "js_error") { const m = String((e.data as { m?: string } | null)?.m ?? "Script error"); jsErrors.set(m, (jsErrors.get(m) ?? 0) + 1); }
  const browser = {
    tracked: new Set(events.map((e) => e.sessionId)).size,
    loaded: count("load"), submitted: count("submit"), toPay: count("to_pay"), payPage: count("pay_page"), payBack: count("pay_back"), payError: count("pay_error"),
    errors: [...errorsShown.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8),
    jsErrors: [...jsErrors.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8),
  };

  // ---- recent checkouts, step by step ----
  const recent = sessions.filter((s) => evBySession.has(s.id)).slice(0, 30).map((s) => ({
    id: s.id, at: s.at.toISOString(), device: deviceLabel(deviceOf(s.tracking?.ua)), order: orderBySession.get(s.id) ?? null,
    events: (evBySession.get(s.id) ?? []).map((e) => ({ type: e.type, at: e.at.toISOString(), data: e.data })),
  }));

  return {
    since: since.toISOString(), gateways, warnings, sessions: sessions.length,
    devices: [...byDevice.values()].sort((a, b) => b.sessions - a.sessions),
    payments, outcomes: [...outcomes.entries()].map(([key, v]) => ({ key, ...v })).sort((a, b) => b.n - a.n),
    browser, recent,
  };
}

/** Asks the gateway about every unpaid online order in the period (newest first). Paid ones become real orders. */
export async function recheckOnline(store: Store, days: number, limit = 60) {
  const since = new Date(Date.now() - days * 86400_000);
  const rows = await db.select().from(orders).where(and(eq(orders.storeId, store.id), gte(orders.createdAt, since), lt(orders.createdAt, new Date(Date.now() - 2 * 60_000)),
    inArray(orders.paymentMethod, ["prepaid", "partial"]), inArray(orders.status, ["pending_payment", "failed"]))).orderBy(desc(orders.createdAt)).limit(limit);
  let paid = 0;
  for (const o of rows) {
    const after = await syncOrderPayment(store, o, "diagnostics");
    if (after.status === "paid") paid++;
  }
  return { checked: rows.length, paid };
}
