// Paytm PG (paytmpayments.com): initiateTransaction (signed body) → txnToken → showPaymentPage form post.
// Status: POST merchant-status/api/v1/getPaymentStatus → body.resultInfo.resultStatus TXN_SUCCESS / TXN_FAILURE / PENDING.
// Signature = Paytm checksum: AES-128-CBC(sha256(body + "|" + salt) + salt), IV "@@@@&&&&####$$$$" (as in Paytm's checksum library).
import crypto from "node:crypto";
import type { StoreGateway } from "~/db.server";
import { readJson, rupees, toPaise, type GatewayAdapter } from "./types";

const IV = "@@@@&&&&####$$$$";
const host = (cfg: StoreGateway) => (cfg.mode === "live" ? "https://secure.paytmpayments.com" : "https://securestage.paytmpayments.com");

export function paytmSignature(body: string, key: string) {
  const salt = crypto.randomBytes(3).toString("base64"); // 4 characters, like the official library
  const hash = crypto.createHash("sha256").update(`${body}|${salt}`).digest("hex") + salt;
  const c = crypto.createCipheriv("aes-128-cbc", Buffer.from(key, "utf8"), Buffer.from(IV, "utf8"));
  return c.update(hash, "binary", "base64") + c.final("base64");
}

async function call(cfg: StoreGateway, path: string, body: Record<string, unknown>, head: Record<string, unknown> = {}) {
  const { merchantKey } = cfg.creds;
  if (!cfg.creds.mid || !merchantKey) throw new Error("Paytm MID and merchant key are not set");
  const b = JSON.stringify(body);
  const res = await fetch(`${host(cfg)}${path}`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: `{"body":${b},"head":${JSON.stringify({ ...head, signature: paytmSignature(b, merchantKey) })}}`,
    signal: AbortSignal.timeout(12_000),
  });
  return { res, j: await readJson(res) };
}

export const paytm: GatewayAdapter = {
  id: "paytm",
  async start({ order, cfg, txn, amountPaise, returnUrl }) {
    const mid = cfg.creds.mid ?? "";
    const { res, j } = await call(cfg, `/theia/api/v1/initiateTransaction?mid=${encodeURIComponent(mid)}&orderId=${encodeURIComponent(txn)}`, {
      requestType: "Payment", mid, websiteName: cfg.mode === "live" ? cfg.creds.website || "DEFAULT" : "WEBSTAGING",
      orderId: txn, callbackUrl: returnUrl, txnAmount: { value: rupees(amountPaise), currency: "INR" },
      userInfo: { custId: `C${order.customer.phone}`, mobile: order.customer.phone, ...(order.customer.email ? { email: order.customer.email } : {}) },
    }, { channelId: "WEB" });
    const body = j.body as { txnToken?: string; resultInfo?: { resultStatus?: string; resultMsg?: string } } | undefined;
    if (!res.ok || !body?.txnToken) throw new Error(`Paytm: ${body?.resultInfo?.resultMsg ?? String(j.raw ?? `HTTP ${res.status}`)}`);
    return { type: "form", action: `${host(cfg)}/theia/api/v1/showPaymentPage?mid=${encodeURIComponent(mid)}&orderId=${encodeURIComponent(txn)}`, fields: { mid, orderId: txn, txnToken: body.txnToken } };
  },
  async verify(cfg, txn) {
    const { res, j } = await call(cfg, "/merchant-status/api/v1/getPaymentStatus", { mid: cfg.creds.mid, orderId: txn });
    const body = j.body as { resultInfo?: { resultStatus?: string; resultCode?: string }; txnAmount?: string; txnId?: string } | undefined;
    if (!res.ok || !body?.resultInfo) throw new Error(`Paytm: HTTP ${res.status}`);
    const s = body.resultInfo.resultStatus ?? "";
    if (body.resultInfo.resultCode === "334" || body.resultInfo.resultCode === "843") return { status: "not_found", amountPaise: null, ref: null, raw: body };
    return { status: s === "TXN_SUCCESS" ? "success" : s === "TXN_FAILURE" ? "failure" : "pending", amountPaise: toPaise(body.txnAmount), ref: body.txnId ?? null, raw: body };
  },
  webhookTxn: (b) => (typeof b.ORDERID === "string" ? b.ORDERID : null),
  async test(cfg) {
    const { j } = await call(cfg, "/merchant-status/api/v1/getPaymentStatus", { mid: cfg.creds.mid, orderId: `GPTEST${Date.now()}` });
    const r = (j.body as { resultInfo?: { resultCode?: string; resultMsg?: string } } | undefined)?.resultInfo;
    if (!r) throw new Error("Paytm didn't answer");
    if (/checksum|signature|mid/i.test(r.resultMsg ?? "") && r.resultCode !== "334") throw new Error(`Paytm: ${r.resultMsg}`);
    return `Paytm ${cfg.mode} keys accepted`;
  },
};
