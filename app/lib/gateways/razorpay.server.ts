// Razorpay Standard Checkout: create an order (Orders API), open checkout.js on our page with callback_url.
// Callback posts razorpay_payment_id, razorpay_order_id, razorpay_signature (HMAC-SHA256 "order_id|payment_id" with the key secret).
// Status: GET /v1/orders/{id}/payments; "authorized" payments are captured here.
import crypto from "node:crypto";
import type { StoreGateway } from "~/db.server";
import { nameFor, readJson, type GatewayAdapter, type Verification } from "./types";

const API = "https://api.razorpay.com/v1";
const auth = (cfg: StoreGateway) => `Basic ${Buffer.from(`${cfg.creds.keyId ?? ""}:${cfg.creds.keySecret ?? ""}`).toString("base64")}`;
const err = (j: Record<string, unknown>, status: number) => {
  const e = j.error as { description?: string } | undefined;
  return `Razorpay: ${e?.description ?? String(j.raw ?? `HTTP ${status}`)}`;
};
const same = (a: string, b: string) => a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));

export const razorpay: GatewayAdapter = {
  id: "razorpay",
  async start({ store, order, cfg, txn, amountPaise, returnUrl }) {
    if (!cfg.creds.keyId || !cfg.creds.keySecret) throw new Error("Razorpay key ID and secret are not set");
    const res = await fetch(`${API}/orders`, {
      method: "POST", headers: { Authorization: auth(cfg), "Content-Type": "application/json" },
      body: JSON.stringify({ amount: amountPaise, currency: "INR", receipt: txn.slice(0, 40), notes: { txn, store: store.name.slice(0, 200) } }),
      signal: AbortSignal.timeout(12_000),
    });
    const j = await readJson(res);
    if (!res.ok || !j.id) throw new Error(err(j, res.status));
    const opts = {
      key: cfg.creds.keyId, order_id: j.id, amount: amountPaise, currency: "INR", name: store.name,
      description: `Order ${order.id}`, image: store.logoUrl ?? undefined,
      callback_url: returnUrl, redirect: true,
      prefill: { name: nameFor(order), contact: `+91${order.customer.phone}`, ...(order.customer.email ? { email: order.customer.email } : {}) },
      theme: { color: /^#[0-9a-f]{6}$/i.test(store.primaryColor) ? store.primaryColor : "#111827" },
      modal: { ondismiss: "__DISMISS__" },
    };
    const code = `var o=${JSON.stringify(opts)};o.modal.ondismiss=function(){location.href=${JSON.stringify(returnUrl)}+"&dismissed=1"};new Razorpay(o).open();`;
    return { type: "script", src: "https://checkout.razorpay.com/v1/checkout.js", code, ref: String(j.id) };
  },
  async verify(cfg, _txn, ref) {
    if (!ref) return { status: "not_found", amountPaise: null, ref: null, raw: null };
    const res = await fetch(`${API}/orders/${encodeURIComponent(ref)}/payments`, { headers: { Authorization: auth(cfg) }, signal: AbortSignal.timeout(10_000) });
    const j = await readJson(res);
    if (!res.ok) throw new Error(err(j, res.status));
    const items = (j.items as { id: string; status: string; amount: number }[] | undefined) ?? [];
    const captured = items.find((p) => p.status === "captured");
    if (captured) return { status: "success", amountPaise: captured.amount, ref: captured.id, raw: captured };
    const authorized = items.find((p) => p.status === "authorized");
    if (authorized) {
      const c = await fetch(`${API}/payments/${authorized.id}/capture`, {
        method: "POST", headers: { Authorization: auth(cfg), "Content-Type": "application/json" },
        body: JSON.stringify({ amount: authorized.amount, currency: "INR" }), signal: AbortSignal.timeout(10_000),
      });
      const cj = await readJson(c);
      if (c.ok && cj.status === "captured") return { status: "success", amountPaise: authorized.amount, ref: authorized.id, raw: cj };
      return { status: "pending", amountPaise: authorized.amount, ref: authorized.id, raw: cj };
    }
    const v: Verification = { status: items.length && items.every((p) => p.status === "failed") ? "failure" : items.length ? "pending" : "not_found", amountPaise: null, ref: null, raw: items };
    return v;
  },
  fromReturn(cfg, f) {
    // A valid signature proves the payment went through; verify() then confirms capture and amount
    const sig = f.razorpay_signature, pid = f.razorpay_payment_id, oid = f.razorpay_order_id;
    if (!sig || !pid || !oid || !cfg.creds.keySecret) return null;
    const expected = crypto.createHmac("sha256", cfg.creds.keySecret).update(`${oid}|${pid}`).digest("hex");
    return same(sig, expected) ? null : { status: "failure", amountPaise: null, ref: pid, raw: { error: "signature mismatch" } };
  },
  webhookTxn: (b) => {
    const p = (b.payload as { payment?: { entity?: { notes?: { txn?: string } } }; order?: { entity?: { receipt?: string } } } | undefined);
    return p?.payment?.entity?.notes?.txn ?? p?.order?.entity?.receipt ?? null;
  },
  async test(cfg) {
    if (!cfg.creds.keyId || !cfg.creds.keySecret) throw new Error("Razorpay key ID and secret are not set");
    const res = await fetch(`${API}/orders?count=1`, { headers: { Authorization: auth(cfg) }, signal: AbortSignal.timeout(10_000) });
    if (!res.ok) throw new Error(err(await readJson(res), res.status));
    const mode = cfg.creds.keyId.startsWith("rzp_live_") ? "live" : "test";
    return `Razorpay ${mode} keys are valid`;
  },
};
