// PayU hosted checkout (form post). Hash formulas from PayU's docs; same as the original integration.
import { and, eq, isNotNull } from "drizzle-orm";
import { bankOffers, db, type StoreGateway } from "~/db.server";
import { payuEndpoint, sha512, testPayu, verifyPayment, verifyPayuResponse, type PayuCreds } from "../payu.server";
import { emailFor, rupees, toPaise, type GatewayAdapter } from "./types";

const creds = (cfg: StoreGateway): PayuCreds => ({ payuKey: cfg.creds.key ?? null, payuSalt: cfg.creds.salt ?? null, payuMode: cfg.mode });

export const payu: GatewayAdapter = {
  id: "payu",
  async start({ store, order, cfg, txn, amountPaise, returnUrl }) {
    const c = creds(cfg);
    if (!c.payuKey || !c.payuSalt) throw new Error("PayU key and salt are not set");
    const p: Record<string, string> = {
      key: c.payuKey, txnid: txn, amount: rupees(amountPaise),
      productinfo: `${store.name} order`.slice(0, 100), firstname: order.customer.firstName.slice(0, 60) || "Customer",
      email: emailFor(order), phone: order.customer.phone, surl: returnUrl, furl: returnUrl,
      udf1: String(store.id), udf2: order.id, udf3: "", udf4: "", udf5: "",
    };
    p.hash = sha512([p.key, p.txnid, p.amount, p.productinfo, p.firstname, p.email, p.udf1, p.udf2, p.udf3, p.udf4, p.udf5, "", "", "", "", "", c.payuSalt].join("|"));
    // Bank offers from PayU's Offer Engine
    const offers = await db.select({ key: bankOffers.payuOfferKey }).from(bankOffers)
      .where(and(eq(bankOffers.storeId, store.id), eq(bankOffers.active, true), isNotNull(bankOffers.payuOfferKey)));
    const keys = offers.map((o) => o.key!).filter(Boolean);
    if (keys.length) p.offer_key = keys.join(",");
    return { type: "form", action: payuEndpoint(c), fields: p };
  },
  async verify(cfg, txn) {
    const v = await verifyPayment(creds(cfg), txn);
    return { status: v.status, amountPaise: v.amountPaise, debitedPaise: v.netDebitPaise, ref: v.mihpayid, raw: v.raw };
  },
  fromReturn(cfg, f, txn) {
    const c = creds(cfg);
    if (!f.hash || f.txnid !== txn || f.key !== c.payuKey || !verifyPayuResponse(c, f)) return null;
    const ok = f.status === "success";
    return { status: ok ? "success" : "failure", amountPaise: toPaise(f.amount), debitedPaise: toPaise(f.net_amount_debit), ref: f.mihpayid ?? null, raw: f };
  },
  webhookTxn: (b) => (typeof b.txnid === "string" ? b.txnid : typeof b.merchantTransactionId === "string" ? b.merchantTransactionId : null),
  test: (cfg) => testPayu(creds(cfg)),
};
