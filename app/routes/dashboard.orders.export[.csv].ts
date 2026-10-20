import type { LoaderFunctionArgs } from "@remix-run/node";
import { orderValuePaise } from "~/lib/payment-methods";
import { desc } from "drizzle-orm";
import { db, orders } from "~/db.server";
import { requireViewer, viewerStores } from "~/lib/auth.server";
import { orderFilters } from "~/lib/orders-list.server";
import { dashboardScope } from "~/lib/selection.server";
import { stateName } from "~/lib/states";

/** CSV of the orders matching the current filters (up to 20,000 rows). */
export async function loader({ request }: LoaderFunctionArgs) {
  const all = await viewerStores(await requireViewer(request));
  const { scope } = await dashboardScope(request, all);
  const { where } = await orderFilters(scope, new URL(request.url).searchParams);
  const rows = await db.select().from(orders).where(where).orderBy(desc(orders.createdAt)).limit(20_000);
  const names = new Map(scope.map((s) => [s.id, s.name]));
  const rs = (p: number | null) => (p == null ? "" : (p / 100).toFixed(2));
  const esc = (v: unknown) => {
    const s = String(v ?? "");
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const head = ["Date (IST)", "Order", "Shopify order", "Store", "Status", "Payment", "Customer", "Phone", "Email", "City", "State", "Pincode",
    "Items", "Item total", "Payment discount", "Coupon", "Coupon discount", "Bank discount", "Mix & Match discount", "Shipping", "Amount", "Refunded"];
  const lines = rows.map((o) => [
    o.createdAt.toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }), o.id, o.shopifyOrderName ?? "", names.get(o.storeId) ?? "",
    o.status, o.paymentMethod === "cod" ? "COD" : o.paymentMethod === "partial" ? `Partial COD (advance ${((o.amountPaid ?? o.advance ?? 0) / 100).toFixed(2)})` : "Prepaid", `${o.customer.firstName} ${o.customer.lastName}`.trim(), o.customer.phone, o.customer.email,
    o.customer.city, stateName(o.customer.state), o.customer.pincode,
    o.items.map((l) => `${l.title}${l.variantTitle ? ` (${l.variantTitle})` : ""} x${l.quantity}`).join("; "),
    rs(o.subtotal), rs(o.paymentDiscount), o.couponCode ?? "", rs(o.couponDiscount), rs(o.bankDiscount), rs(o.offerDiscount), rs(o.shipping), rs(orderValuePaise(o)), rs(o.refunded),
  ].map(esc).join(","));
  const csv = "﻿" + [head.join(","), ...lines].join("\n");
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="orders-${new Date().toISOString().slice(0, 10)}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
