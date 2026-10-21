import type { LoaderFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";
import { getOrderWithStore } from "~/lib/orders.server";
import { payNowPaise } from "~/lib/payment-methods";
import { proxyBase, payuForm, verifyProxySignature } from "~/lib/payu-flow.server";
import { formatINR } from "~/lib/pricing";
import { storeBaseUrl } from "~/lib/urls.server";

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/**
 * Shopify App Proxy: the customer is on https://<store>/apps/growpefy/pay/<order>.
 * This page sends the PayU form, so PayU sees the store's registered website.
 */
export async function loader({ request, params }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const row = await getOrderWithStore(params.orderId!);
  if (!row) throw new Response("Order not found", { status: 404 });
  const { order, store } = row;
  if (url.searchParams.get("shop") !== store.shopDomain || !verifyProxySignature(url, store.clientSecret)) {
    throw new Response("This payment link isn't valid. Go back to the checkout and try again.", { status: 401 });
  }
  if (order.status !== "pending_payment") return redirect(`${storeBaseUrl(store)}/order/${order.id}`);

  const { action, fields } = await payuForm(store, order, `${proxyBase(store)}/payu/callback?o=${order.id}`);
  const rest = order.paymentMethod === "partial" ? order.total - payNowPaise(order) : 0;
  const color = /^#[0-9a-f]{6}$/i.test(store.primaryColor) ? store.primaryColor : "#111827";
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Opening secure payment</title>
<style>body{margin:0;min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:#fff;color:#1c2430;text-align:center;padding:24px}
.s{width:44px;height:44px;border-radius:50%;border:4px solid #e5e7eb;border-top-color:${color};animation:r .8s linear infinite;margin:20px auto}@keyframes r{to{transform:rotate(360deg)}}
.l{max-height:40px;max-width:160px;object-fit:contain}.n{font-size:17px;font-weight:600}p{margin:6px 0;color:#4a5361;font-size:14px}button{background:${color};color:#fff;border:0;border-radius:10px;padding:12px 20px;font-size:15px;font-weight:600}</style></head>
<body>${store.logoUrl ? `<img class="l" src="${esc(store.logoUrl)}" alt="${esc(store.name)}">` : `<div class="n">${esc(store.name)}</div>`}
<div class="s" role="status" aria-label="Opening payment"></div><div class="n">Opening secure payment for ${esc(formatINR(payNowPaise(order)))}</div>
${rest > 0 ? `<p>Advance now. The remaining ${esc(formatINR(rest))} is paid in cash on delivery.</p>` : ""}<p>Don't close this page or press back.</p>
<form id="f" method="post" action="${esc(action)}">${Object.entries(fields).map(([k, v]) => `<input type="hidden" name="${esc(k)}" value="${esc(String(v))}">`).join("")}<noscript><button>Continue to payment</button></noscript></form>
<script>document.getElementById("f").submit()</script></body></html>`;
  // text/html (not application/liquid) so Shopify returns the page as it is, without the theme
  return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
}
