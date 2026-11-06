// Draft order maths shared by the server and the editor in the browser.
import type { DraftDiscount, DraftLine } from "~/db/schema";

export const draftName = (n: number) => `#D${n}`;

export function draftTotals(d: { items: DraftLine[]; discount: DraftDiscount | null; shippingPaise: number }) {
  const subtotal = d.items.reduce((n, l) => n + l.pricePaise * l.quantity, 0);
  const disc = d.discount ? Math.min(subtotal, d.discount.type === "percent" ? Math.round((subtotal * Math.min(100, d.discount.value)) / 100) : Math.round(d.discount.value * 100)) : 0;
  const total = Math.max(0, subtotal - disc) + d.shippingPaise;
  return { subtotal, discount: disc, shipping: d.shippingPaise, total, items: d.items.reduce((n, l) => n + l.quantity, 0) };
}
