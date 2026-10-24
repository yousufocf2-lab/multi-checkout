// Cashfree PG, API version 2023-08-01: create order → payment_session_id → Cashfree JS checkout on our page.
// Status: GET /pg/orders/{order_id} → order_status PAID / ACTIVE / EXPIRED / TERMINATED.
import type { StoreGateway } from "~/db.server";
import { live, nameFor, readJson, rupees, toPaise, type GatewayAdapter } from "./types";

const base = (cfg: StoreGateway) => (live(cfg) ? "https://api.cashfree.com/pg" : "https://sandbox.cashfree.com/pg");
const headers = (cfg: StoreGateway) => ({
  "x-client-id": cfg.creds.appId ?? "", "x-client-secret": cfg.creds.secret ?? "", "x-api-version": "2023-08-01",
  "Content-Type": "application/json", Accept: "application/json",
});
const err = (j: Record<string, unknown>, status: number) => `Cashfree: ${String(j.message ?? j.raw ?? `HTTP ${status}`)}`;

export const cashfree: GatewayAdapter = {
  id: "cashfree",
  async start({ order, cfg, txn, amountPaise, returnUrl, notifyUrl }) {
    if (!cfg.creds.appId || !cfg.creds.secret) throw new Error("Cashfree App ID and secret are not set");
    const c = order.customer;
    const res = await fetch(`${base(cfg)}/orders`, {
      method: "POST", headers: { ...headers(cfg), "x-idempotency-key": crypto.randomUUID() },
      body: JSON.stringify({
        order_id: txn, order_amount: Number(rupees(amountPaise)), order_currency: "INR",
        customer_details: {
          customer_id: `C${c.phone}`, customer_phone: c.phone, customer_name: nameFor(order).slice(0, 100).padEnd(3, " "),
          ...(c.email ? { customer_email: c.email } : {}),
        },
        order_meta: { return_url: returnUrl.slice(0, 250), ...(notifyUrl.startsWith("https://") ? { notify_url: notifyUrl.slice(0, 250) } : {}) },
      }),
      signal: AbortSignal.timeout(12_000),
    });
    const j = await readJson(res);
    const session = (j.payment_session_id ?? j.payment_sessions_id) as string | undefined;
    if (!res.ok || !session) throw new Error(err(j, res.status));
    const mode = live(cfg) ? "production" : "sandbox";
    return {
      type: "script", src: "https://sdk.cashfree.com/js/v3/cashfree.js", ref: String(j.cf_order_id ?? ""),
      code: `Cashfree({mode:${JSON.stringify(mode)}}).checkout({paymentSessionId:${JSON.stringify(session)},redirectTarget:"_self"});`,
    };
  },
  async verify(cfg, txn) {
    const res = await fetch(`${base(cfg)}/orders/${encodeURIComponent(txn)}`, { headers: headers(cfg), signal: AbortSignal.timeout(10_000) });
    const j = await readJson(res);
    if (res.status === 404) return { status: "not_found", amountPaise: null, ref: null, raw: j };
    if (!res.ok) throw new Error(err(j, res.status));
    const s = String(j.order_status ?? "");
    const status = s === "PAID" ? "success" : s === "EXPIRED" || s === "TERMINATED" ? "failure" : "pending";
    return { status, amountPaise: toPaise(j.order_amount), ref: j.cf_order_id ? String(j.cf_order_id) : null, raw: j };
  },
  webhookTxn: (b) => {
    const d = b.data as { order?: { order_id?: string } } | undefined;
    return d?.order?.order_id ?? (typeof b.order_id === "string" ? b.order_id : null);
  },
  async test(cfg) {
    if (!cfg.creds.appId || !cfg.creds.secret) throw new Error("Cashfree App ID and secret are not set");
    const res = await fetch(`${base(cfg)}/orders/GPTEST${Date.now()}`, { headers: headers(cfg), signal: AbortSignal.timeout(10_000) });
    if (res.status === 401 || res.status === 403) throw new Error(err(await readJson(res), res.status));
    return `Cashfree ${cfg.mode} keys are valid`;
  },
};
