import crypto from "node:crypto";
import { and, eq, gte, inArray, lt, sql } from "drizzle-orm";
import { db, orders, profitPayments, profitSettlements, shopifyNativeOrders, stores, users, wallets, walletTransactions, type Store } from "~/db.server";
import { orderValueSql } from "./order-value.server";
import { fetchSpend as metaSpend } from "./meta.server";
import { fetchSpend as googleSpend, googleReady } from "./google-ads.server";
import { metaReady } from "./ads.server";
import { profitStart, syncNativeOrders, nativeSyncStatus, NATIVE_HISTORY_DAYS } from "./native-orders.server";
import { storeGateways } from "./gateways/index.server";
import { env } from "./env.server";
import { messaging } from "./rto.server";
import { formatINR } from "./pricing";

const istToday = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
const dayDate = (day: string) => new Date(`${day}T00:00:00+05:30`);
function addDays(day: string, n: number) {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
const moneyPaise = (v: unknown) => Math.round(Number(v ?? 0) * 100);
type DailyProfit = { day: string; orders: number; revenue: number; settlement: number; adSpend: number; adCostWithGst: number; dropship: number; payments: number; advances: number; net: number; cumulative: number; growpefyShare: number; growpefyBalance: number; storeShare: number };

const PAYMENT_OTP_TTL_MS = 10 * 60_000;
const PAYMENT_OTP_MAX_ATTEMPTS = 5;
const paymentOtpHash = (id: string, code: string) => crypto.createHmac("sha256", env.sessionSecret).update(id + ":" + code).digest("hex");

function phone10(raw: string | null | undefined) {
  let digits = String(raw ?? "").replace(/\D/g, "");
  if (digits.startsWith("91") && digits.length === 12) digits = digits.slice(2);
  if (digits.startsWith("0") && digits.length === 11) digits = digits.slice(1);
  return /^[6-9]\d{9}$/.test(digits) ? digits : null;
}

function emailAddress(raw: string | null | undefined) {
  const email = String(raw ?? "").trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}

export type PaymentDirection = "to_growpefy" | "to_store";
const DIRECTION_TEXT: Record<PaymentDirection, string> = { to_growpefy: "Store paid Growpefy", to_store: "Growpefy gave the store" };

async function sendProfitEmail(to: string, store: Store, code: string, creator: string, amountPaise: number, direction: PaymentDirection) {
  const key = process.env.RESEND_API_KEY;
  if (!key) return false;
  const text = [
    "A direct payment needs your confirmation in Growpefy.",
    "Store: " + store.name,
    "Payment: " + DIRECTION_TEXT[direction],
    "Reported by: " + creator,
    "Amount: " + formatINR(amountPaise),
    "Confirmation code: " + code,
    "This code expires in 10 minutes. Enter it only in the Growpefy dashboard.",
    "If you did not expect this entry, do not share the code.",
  ].join("\n");
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: "Bearer " + key, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: process.env.MAIL_FROM || "Growpefy <no-reply@growpefy.com>",
      to: [to], subject: (direction === "to_store" ? "Confirm money given by Growpefy · " : "Confirm direct payment · ") + store.name, text,
    }),
    signal: AbortSignal.timeout(10_000),
  }).catch(() => null);
  return Boolean(res?.ok);
}

async function sendProfitOtp(store: Store, recipient: { phone: string | null; email: string | null }, code: string, creator: string, amountPaise: number, direction: PaymentDirection) {
  const m = await messaging();
  const sends: Promise<boolean>[] = [];
  if (recipient.phone && m.waPhoneNumberId && m.waToken && m.profitOtpTemplate) {
    sends.push((async () => {
      const send = async (components: unknown[]) => {
        const res = await fetch("https://graph.facebook.com/v21.0/" + m.waPhoneNumberId + "/messages", {
          method: "POST",
          headers: { Authorization: "Bearer " + m.waToken, "Content-Type": "application/json" },
          body: JSON.stringify({
            messaging_product: "whatsapp", to: "91" + recipient.phone, type: "template",
            template: { name: m.profitOtpTemplate, language: { code: m.waLang || "en" }, components },
          }),
          signal: AbortSignal.timeout(10_000),
        }).catch(() => null);
        if (!res) return false;
        const body = await res.json().catch(() => ({})) as { messages?: unknown[] };
        return Boolean(res.ok && body.messages?.length);
      };
      // Utility template: {{1}} store, {{2}} who recorded it, {{3}} amount, {{4}} code
      const detailed = [{ type: "body", parameters: [store.name, direction === "to_store" ? `${creator} (given to the store)` : creator, formatINR(amountPaise), code].map((text) => ({ type: "text", text: text.slice(0, 60) })) }];
      // Authentication template (Meta's fixed "{{1}} is your verification code" with a Copy code button): just the code
      const auth = [
        { type: "body", parameters: [{ type: "text", text: code }] },
        { type: "button", sub_type: "url", index: "0", parameters: [{ type: "text", text: code }] },
      ];
      return (await send(detailed)) || (await send(auth));
    })());
  }
  if (recipient.email) sends.push(sendProfitEmail(recipient.email, store, code, creator, amountPaise, direction));
  const results = await Promise.all(sends.map((p) => p.catch(() => false)));
  if (!results.some(Boolean)) throw new Error("Couldn't send the confirmation code. Set a valid email with RESEND_API_KEY or configure WhatsApp and its approved template.");
}

/**
 * Creates a pending direct-payment entry; it affects the balance only after the other party confirms.
 * to_growpefy (store paid its share) lowers what Growpefy is owed; to_store (Growpefy gave the store money) raises it.
 */
export async function createProfitPayment(store: Store, input: { amountPaise: number; paymentDate: string; note: string | null; role: "admin" | "owner"; name: string; direction: PaymentDirection }) {
  if (input.direction !== "to_growpefy" && input.direction !== "to_store") throw new Error("Choose who paid whom.");
  if (!Number.isSafeInteger(input.amountPaise) || input.amountPaise <= 0 || input.amountPaise > 2_147_483_647) throw new Error("Enter a valid payment amount.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.paymentDate) || input.paymentDate > istToday()) throw new Error("Choose a valid payment date (today or earlier).");
  if (new Date(input.paymentDate + "T00:00:00Z").toISOString().slice(0, 10) !== input.paymentDate) throw new Error("Choose a real calendar date.");
  if (input.paymentDate < profitStart(store)) throw new Error("Payment date can't be before the partnership start date.");
  const m = await messaging();
  let recipient: { phone: string | null; email: string | null } = { phone: null, email: null };
  const targetRole = input.role === "admin" ? "owner" : "admin";
  if (targetRole === "admin") recipient = {
    phone: phone10(m.profitOtpPhone),
    email: emailAddress(m.profitOtpEmail || process.env.ADMIN_EMAIL),
  };
  else if (store.ownerId) {
    const [owner] = await db.select({ phone: users.phone, email: users.email }).from(users).where(eq(users.id, store.ownerId)).limit(1);
    recipient = { phone: phone10(owner?.phone), email: emailAddress(owner?.email) };
  }
  if (!recipient.phone && !recipient.email) throw new Error(targetRole === "admin" ? "Set the Super Admin email or WhatsApp number in All wallets → Settings → Messaging first." : "This store owner has no valid mobile number or email on their account, so confirmation can't be sent.");
  const id = crypto.randomUUID();
  const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
  await sendProfitOtp(store, recipient, code, input.role === "admin" ? "Growpefy Super Admin" : "The store", input.amountPaise, input.direction);
  const expiresAt = new Date(Date.now() + PAYMENT_OTP_TTL_MS);
  await db.insert(profitPayments).values({
    id, storeId: store.id, amountPaise: input.amountPaise, direction: input.direction, paymentDate: input.paymentDate, note: input.note?.slice(0, 200) || null,
    createdByRole: input.role, createdBy: input.name.slice(0, 120), confirmRole: targetRole,
    otpHash: paymentOtpHash(id, code), otpExpiresAt: expiresAt,
  });
  return { id, expiresAt };
}

/** One-time confirmation by the receiving party. OTPs are hashed and attempts are capped. */
export async function confirmProfitPayment(id: string, storeId: number, code: string, role: "admin" | "owner", name: string) {
  return db.transaction(async (tx) => {
    const [row] = await tx.select().from(profitPayments).where(and(eq(profitPayments.id, id), eq(profitPayments.storeId, storeId))).limit(1);
    if (!row || row.status !== "pending" || row.confirmRole !== role || !row.otpHash) return "unavailable" as const;
    if (!row.otpExpiresAt || row.otpExpiresAt.getTime() < Date.now()) {
      await tx.update(profitPayments).set({ status: "expired", otpHash: null }).where(eq(profitPayments.id, id));
      return "expired" as const;
    }
    const want = Buffer.from(row.otpHash, "hex"), got = Buffer.from(paymentOtpHash(id, code), "hex");
    if (!/^\d{6}$/.test(code) || want.length !== got.length || !crypto.timingSafeEqual(want, got)) {
      const attempts = row.attempts + 1;
      await tx.update(profitPayments).set({ attempts, ...(attempts >= PAYMENT_OTP_MAX_ATTEMPTS ? { status: "expired", otpHash: null } : {}) }).where(eq(profitPayments.id, id));
      return attempts >= PAYMENT_OTP_MAX_ATTEMPTS ? "locked" as const : "incorrect" as const;
    }
    await tx.update(profitPayments).set({ status: "confirmed", confirmedBy: name.slice(0, 120), confirmedAt: new Date(), otpHash: null, otpExpiresAt: null }).where(eq(profitPayments.id, id));
    return "confirmed" as const;
  });
}

type SettlementResponse = { status: number; message?: string; result?: { page?: number; size?: number; totalCount?: number; data?: {
  settlementId: string; settlementCompletedDate: string; settlementAmount: string; utrNumber?: string;
}[] } };

const settleSync = new Map<number, { at: number; error: string | null }>();

/**
 * Brings PayU settlements up to date: from a few days before the last one we have (or the start date the first
 * time) to today. At most once every 15 minutes per store.
 */
async function refreshSettlements(store: Store, since: string, until: string) {
  const prev = settleSync.get(store.id);
  if (prev && Date.now() - prev.at < 15 * 60_000) return prev.error;
  // First time (or the start date moved earlier): every day from the start. Later: just the last few days.
  let from = since;
  if (store.profitSettledFrom && store.profitSettledFrom <= since) {
    const [last] = await db.select({ d: sql<string | null>`max(${profitSettlements.settlementDate})` }).from(profitSettlements)
      .where(and(eq(profitSettlements.storeId, store.id), gte(profitSettlements.settlementDate, since)));
    const base = last?.d ?? addDays(until, -5);
    from = addDays(base, -5) > since ? addDays(base, -5) : since;
  }
  const error = await syncSettlements(store, from, until);
  settleSync.set(store.id, { at: Date.now(), error });
  if (!error && from === since && store.profitSettledFrom !== since) {
    await db.update(stores).set({ profitSettledFrom: since }).where(eq(stores.id, store.id));
  }
  return error;
}

/** The start date or access changed: fetch settlements again on the next view. */
export function forgetProfitCache(storeId: number) {
  settleSync.delete(storeId);
}

/** Pull and cache PayU's actual settled-to-bank amounts; PayU limits a request to three dates. */
async function syncSettlements(store: Store, since: string, until: string) {
  const payu = storeGateways(store).find((g) => g.id === "payu");
  if (!payu?.creds.key || !payu.creds.salt) return "PayU key/salt are not configured for this store.";
  if (payu.mode !== "live") return "PayU settlement data needs the store's live PayU credentials.";
  try {
    for (let start = since; start <= until;) {
      const end = addDays(start, 2) < until ? addDays(start, 2) : until;
      let page = 1;
      for (;;) {
        const date = new Date().toUTCString();
        const signature = crypto.createHash("sha512").update(`|${date}|${payu.creds.salt}`).digest("hex");
        const authorization = `hmac username="${payu.creds.key}", algorithm="sha512", headers="date", signature="${signature}"`;
        const url = new URL("https://info.payu.in/settlement/range");
        url.searchParams.set("dateFrom", start); url.searchParams.set("dateTo", end);
        url.searchParams.set("page", String(page)); url.searchParams.set("pageSize", "500");
        const res = await fetch(url, { headers: { Authorization: authorization, Date: date }, signal: AbortSignal.timeout(20_000) });
        if (!res.ok) throw new Error(`PayU settlement API returned ${res.status}`);
        const body = await res.json() as SettlementResponse;
        // PayU answers "No data found" for days without a settlement: that's an empty result, not an error
        if (body.status !== 0 && /no data/i.test(body.message ?? "")) break;
        if (body.status !== 0) throw new Error(body.message || "PayU did not return settlement data");
        const rows = body.result?.data ?? [];
        for (const r of rows) {
          if (!r.settlementId || !r.settlementCompletedDate) continue;
          await db.insert(profitSettlements).values({
            storeId: store.id, settlementId: String(r.settlementId), settlementDate: String(r.settlementCompletedDate).slice(0, 10),
            settlementAmount: moneyPaise(r.settlementAmount), utrNumber: r.utrNumber ?? null, updatedAt: new Date(),
          }).onConflictDoUpdate({
            target: [profitSettlements.storeId, profitSettlements.settlementId],
            set: { settlementDate: String(r.settlementCompletedDate).slice(0, 10), settlementAmount: moneyPaise(r.settlementAmount), utrNumber: r.utrNumber ?? null, updatedAt: new Date() },
          });
        }
        const total = body.result?.totalCount ?? rows.length;
        const size = body.result?.size ?? rows.length;
        if (!rows.length || page * Math.max(size, 1) >= total) break;
        page++;
      }
      start = addDays(end, 1);
    }
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : "Could not load PayU settlements.";
  }
}

/** Cash-basis daily profit since the partnership start: bank settlements − ads incl GST + direct dropship wallet charges/refunds. */
export async function profitReport(store: Store) {
  const until = istToday();
  const since = profitStart(store) > until ? until : profitStart(store);
  const warnings: string[] = [];
  if (!store.profitEnabled) return { enabled: false, since, until, rows: [] as DailyProfit[], totals: null, warnings, upcoming: [] as Upcoming[], lastSettlement: null as string | null, native: null };

  const [settleWarn, metaResult, googleResult] = await Promise.all([
    refreshSettlements(store, since, until),
    metaReady(store) ? metaSpend(store, { since, until }, "day") : Promise.resolve(null),
    googleReady(store) ? googleSpend(store, { since, until }, "day") : Promise.resolve(null),
    syncNativeOrders(store),
  ]);
  if (settleWarn) warnings.push(settleWarn);
  const native = store.platform === "shopify" ? nativeSyncStatus(store.id) : null;
  if (native?.error) warnings.push(`Shopify checkout orders: ${native.error}`);
  if (metaResult?.error) warnings.push(`Meta ads: ${metaResult.error}`);
  if (googleResult?.error) warnings.push(`Google Ads: ${googleResult.error}`);

  const from = dayDate(since), to = dayDate(addDays(until, 1));
  const localSales = await db.select({
    day: sql<string>`to_char(${orders.createdAt} at time zone 'Asia/Kolkata', 'YYYY-MM-DD')`,
    count: sql<number>`count(*)::int`,
    revenue: sql<string>`coalesce(sum(${orderValueSql} - ${orders.refunded}), 0)::text`,
  }).from(orders).where(and(eq(orders.storeId, store.id), inArray(orders.status, ["paid", "cod_placed"]), gte(orders.createdAt, from), lt(orders.createdAt, to)))
    .groupBy(sql`1`);
  const nativeSales = store.platform === "shopify" ? await db.select({
    day: sql<string>`to_char(${shopifyNativeOrders.createdAt} at time zone 'Asia/Kolkata', 'YYYY-MM-DD')`,
    count: sql<number>`count(*)::int`,
    revenue: sql<string>`coalesce(sum(${shopifyNativeOrders.totalPaise}), 0)::text`,
  }).from(shopifyNativeOrders).where(and(eq(shopifyNativeOrders.storeId, store.id), eq(shopifyNativeOrders.cancelled, false), gte(shopifyNativeOrders.createdAt, from), lt(shopifyNativeOrders.createdAt, to)))
    .groupBy(sql`1`) : [];
  const settlementRows = await db.select().from(profitSettlements).where(and(eq(profitSettlements.storeId, store.id), gte(profitSettlements.settlementDate, since), lt(profitSettlements.settlementDate, addDays(until, 1))));
  const paymentRows = await db.select({ paymentDate: profitPayments.paymentDate, amountPaise: profitPayments.amountPaise, direction: profitPayments.direction })
    .from(profitPayments).where(and(eq(profitPayments.storeId, store.id), eq(profitPayments.status, "confirmed"), gte(profitPayments.paymentDate, since), lt(profitPayments.paymentDate, addDays(until, 1))));
  const walletRows = await db.select({
    day: sql<string>`to_char(${walletTransactions.createdAt} at time zone 'Asia/Kolkata', 'YYYY-MM-DD')`,
    amount: sql<string>`coalesce(sum(${walletTransactions.amountPaise}), 0)::text`,
  }).from(walletTransactions).innerJoin(wallets, eq(walletTransactions.walletId, wallets.id))
    .where(and(eq(wallets.storeId, store.id), inArray(walletTransactions.type, ["dropship_product", "dropship_shipping", "dropship_packing", "dropship_rto", "dropship_refund"]), gte(walletTransactions.createdAt, from), lt(walletTransactions.createdAt, to)))
    .groupBy(sql`1`);

  const map = new Map<string, { orders: number; revenue: number; settlement: number; adSpend: number; dropship: number; payments: number; advances: number }>();
  const rowFor = (d: string) => { const r = map.get(d) ?? { orders: 0, revenue: 0, settlement: 0, adSpend: 0, dropship: 0, payments: 0, advances: 0 }; map.set(d, r); return r; };
  for (const s of localSales) { const r = rowFor(s.day); r.orders += Number(s.count); r.revenue += Number(s.revenue) / 100; }
  for (const s of nativeSales) { const r = rowFor(s.day); r.orders += Number(s.count); r.revenue += Number(s.revenue) / 100; }
  for (const s of settlementRows) rowFor(s.settlementDate).settlement += s.settlementAmount / 100;
  for (const [day, n] of Object.entries(metaResult?.series ?? {})) rowFor(day).adSpend += n;
  for (const [day, n] of Object.entries(googleResult?.series ?? {})) rowFor(day).adSpend += n;
  for (const w of walletRows) rowFor(w.day).dropship += Number(w.amount) / 100;
  for (const p of paymentRows) {
    if (p.direction === "to_store") rowFor(p.paymentDate).advances += p.amountPaise / 100;
    else rowFor(p.paymentDate).payments += p.amountPaise / 100;
  }

  // Growpefy's share of net profit, set by the super admin (Store settings or Dropshipping)
  const share = store.profitShareBps / 10_000;
  let cumulative = 0, paymentsReceived = 0, advancesGiven = 0;
  const rows: DailyProfit[] = [];
  for (let day = since; day <= until; day = addDays(day, 1)) {
    const r = rowFor(day);
    const adCostWithGst = r.adSpend * 1.18;
    const net = r.settlement - adCostWithGst + r.dropship;
    cumulative += net; paymentsReceived += r.payments; advancesGiven += r.advances;
    const growpefyShare = cumulative * share;
    rows.push({ day, orders: r.orders, revenue: round(r.revenue), settlement: round(r.settlement), adSpend: round(r.adSpend), adCostWithGst: round(adCostWithGst), dropship: round(r.dropship), payments: round(r.payments), advances: round(r.advances), net: round(net), cumulative: round(cumulative), growpefyShare: round(growpefyShare), growpefyBalance: round(growpefyShare - paymentsReceived + advancesGiven), storeShare: round(cumulative * (1 - share)) });
  }
  if (!metaResult && !googleResult) warnings.push("No Meta or Google ad account is connected; ads costs are not included.");
  if (!settlementRows.length && !settleWarn) warnings.push("No PayU settlement records were returned for this period yet.");
  const nativeFloor = addDays(until, -(NATIVE_HISTORY_DAYS - 1));
  if (store.platform === "shopify" && since < nativeFloor) warnings.push(`Shopify gives orders from its own checkout for the last ${NATIVE_HISTORY_DAYS} days only, so those orders show from ${nativeFloor}. Settlements and ad costs count from ${since}.`);
  const last = rows.at(-1);
  const totals = rows.reduce((a, r) => ({ orders: a.orders + r.orders, revenue: a.revenue + r.revenue, settlement: a.settlement + r.settlement, adCostWithGst: a.adCostWithGst + r.adCostWithGst, payments: a.payments + r.payments, advances: a.advances + r.advances }),
    { orders: 0, revenue: 0, settlement: 0, adCostWithGst: 0, payments: 0, advances: 0 });
  const { upcoming, lastSettlement } = await upcomingSettlements(store, since, settlementRows.map((x) => x.settlementDate));
  const codDays = await db.select({ n: sql<number>`count(*)::int` }).from(orders)
    .where(and(eq(orders.storeId, store.id), inArray(orders.paymentMethod, ["cod", "partial"]), inArray(orders.status, ["cod_placed", "paid"]), gte(orders.createdAt, from)));
  if (Number(codDays[0]?.n ?? 0) > 0) warnings.push("COD money arrives through the courier, not PayU, so COD orders aren't in the profit yet (only in orders and revenue).");
  return { enabled: true, since, until, rows, totals: { ...totals, cumulative: last?.cumulative ?? 0, growpefyShare: last?.growpefyShare ?? 0, growpefyBalance: last?.growpefyBalance ?? 0, storeShare: last?.storeShare ?? 0 }, warnings, upcoming, lastSettlement, native };
}

export type Upcoming = { day: string; expected: string; amount: number; orders: number };

/** PayU usually settles a day's online payments two working days later (Sundays skipped). */
function expectedSettlement(day: string) {
  let d = addDays(day, 2);
  if (new Date(`${d}T12:00:00Z`).getUTCDay() === 0) d = addDays(d, 1);
  return d;
}

/**
 * Estimate of money still to come from PayU: online payments (Growpefy prepaid and Partial COD advances, plus
 * Shopify-checkout orders paid through PayU) from the day before the last settlement onwards. Before PayU's fee.
 */
async function upcomingSettlements(store: Store, since: string, settled: string[]) {
  const lastSettlement = settled.length ? settled.slice().sort().at(-1)! : null;
  // From the day before the last settlement; without any settlement yet, only the last few days can still be pending
  const floor = lastSettlement ? addDays(lastSettlement, -1) : addDays(istToday(), -4);
  const fromDay = floor > since ? floor : since;
  const from = dayDate(fromDay);
  const [own, native] = await Promise.all([
    db.select({
      day: sql<string>`to_char(${orders.createdAt} at time zone 'Asia/Kolkata', 'YYYY-MM-DD')`,
      count: sql<number>`count(*)::int`,
      amount: sql<string>`coalesce(sum(coalesce(${orders.amountPaid}, ${orders.total})), 0)::text`,
    }).from(orders).where(and(eq(orders.storeId, store.id), inArray(orders.paymentMethod, ["prepaid", "partial"]), sql`(${orders.amountPaid} is not null or ${orders.status} = 'paid')`, inArray(orders.status, ["paid", "cod_placed"]), gte(orders.createdAt, from)))
      .groupBy(sql`1`),
    store.platform === "shopify" ? db.select({
      day: sql<string>`to_char(${shopifyNativeOrders.createdAt} at time zone 'Asia/Kolkata', 'YYYY-MM-DD')`,
      count: sql<number>`count(*)::int`,
      amount: sql<string>`coalesce(sum(${shopifyNativeOrders.totalPaise}), 0)::text`,
    }).from(shopifyNativeOrders).where(and(eq(shopifyNativeOrders.storeId, store.id), eq(shopifyNativeOrders.prepaid, true), eq(shopifyNativeOrders.cancelled, false), sql`${shopifyNativeOrders.gateway} ilike '%payu%'`, gte(shopifyNativeOrders.createdAt, from)))
      .groupBy(sql`1`) : Promise.resolve([]),
  ]);
  const byDay = new Map<string, Upcoming>();
  for (const r of [...own, ...native]) {
    const u = byDay.get(r.day) ?? { day: r.day, expected: expectedSettlement(r.day), amount: 0, orders: 0 };
    u.amount = round(u.amount + Number(r.amount) / 100); u.orders += Number(r.count);
    byDay.set(r.day, u);
  }
  const today = istToday();
  const upcoming = [...byDay.values()].filter((u) => u.expected >= today || !lastSettlement || u.expected > lastSettlement).sort((a, b) => a.day.localeCompare(b.day));
  return { upcoming, lastSettlement };
}

const round = (n: number) => Math.round(n * 100) / 100;
