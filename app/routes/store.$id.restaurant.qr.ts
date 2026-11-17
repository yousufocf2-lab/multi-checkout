// Restaurant → Tables → printable QR cards. Each code opens the menu as dine-in for that table (?table=5).
import type { LoaderFunctionArgs } from "@remix-run/node";
import QRCode from "qrcode";
import { requireStore, requireViewer } from "~/lib/auth.server";
import { env } from "~/lib/env.server";
import { resolveRestaurant } from "~/lib/restaurant";

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export async function loader({ request, params }: LoaderFunctionArgs) {
  const viewer = await requireViewer(request);
  const store = await requireStore(viewer, params.id);
  if (store.businessType !== "restaurant") throw new Response("Not found", { status: 404 });
  const r = resolveRestaurant(store.restaurant);
  const site = store.storefrontDomain && store.storefrontDomainStatus === "live" ? `https://${store.storefrontDomain}` : `${env.appUrl.replace(/\/+$/, "")}/s/${store.slug}`;
  const only = new URL(request.url).searchParams.get("table");
  const tables = (only ? r.tables.filter((t) => t === only) : r.tables);
  const cards = await Promise.all(tables.map(async (t) => {
    const url = `${site}/?table=${encodeURIComponent(t)}`;
    const svg = await QRCode.toString(url, { type: "svg", margin: 1, errorCorrectionLevel: "M", color: { dark: "#1f1a17", light: "#ffffff" } });
    return `<article class="card"><p class="brand">${esc(store.name)}</p><div class="qr">${svg}</div><p class="t">Table ${esc(t)}</p><p class="h">Scan to see the menu and order</p><p class="u">${esc(url.replace(/^https?:\/\//, ""))}</p></article>`;
  }));
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Table QR codes · ${esc(store.name)}</title>
<style>
*{box-sizing:border-box}body{margin:0;font-family:system-ui,-apple-system,"Segoe UI",sans-serif;background:#f4f1ec;color:#1f1a17}
.bar{position:sticky;top:0;display:flex;gap:12px;align-items:center;padding:14px 20px;background:#fff;border-bottom:1px solid #e7e0d6}
.bar h1{font-size:17px;margin:0;flex:1}.bar button{height:40px;padding:0 18px;border:0;border-radius:10px;background:#1f1a17;color:#fff;font-weight:600;cursor:pointer}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:16px;padding:20px}
.card{background:#fff;border:1px solid #e7e0d6;border-radius:18px;padding:20px 18px;text-align:center;break-inside:avoid}
.brand{margin:0 0 10px;font-weight:800;font-size:16px}.qr svg{width:180px;height:180px}
.t{margin:8px 0 2px;font-size:26px;font-weight:800}.h{margin:0;font-size:13px;color:#6b625a}.u{margin:8px 0 0;font-size:10px;color:#9a9088;word-break:break-all}
.empty{padding:60px 20px;text-align:center;color:#6b625a}
@media print{.bar{display:none}body{background:#fff}.grid{grid-template-columns:repeat(3,1fr);gap:10px;padding:0}.card{border:1px dashed #bbb}}
</style></head><body>
<div class="bar"><h1>Table QR codes · ${tables.length} table${tables.length === 1 ? "" : "s"}</h1><button onclick="print()">Print</button></div>
${cards.length ? `<div class="grid">${cards.join("")}</div>` : `<p class="empty">Add your tables in Restaurant settings → Tables first.</p>`}
</body></html>`;
  return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
}
