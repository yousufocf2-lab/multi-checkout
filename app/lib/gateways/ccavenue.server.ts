// CCAvenue: encRequest = AES-128-CBC(hex) of "merchant_id=..&order_id=..", key = MD5(working key), IV = 0x00..0x0f
// (as in CCAvenue's kits). The return post carries encResp, decrypted with the same key (only CCAvenue can make it).
// Status: orderStatusTracker API (same encryption, JSON).
import crypto from "node:crypto";
import type { StoreGateway } from "~/db.server";
import { live, rupees, toPaise, type GatewayAdapter, type Verification } from "./types";

const IV = Buffer.from([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);
const keyOf = (wk: string) => crypto.createHash("md5").update(wk).digest();
export function ccEncrypt(text: string, wk: string) {
  const c = crypto.createCipheriv("aes-128-cbc", keyOf(wk), IV);
  return c.update(text, "utf8", "hex") + c.final("hex");
}
export function ccDecrypt(hex: string, wk: string) {
  const d = crypto.createDecipheriv("aes-128-cbc", keyOf(wk), IV);
  return d.update(hex, "hex", "utf8") + d.final("utf8");
}
const host = (cfg: StoreGateway) => (live(cfg) ? "https://secure.ccavenue.com" : "https://test.ccavenue.com");
const api = (cfg: StoreGateway) => (live(cfg) ? "https://api.ccavenue.com" : "https://apitest.ccavenue.com");

const mapStatus = (s: string): Verification["status"] => {
  const v = s.toLowerCase();
  if (v === "success" || v === "successful" || v === "shipped") return "success";
  if (["failure", "aborted", "invalid", "timeout", "unsuccessful", "cancelled", "auto-cancelled", "auto-reversed"].includes(v)) return "failure";
  return "pending";
};

export const ccavenue: GatewayAdapter = {
  id: "ccavenue",
  async start({ order, cfg, txn, amountPaise, returnUrl }) {
    const { merchantId, accessCode, workingKey } = cfg.creds;
    if (!merchantId || !accessCode || !workingKey) throw new Error("CCAvenue merchant ID, access code and working key are not set");
    const c = order.customer;
    const q = new URLSearchParams({
      merchant_id: merchantId, order_id: txn, currency: "INR", amount: rupees(amountPaise),
      redirect_url: returnUrl, cancel_url: returnUrl, language: "EN",
      billing_name: `${c.firstName} ${c.lastName}`.trim(), billing_tel: c.phone, billing_email: c.email || "",
      billing_address: c.address1, billing_city: c.city, billing_zip: c.pincode, billing_country: "India",
      merchant_param1: order.id,
    });
    return { type: "form", action: `${host(cfg)}/transaction/transaction.do?command=initiateTransaction`, fields: { encRequest: ccEncrypt(q.toString(), workingKey), access_code: accessCode } };
  },
  async verify(cfg, txn) {
    const { accessCode, workingKey } = cfg.creds;
    if (!accessCode || !workingKey) throw new Error("CCAvenue access code and working key are not set");
    const res = await fetch(`${api(cfg)}/apis/servlet/DoWebTrans`, {
      method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ enc_request: ccEncrypt(JSON.stringify({ order_no: txn }), workingKey), access_code: accessCode, command: "orderStatusTracker", request_type: "JSON", response_type: "JSON", version: "1.2" }),
      signal: AbortSignal.timeout(10_000),
    });
    const text = await res.text();
    const p = new URLSearchParams(text);
    if (p.get("status") !== "0" || !p.get("enc_response")) return { status: "not_found", amountPaise: null, ref: null, raw: text.slice(0, 300) };
    const j = JSON.parse(ccDecrypt(p.get("enc_response")!.trim(), workingKey)) as Record<string, unknown>;
    const s = String(j.order_status ?? j.status ?? "");
    return { status: mapStatus(s), amountPaise: toPaise(j.order_amt ?? j.order_amount), ref: j.reference_no ? String(j.reference_no) : null, raw: j };
  },
  fromReturn(cfg, f, txn) {
    if (!f.encResp || !cfg.creds.workingKey) return null;
    try {
      const r = Object.fromEntries(new URLSearchParams(ccDecrypt(f.encResp, cfg.creds.workingKey)));
      if (r.order_id !== txn) return null;
      return { status: mapStatus(r.order_status ?? ""), amountPaise: toPaise(r.amount), debitedPaise: toPaise(r.mer_amount ?? r.amount), ref: r.tracking_id ?? null, raw: r };
    } catch {
      return null;
    }
  },
  async test(cfg) {
    if (!cfg.creds.merchantId || !cfg.creds.accessCode || !cfg.creds.workingKey) throw new Error("CCAvenue merchant ID, access code and working key are not set");
    ccDecrypt(ccEncrypt("check", cfg.creds.workingKey), cfg.creds.workingKey);
    return `CCAvenue ${cfg.mode} details saved. Place a ₹1 test payment to confirm`;
  },
};
