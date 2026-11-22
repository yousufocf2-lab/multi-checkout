// Settings → Shopify → Download CSV: every customer of the connected Shopify store (or those matching the search).
import type { LoaderFunctionArgs } from "@remix-run/node";
import { requireStore, requireViewer } from "~/lib/auth.server";
import { fetchShopifyCustomers, type ShopifyCustomer } from "~/lib/shopify.server";

const cell = (v: unknown) => { const s = v == null ? "" : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };

export async function loader({ request, params }: LoaderFunctionArgs) {
  const viewer = await requireViewer(request);
  const store = await requireStore(viewer, params.id);
  const q = (new URL(request.url).searchParams.get("q") ?? "").trim().slice(0, 100);
  const digits = q.replace(/\D/g, "");
  const query = digits.length >= 6 && digits.length >= q.replace(/\s/g, "").length - 3 ? `phone:*${digits.slice(-10)}*` : q;
  const all: ShopifyCustomer[] = [];
  let after: string | null = null;
  for (let i = 0; i < 100; i++) {
    const r = await fetchShopifyCustomers(store, { after, query, first: 250 });
    all.push(...r.customers);
    if (!r.next) break;
    after = r.next;
  }
  const head = ["Name", "Mobile", "Email", "Address", "City", "State", "Pincode", "Orders", "Amount spent (INR)", "Customer since", "Tags"];
  const rows = all.map((c) => [c.name, c.phone, c.email, c.address, c.city, c.state, c.pincode, c.orders, (c.spentPaise / 100).toFixed(2), c.createdAt.slice(0, 10), c.tags.join(", ")]);
  const csv = "﻿" + [head, ...rows].map((r) => r.map(cell).join(",")).join("\n");
  return new Response(csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="shopify-customers-${store.shopDomain ?? store.id}.csv"` } });
}
