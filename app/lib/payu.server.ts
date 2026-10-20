import crypto from "node:crypto";
import type { Order, Store } from "~/db/schema";
import { payNowPaise } from "./payment-methods";

const sha512 = (s: string) => crypto.createHash("sha512").update(s).digest("hex");

/** Just the PayU credentials (a store's, or the platform's for wallet recharges). */
export type PayuCreds = Pick<Store, "payuKey" | "payuSalt" | "payuMode">;
export { sha512 };

export function payuEndpoint(store: PayuCreds) {
  return store.payuMode === "live" ? "https://secure.payu.in/_payment" : "https://test.payu.in/_payment";
}

/** Builds the POST fields for PayU hosted checkout. */
export function buildPayuParams(
  store: Store,
  order: Order,
  opts: { callbackUrl: string; offerKeys: string[] },
) {
  if (!store.payuKey || !store.payuSalt) throw new Error("PayU key and salt are not set for this store");
  const c = order.customer;
  const p: Record<string, string> = {
    key: store.payuKey,
    txnid: order.id,
    amount: (payNowPaise(order) / 100).toFixed(2),
    productinfo: `${store.name} order`.slice(0, 100),
    firstname: c.firstName.slice(0, 60),
    email: c.email || `customer${c.phone}@noemail.in`,
    phone: c.phone,
    surl: opts.callbackUrl,
    furl: opts.callbackUrl,
    udf1: String(store.id),
    udf2: order.id,
    udf3: "",
    udf4: "",
    udf5: "",
  };
  // key|txnid|amount|productinfo|firstname|email|udf1|udf2|udf3|udf4|udf5||||||SALT
  p.hash = sha512(
    [p.key, p.txnid, p.amount, p.productinfo, p.firstname, p.email, p.udf1, p.udf2, p.udf3, p.udf4, p.udf5, "", "", "", "", "", store.payuSalt].join("|"),
  );
  // Bank offers configured in PayU's Offer Engine — PayU validates the card and applies the discount.
  if (opts.offerKeys.length) p.offer_key = opts.offerKeys.join(",");
  return p;
}

/** Verifies the reverse hash PayU posts back to surl/furl. */
export function verifyPayuResponse(store: PayuCreds, f: Record<string, string>) {
  if (!store.payuSalt) return false;
  // SALT|status||||||udf5|udf4|udf3|udf2|udf1|email|firstname|productinfo|amount|txnid|key
  let s = [
    store.payuSalt, f.status ?? "", "", "", "", "", "",
    f.udf5 ?? "", f.udf4 ?? "", f.udf3 ?? "", f.udf2 ?? "", f.udf1 ?? "",
    f.email ?? "", f.firstname ?? "", f.productinfo ?? "", f.amount ?? "", f.txnid ?? "", f.key ?? "",
  ].join("|");
  if (f.additionalCharges) s = `${f.additionalCharges}|${s}`;
  const expected = sha512(s);
  const got = (f.hash ?? "").toLowerCase();
  return got.length === expected.length && crypto.timingSafeEqual(Buffer.from(got), Buffer.from(expected));
}

/** Checks key + salt by calling PayU's verify_payment API with a dummy txnid. */
export async function testPayu(store: PayuCreds) {
  if (!store.payuKey || !store.payuSalt) throw new Error("PayU key and salt are not set");
  const host = store.payuMode === "live" ? "https://info.payu.in" : "https://test.payu.in";
  const command = "verify_payment";
  const var1 = `CXTEST${Date.now()}`;
  const hash = sha512([store.payuKey, command, var1, store.payuSalt].join("|"));
  const res = await fetch(`${host}/merchant/postservice.php?form=2`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ key: store.payuKey, command, var1, hash }),
  });
  const text = await res.text();
  let data: { status?: number | string; msg?: string } = {};
  try { data = JSON.parse(text); } catch { /* PayU sometimes returns plain text */ }
  const msg = data.msg ?? text.slice(0, 200);
  // Valid credentials -> "0 out of 1 Transactions Fetched Successfully" (status 0 or 1)
  if (/transactions? fetched/i.test(msg)) return `PayU ${store.payuMode} credentials are valid`;
  throw new Error(`PayU: ${msg || `HTTP ${res.status}`}`);
}

// ---------------- server-to-server verification ----------------

function infoHost(store: PayuCreds) {
  return store.payuMode === "live" ? "https://info.payu.in" : "https://test.payu.in";
}

async function postService(store: PayuCreds, command: string, var1: string) {
  if (!store.payuKey || !store.payuSalt) throw new Error("PayU key and salt are not set");
  const hash = sha512([store.payuKey, command, var1, store.payuSalt].join("|"));
  const res = await fetch(`${infoHost(store)}/merchant/postservice.php?form=2`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ key: store.payuKey, command, var1, hash }),
    signal: AbortSignal.timeout(10_000),
  });
  const text = await res.text();
  try { return JSON.parse(text) as Record<string, unknown>; } catch { return { raw: text } as Record<string, unknown>; }
}

export type PayuVerification = {
  status: "success" | "failure" | "pending" | "not_found";
  amountPaise: number | null;
  netDebitPaise: number | null;
  mihpayid: string | null;
  raw: Record<string, unknown>;
};

const toPaise = (v: unknown) => {
  const n = parseFloat(String(v ?? ""));
  return Number.isFinite(n) ? Math.round(n * 100) : null;
};

/** Asks PayU directly for the real status of a transaction. */
export async function verifyPayment(store: PayuCreds, txnid: string): Promise<PayuVerification> {
  const data = await postService(store, "verify_payment", txnid);
  const td = (data.transaction_details as Record<string, Record<string, unknown>> | undefined)?.[txnid];
  if (!td) return { status: "not_found", amountPaise: null, netDebitPaise: null, mihpayid: null, raw: data };
  const s = String(td.status ?? "").toLowerCase();
  const status: PayuVerification["status"] =
    s === "success" ? "success" : s === "failure" || s === "failed" ? "failure" : s.includes("not found") ? "not_found" : "pending";
  return {
    status,
    amountPaise: toPaise(td.amt ?? td.transaction_amount),
    netDebitPaise: toPaise(td.net_amount_debit),
    mihpayid: td.mihpayid ? String(td.mihpayid) : null,
    raw: td,
  };
}

/** Total successfully refunded for a transaction, as reported by PayU. */
export async function fetchRefundedPaise(store: Store, txnid: string): Promise<{ refunded: number; pending: boolean; raw: Record<string, unknown> }> {
  const data = await postService(store, "getAllRefundsFromTxnIds", txnid);
  let refunded = 0;
  let pending = false;
  const walk = (v: unknown) => {
    if (Array.isArray(v)) return v.forEach(walk);
    if (!v || typeof v !== "object") return;
    const o = v as Record<string, unknown>;
    const amountKey = Object.keys(o).find((k) => /^(amount|amt|refund_amount|refundamount)$/i.test(k));
    const statusKey = Object.keys(o).find((k) => /status/i.test(k));
    if (amountKey && statusKey) {
      const st = String(o[statusKey]).toLowerCase();
      const amt = toPaise(o[amountKey]) ?? 0;
      if (/success|complete|processed|refunded/.test(st)) refunded += amt;
      else if (/queue|pending|progress|requested/.test(st)) pending = true;
      return;
    }
    Object.values(o).forEach(walk);
  };
  walk(data);
  return { refunded, pending, raw: data };
}
