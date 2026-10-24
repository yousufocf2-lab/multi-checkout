// Kept for links and orders from before multiple gateways: PayU's old callback URLs and the App Proxy signature check.
import crypto from "node:crypto";
import { handleReturn } from "./gateways/index.server";

export { PROXY_PATH, payUrl, proxyBase } from "./gateways/index.server";

/** PayU's post back on the old callback URLs (success or failure). Returns the order id, or null if it isn't ours. */
export async function handlePayuReturn(f: Record<string, string>, source: string): Promise<string | null> {
  if (!f.txnid) return null;
  const order = await handleReturn("payu", f.txnid, f, source);
  return order?.id ?? null;
}

/**
 * Shopify signs every App Proxy request: all query params except `signature`, sorted, "key=value"
 * (repeated keys joined with ","), concatenated without separators, HMAC-SHA256 with the app's client secret.
 */
export function verifyProxySignature(url: URL, secret: string | null | undefined) {
  const sig = url.searchParams.get("signature");
  if (!sig || !secret) return false;
  const keys = [...new Set([...url.searchParams.keys()].filter((k) => k !== "signature"))].sort();
  const msg = keys.map((k) => `${k}=${url.searchParams.getAll(k).join(",")}`).join("");
  const expected = crypto.createHmac("sha256", secret.trim()).update(msg).digest("hex");
  return sig.length === expected.length && crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
}
