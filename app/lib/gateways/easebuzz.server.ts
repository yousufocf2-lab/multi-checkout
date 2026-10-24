// Easebuzz hosted checkout, as in Easebuzz's official PHP kit:
// POST {pay}/payment/initiateLink (hash key|txnid|amount|productinfo|firstname|email|udf1..udf10|salt) → access key → {pay}/pay/{key}.
// Return post is signed with the reverse hash salt|status|udf10..udf1|email|firstname|productinfo|amount|txnid|key.
// Status: POST {dashboard}/transaction/v2/retrieve with hash key|txnid|salt.
import crypto from "node:crypto";
import type { StoreGateway } from "~/db.server";
import { emailFor, live, readJson, rupees, toPaise, type GatewayAdapter, type Verification } from "./types";

const sha512 = (s: string) => crypto.createHash("sha512").update(s).digest("hex");
const payBase = (cfg: StoreGateway) => (live(cfg) ? "https://pay.easebuzz.in/" : "https://testpay.easebuzz.in/");
const dashBase = (cfg: StoreGateway) => (live(cfg) ? "https://dashboard.easebuzz.in/" : "https://testdashboard.easebuzz.in/");
const UDF = ["udf1", "udf2", "udf3", "udf4", "udf5", "udf6", "udf7", "udf8", "udf9", "udf10"];

const mapStatus = (s: string): Verification["status"] => {
  const v = s.toLowerCase();
  if (v === "success") return "success";
  if (["failure", "failed", "usercancelled", "dropped", "bounced"].includes(v)) return "failure";
  return "pending";
};

export const easebuzz: GatewayAdapter = {
  id: "easebuzz",
  async start({ store, order, cfg, txn, amountPaise, returnUrl }) {
    const { key, salt } = cfg.creds;
    if (!key || !salt) throw new Error("Easebuzz key and salt are not set");
    const p: Record<string, string> = {
      key, txnid: txn, amount: rupees(amountPaise), productinfo: `${store.name} order`.slice(0, 100).replace(/[^\w .,-]/g, ""),
      firstname: (order.customer.firstName || "Customer").replace(/[^A-Za-z .]/g, "").slice(0, 60) || "Customer",
      email: emailFor(order), phone: order.customer.phone, surl: returnUrl, furl: returnUrl, udf1: order.id,
    };
    const seq = ["key", "txnid", "amount", "productinfo", "firstname", "email", ...UDF];
    p.hash = sha512(`${seq.map((f) => p[f] ?? "").join("|")}|${salt}`);
    const res = await fetch(`${payBase(cfg)}payment/initiateLink`, {
      method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: new URLSearchParams(p), signal: AbortSignal.timeout(12_000),
    });
    const j = await readJson(res);
    if (Number(j.status) !== 1 || typeof j.data !== "string") throw new Error(`Easebuzz: ${typeof j.data === "string" ? j.data : String(j.error_desc ?? j.raw ?? `HTTP ${res.status}`)}`);
    return { type: "redirect", url: `${payBase(cfg)}pay/${j.data}` };
  },
  async verify(cfg, txn) {
    const { key, salt } = cfg.creds;
    if (!key || !salt) throw new Error("Easebuzz key and salt are not set");
    const res = await fetch(`${dashBase(cfg)}transaction/v2/retrieve`, {
      method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: new URLSearchParams({ key, txnid: txn, hash: sha512(`${key}|${txn}|${salt}`) }), signal: AbortSignal.timeout(10_000),
    });
    const j = await readJson(res);
    // The kit returns the gateway's JSON as is; find this transaction wherever it sits
    const found: Record<string, unknown>[] = [];
    const walk = (v: unknown) => {
      if (Array.isArray(v)) return v.forEach(walk);
      if (v && typeof v === "object") {
        const o = v as Record<string, unknown>;
        if (o.txnid === txn && o.status) found.push(o);
        Object.values(o).forEach(walk);
      }
    };
    walk(j);
    const best = found.find((t) => String(t.status).toLowerCase() === "success") ?? found[0];
    if (!best) return { status: "not_found", amountPaise: null, ref: null, raw: j };
    return { status: mapStatus(String(best.status)), amountPaise: toPaise(best.amount), debitedPaise: toPaise(best.net_amount_debit ?? best.amount), ref: best.easepayid ? String(best.easepayid) : null, raw: best };
  },
  fromReturn(cfg, f, txn) {
    const { key, salt } = cfg.creds;
    if (!f.hash || !salt || f.txnid !== txn || f.key !== key) return null;
    const rev = sha512([salt, f.status ?? "", ...[...UDF].reverse().map((u) => f[u] ?? ""), f.email ?? "", f.firstname ?? "", f.productinfo ?? "", f.amount ?? "", f.txnid ?? "", f.key ?? ""].join("|"));
    if (rev !== String(f.hash).toLowerCase()) return null;
    return { status: mapStatus(f.status ?? ""), amountPaise: toPaise(f.amount), debitedPaise: toPaise(f.net_amount_debit ?? f.amount), ref: f.easepayid ?? null, raw: f };
  },
  webhookTxn: (b) => (typeof b.txnid === "string" ? b.txnid : null),
  async test(cfg) {
    const v = await easebuzz.verify(cfg, `GPTEST${Date.now()}`);
    const raw = JSON.stringify(v.raw ?? "").toLowerCase();
    if (/invalid|hash mismatch|unauthori[sz]ed|not authorized/.test(raw)) throw new Error("Easebuzz rejected the key or salt");
    return `Easebuzz ${cfg.mode} keys accepted`;
  },
};
