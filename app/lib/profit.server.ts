import crypto from "node:crypto";
import { and, eq, gte, inArray, lt, sql } from "drizzle-orm";
import { db, orders, profitPayments, profitSettlements, stores, users, wallets, walletTransactions, type Store } from "~/db.server";
import { orderValueSql } from "./order-value.server";
import { fetchSpend as metaSpend } from "./meta.server";
import { fetchSpend as googleSpend, googleReady } from "./google-ads.server";
import { metaReady } from "./ads.server";
import { fetchNativeSales } from "./shopify.server";
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
type DailyProfit = { day: string; orders: number; revenue: number; settlement: number; adSpend: number; adCostWithGst: number; dropship: number; payments: number; net: number; cumulative: number; growpefyShare: number; growpefyBalance: number; storeShare: number };

const PAYMENT_OTP_TTL_MS = 10 * 60_000;
const PAYMENT_OTP_MAX_ATTEMPTS = 5;
const paymentOtpHash = (id: string, code: string) => crypto.createHmac("sha256", env.sessionSecret).update(id + ":" + code).digest("hex");

function phone10(raw: string | null | undefined) {
  let digits = String(raw ?? "").replace(/\D/g, "");
  if (digits.startsWith("91") && digits.length === 12) digits = digits.slice(2);
  if (digits.startsWith("0") && digits.length === 11) digits = digits.slice(1);
  return /^[6-9]\d{9}$/.test(digits) ? digits : null;
}

async function sendProfitOtp(store: Store, to: string, code: string, creator: string, amountPaise: number) {
  const m = await messaging();
  if (!m.waPhoneNumberId || !m.waToken || !m.profitOtpTemplate) throw new Error("Profit confirmation WhatsApp is not configured. Add the approved template and WhatsApp credentials in Super Admin → All wallets → Settings → Messaging.");
  const res = await fetch("https://graph.facebook.com/v21.0/" + m.waPhoneNumberId + "/messages", {
    method: "POST",
    headers: { Authorization: "Bearer " + m.waToken, "Content-Type": "application/json" },
    body: JSON.stringify({
      messaging_product: "whatsapp", to: "91" + to, type: "template",
      template: { name: m.profitOtpTemplate, language: { code: m.waLang || "en" }, components: [{ type: "body", parameters: [store.name, creator, formatINR(amountPaise), code].map((text) => ({ type: "text", text: text.slice(0, 60) })) }] },
    }),
    signal: AbortSignal.timeout(10_000),
  }).catch(() => null);
  if (!res) throw new Error("Could not reach WhatsApp. No payment entry was created.");
  const body = await res.json().catch(() => ({})) as { messages?: unknown[]; error?: { message?: string } };
  if (!res.ok || !body.messages?.length) throw new Error("WhatsApp couldn't send the confirmation code" + (body.error?.message ? ": " + body.error.message : "."));
}

/** Creates a pending direct-payment entry; it affects profit balance only after the other party confirms. */
export async function createProfitPayment(store: Store, input: { amountPaise: number; paymentDate: string; note: string | null; role: "admin" | "owner"; name: string }) {
  if (!Number.isSafeInteger(input.amountPaise) || input.amountPaise <= 0 || input.amountPaise > 2_147_483_647) throw new Error("Enter a valid payment amount.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.paymentDate) || input.paymentDate > istToday()) throw new Error("Choose a valid payment date (today or earlier).");
  if (new Date(input.paymentDate + "T00:00:00Z").toISOString().slice(0, 10) !== input.paymentDate) throw new Error("Choose a real calendar date.");
  const enabledDate = store.profitEnabledAt ? new Date(store.profitEnabledAt.getTime() + 330 * 60_000).toISOString().slice(0, 10) : istToday();
  if (input.paymentDate < enabledDate) throw new Error("Payment date can't be before this dashboard was enabled.");
  const m = await messaging();
  let recipient: string | null = null;
  const targetRole = input.role === "admin" ? "owner" : "admin";
  if (targetRole === "admin") recipient = phone10(m.profitOtpPhone);
  else if (store.ownerId) {
    const [owner] = await db.select({ phone: users.phone }).from(users).where(eq(users.id, store.ownerId)).limit(1);
    recipient = phone10(owner?.phone);
  }
  if (!recipient) throw new Error(targetRole === "admin" ? "Set the Super Admin WhatsApp number in All wallets → Settings → Messaging first." : "This store owner has no valid mobile number on their account, so WhatsApp confirmation can't be sent.");
  const id = crypto.randomUUID();
  const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
  await sendProfitOtp(store, recipient, code, input.role === "admin" ? "Growpefy Super Admin" : "The store", input.amountPaise);
  const expiresAt = new Date(Date.now() + PAYMENT_OTP_TTL_MS);
  await db.insert(profitPayments).values({
    id, storeId: store.id, amountPaise: input.amountPaise, paymentDate: input.paymentDate, note: input.note?.slice(0, 200) || null,
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

/** Cash-basis daily profit: bank settlements − ads incl GST + direct dropship wallet charges/refunds. */
export async function profitReport(store: Store) {
  const until = istToday();
  const since = store.profitEnabledAt ? new Date(new Date(store.profitEnabledAt).getTime() + 330 * 60_000).toISOString().slice(0, 10) : until;
  const warnings: string[] = [];
  if (!store.profitEnabled) return { enabled: false, since, until, rows: [] as DailyProfit[], totals: null, warnings };

  const nativeSince = since < addDays(until, -59) ? addDays(until, -59) : since;
  let nativeError: string | null = null;
  const [settleWarn, nativeResult, metaResult, googleResult] = await Promise.all([
    syncSettlements(store, since, until),
    store.platform === "shopify" ? fetchNativeSales(store, nativeSince, addDays(until, 1)).catch((e) => {
      nativeError = e instanceof Error ? e.message : "Could not load Shopify native orders.";
      return { daily: {}, currency: "INR" };
    }) : Promise.resolve({ daily: {}, currency: "INR" }),
    metaReady(store) ? metaSpend(store, { since, until }, "day") : Promise.resolve(null),
    googleReady(store) ? googleSpend(store, { since, until }, "day") : Promise.resolve(null),
  ]);
  if (settleWarn) warnings.push(settleWarn);
  if (nativeError) warnings.push(nativeError);
  if (metaResult?.error) warnings.push(`Meta ads: ${metaResult.error}`);
  if (googleResult?.error) warnings.push(`Google Ads: ${googleResult.error}`);

  const from = dayDate(since), to = dayDate(addDays(until, 1));
  const localSales = await db.select({
    day: sql<string>`to_char(${orders.createdAt} at time zone 'Asia/Kolkata', 'YYYY-MM-DD')`,
    count: sql<number>`count(*)::int`,
    revenue: sql<string>`coalesce(sum(${orderValueSql} - ${orders.refunded}), 0)::text`,
  }).from(orders).where(and(eq(orders.storeId, store.id), inArray(orders.status, ["paid", "cod_placed"]), gte(orders.createdAt, from), lt(orders.createdAt, to)))
    .groupBy(sql`1`);
  const settlementRows = await db.select().from(profitSettlements).where(and(eq(profitSettlements.storeId, store.id), gte(profitSettlements.settlementDate, since), lt(profitSettlements.settlementDate, addDays(until, 1))));
  const paymentRows = await db.select({ paymentDate: profitPayments.paymentDate, amountPaise: profitPayments.amountPaise })
    .from(profitPayments).where(and(eq(profitPayments.storeId, store.id), eq(profitPayments.status, "confirmed"), gte(profitPayments.paymentDate, since), lt(profitPayments.paymentDate, addDays(until, 1))));
  const walletRows = await db.select({
    day: sql<string>`to_char(${walletTransactions.createdAt} at time zone 'Asia/Kolkata', 'YYYY-MM-DD')`,
    amount: sql<string>`coalesce(sum(${walletTransactions.amountPaise}), 0)::text`,
  }).from(walletTransactions).innerJoin(wallets, eq(walletTransactions.walletId, wallets.id))
    .where(and(eq(wallets.storeId, store.id), inArray(walletTransactions.type, ["dropship_product", "dropship_shipping", "dropship_packing", "dropship_rto", "dropship_refund"]), gte(walletTransactions.createdAt, from), lt(walletTransactions.createdAt, to)))
    .groupBy(sql`1`);

  const map = new Map<string, { orders: number; revenue: number; settlement: number; adSpend: number; dropship: number; payments: number }>();
  const rowFor = (d: string) => { const r = map.get(d) ?? { orders: 0, revenue: 0, settlement: 0, adSpend: 0, dropship: 0, payments: 0 }; map.set(d, r); return r; };
  for (const s of localSales) { const r = rowFor(s.day); r.orders += Number(s.count); r.revenue += Number(s.revenue) / 100; }
  for (const [day, s] of Object.entries(nativeResult.daily)) { const r = rowFor(day); r.orders += s.orders; r.revenue += s.revenue; }
  for (const s of settlementRows) rowFor(s.settlementDate).settlement += s.settlementAmount / 100;
  for (const [day, n] of Object.entries(metaResult?.series ?? {})) rowFor(day).adSpend += n;
  for (const [day, n] of Object.entries(googleResult?.series ?? {})) rowFor(day).adSpend += n;
  for (const w of walletRows) rowFor(w.day).dropship += Number(w.amount) / 100;
  for (const p of paymentRows) rowFor(p.paymentDate).payments += p.amountPaise / 100;

  const share = store.dropshipEnabled ? 0.2 : store.profitShareBps / 10_000;
  let cumulative = 0, paymentsReceived = 0;
  const rows: DailyProfit[] = [];
  for (let day = since; day <= until; day = addDays(day, 1)) {
    const r = rowFor(day);
    const adCostWithGst = r.adSpend * 1.18;
    const net = r.settlement - adCostWithGst + r.dropship;
    cumulative += net; paymentsReceived += r.payments;
    const growpefyShare = cumulative * share;
    rows.push({ day, orders: r.orders, revenue: round(r.revenue), settlement: round(r.settlement), adSpend: round(r.adSpend), adCostWithGst: round(adCostWithGst), dropship: round(r.dropship), payments: round(r.payments), net: round(net), cumulative: round(cumulative), growpefyShare: round(growpefyShare), growpefyBalance: round(growpefyShare - paymentsReceived), storeShare: round(cumulative * (1 - share)) });
  }
  if (!metaResult && !googleResult) warnings.push("No Meta or Google ad account is connected; ads costs are not included.");
  if (!settlementRows.length && !settleWarn) warnings.push("No PayU settlement records were returned for this period yet.");
  if (store.platform !== "shopify") warnings.push("Native order revenue sync is only available for Shopify stores.");
  if (store.platform === "shopify" && since < nativeSince) warnings.push(`Shopify native-order sales are shown from ${nativeSince}, because the app currently has access to the last 60 days. Profit calculations include settlements and ad costs from ${since}.`);
  const last = rows.at(-1);
  const totals = rows.reduce((a, r) => ({ orders: a.orders + r.orders, revenue: a.revenue + r.revenue, settlement: a.settlement + r.settlement, adCostWithGst: a.adCostWithGst + r.adCostWithGst, payments: a.payments + r.payments }),
    { orders: 0, revenue: 0, settlement: 0, adCostWithGst: 0, payments: 0 });
  return { enabled: true, since, until, rows, totals: { ...totals, cumulative: last?.cumulative ?? 0, growpefyShare: last?.growpefyShare ?? 0, growpefyBalance: last?.growpefyBalance ?? 0, storeShare: last?.storeShare ?? 0 }, warnings };
}

const round = (n: number) => Math.round(n * 100) / 100;
