import crypto from "node:crypto";
import type { Order, Store } from "~/db/schema";

const sha512 = (s: string) => crypto.createHash("sha512").update(s).digest("hex");

export function payuEndpoint(store: Store) {
  return store.payuMode === "live" ? "https://secure.payu.in/_payment" : "https://test.payu.in/_payment";
}

/** Builds the POST fields for PayU hosted checkout. */
export function buildPayuParams(
  store: Store,
  order: Order,
  opts: { callbackUrl: string; offerKeys: string[] },
) {
  if (!store.payuKey || !store.payuSalt) throw new Error("PayU key/salt not configured for this store");
  const c = order.customer;
  const p: Record<string, string> = {
    key: store.payuKey,
    txnid: order.id,
    amount: (order.total / 100).toFixed(2),
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
export function verifyPayuResponse(store: Store, f: Record<string, string>) {
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
