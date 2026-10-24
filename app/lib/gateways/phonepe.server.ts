// PhonePe PG Standard Checkout v2: OAuth token (client credentials) → POST checkout/v2/pay → redirect.
// Status: GET checkout/v2/order/{merchantOrderId}/status → state COMPLETED / FAILED / PENDING (amount in paise).
import type { StoreGateway } from "~/db.server";
import { live, readJson, type GatewayAdapter } from "./types";

const urls = (cfg: StoreGateway) => live(cfg)
  ? { token: "https://api.phonepe.com/apis/identity-manager/v1/oauth/token", pg: "https://api.phonepe.com/apis/pg" }
  : { token: "https://api-preprod.phonepe.com/apis/pg-sandbox/v1/oauth/token", pg: "https://api-preprod.phonepe.com/apis/pg-sandbox" };

const tokens = new Map<string, { token: string; exp: number }>();

async function token(cfg: StoreGateway) {
  const { clientId, clientSecret } = cfg.creds;
  if (!clientId || !clientSecret) throw new Error("PhonePe client ID and secret are not set");
  const key = `${cfg.mode}:${clientId}`;
  const hit = tokens.get(key);
  if (hit && hit.exp > Date.now() + 60_000) return hit.token;
  const res = await fetch(urls(cfg).token, {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: clientId, client_version: cfg.creds.clientVersion || "1", client_secret: clientSecret, grant_type: "client_credentials" }),
    signal: AbortSignal.timeout(10_000),
  });
  const j = await readJson(res);
  if (!res.ok || !j.access_token) throw new Error(`PhonePe: ${String(j.message ?? j.error ?? j.raw ?? `HTTP ${res.status}`)}`);
  const exp = Number(j.expires_at) ? Number(j.expires_at) * 1000 : Date.now() + 30 * 60_000;
  tokens.set(key, { token: String(j.access_token), exp });
  return String(j.access_token);
}

export const phonepe: GatewayAdapter = {
  id: "phonepe",
  async start({ order, cfg, txn, amountPaise, returnUrl }) {
    const t = await token(cfg);
    const res = await fetch(`${urls(cfg).pg}/checkout/v2/pay`, {
      method: "POST", headers: { "Content-Type": "application/json", Authorization: `O-Bearer ${t}` },
      body: JSON.stringify({
        merchantOrderId: txn, amount: amountPaise, expireAfter: 1800,
        paymentFlow: { type: "PG_CHECKOUT", message: `Order ${order.id}`, merchantUrls: { redirectUrl: returnUrl } },
        prefillUserLoginDetails: { phoneNumber: order.customer.phone },
      }),
      signal: AbortSignal.timeout(12_000),
    });
    const j = await readJson(res);
    if (!res.ok || !j.redirectUrl) throw new Error(`PhonePe: ${String(j.message ?? j.code ?? j.raw ?? `HTTP ${res.status}`)}`);
    return { type: "redirect", url: String(j.redirectUrl), ref: j.orderId ? String(j.orderId) : null };
  },
  async verify(cfg, txn) {
    const t = await token(cfg);
    const res = await fetch(`${urls(cfg).pg}/checkout/v2/order/${encodeURIComponent(txn)}/status`, {
      headers: { "Content-Type": "application/json", Authorization: `O-Bearer ${t}` }, signal: AbortSignal.timeout(10_000),
    });
    const j = await readJson(res);
    if (res.status === 404) return { status: "not_found", amountPaise: null, ref: null, raw: j };
    if (!res.ok) throw new Error(`PhonePe: ${String(j.message ?? j.code ?? `HTTP ${res.status}`)}`);
    const s = String(j.state ?? "");
    const pd = (j.paymentDetails as { transactionId?: string }[] | undefined)?.[0];
    return { status: s === "COMPLETED" ? "success" : s === "FAILED" ? "failure" : "pending", amountPaise: Number(j.amount) || null, ref: pd?.transactionId ?? (j.orderId ? String(j.orderId) : null), raw: j };
  },
  webhookTxn: (b) => {
    const p = b.payload as { merchantOrderId?: string } | undefined;
    return p?.merchantOrderId ?? null;
  },
  async test(cfg) {
    await token(cfg);
    return `PhonePe ${cfg.mode} keys are valid`;
  },
};
