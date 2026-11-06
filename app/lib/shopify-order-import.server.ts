import { and, eq, inArray } from "drizzle-orm";
import { db, orders, type OrderCustomer, type OrderLine, type Store } from "~/db.server";

type Row = Record<string, string>;

function parseCsv(text: string): Row[] {
  const input = text.replace(/^\uFEFF/, "");
  const rows: string[][] = [];
  let row: string[] = [], cell = "", quoted = false;
  for (let i = 0; i < input.length; i++) {
    const c = input[i];
    if (quoted) {
      if (c === '"' && input[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && input[i + 1] === "\n") i++;
      row.push(cell); cell = "";
      if (row.some((v) => v.trim())) rows.push(row);
      row = [];
    } else cell += c;
  }
  if (cell || row.length) { row.push(cell); if (row.some((v) => v.trim())) rows.push(row); }
  if (rows.length < 2) throw new Error("The order CSV has no order rows.");
  const headers = rows.shift()!.map((x) => x.trim());
  if (!headers.includes("Name") || !headers.includes("Created at") || !headers.includes("Financial Status")) throw new Error("Use Shopify's Orders export CSV (it needs Name, Created at and Financial Status columns).");
  return rows.map((values) => Object.fromEntries(headers.map((h, i) => [h, values[i] ?? ""])));
}

const get = (r: Row, ...keys: string[]) => { for (const k of keys) if ((r[k] ?? "").trim()) return r[k].trim(); return ""; };
const numeric = (v: string) => { const n = Number(v.replace(/,/g, "")); return Number.isFinite(n) ? n : null; };
const paise = (v: string) => { const n = numeric(v); return n == null ? 0 : Math.round(n * 100); };
const date = (v: string) => { const d = new Date(v); return Number.isNaN(d.getTime()) ? null : d; };
const simpleHash = (value: string) => { let h = 2166136261; for (const c of value) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return (h >>> 0).toString(36); };

export async function importShopifyOrdersCsv(store: Store, text: string) {
  const rows = parseCsv(text);
  if (rows.length > 50_000) throw new Error("Split a large order export into smaller date ranges (up to 50,000 CSV rows per import).");
  const grouped = new Map<string, Row[]>();
  for (const row of rows) {
    const name = get(row, "Name");
    if (!name) continue;
    const group = grouped.get(name) ?? [];
    group.push(row); grouped.set(name, group);
  }
  const names = [...grouped.keys()];
  if (!names.length) throw new Error("No Shopify orders with an order number were found.");
  if (names.length > 10_000) throw new Error("Import at most 10,000 orders at a time.");
  const records: (typeof orders.$inferInsert)[] = [];
  const importedKeys: string[] = [];
  for (const name of names) {
    const group = grouped.get(name)!;
    const head = group.find((r) => get(r, "Created at")) ?? group[0];
    const orderDate = date(get(head, "Created at"));
    if (!orderDate) continue;
    const currency = get(head, "Currency").toUpperCase();
    if (currency && currency !== "INR") throw new Error(`Order ${name} is in ${currency}. Growpefy order amounts currently import in INR only.`);
    const externalId = get(head, "Id", "Order ID", "Order");
    const key = externalId || `csv-${name}`;
    const financial = get(head, "Financial Status").toLowerCase().replace(/\s+/g, "_");
    const method = get(head, "Payment Method", "Payment Gateway", "Gateway").toLowerCase();
    const isCod = /cash on delivery|\bcod\b|cash_on_delivery/.test(method);
    const cancelled = Boolean(get(head, "Cancelled at"));
    const paid = ["paid", "partially_paid", "partially_refunded", "refunded"].includes(financial);
    const paymentMethod = isCod ? "cod" : financial === "partially_paid" ? "partial" : "prepaid";
    const status = cancelled || ["voided", "unpaid"].includes(financial) ? "failed" : financial === "pending" || financial === "authorized" ? "pending_payment" : isCod ? "cod_placed" : paid ? "paid" : "pending_payment";
    const total = paise(get(head, "Total"));
    const refundStatus = financial === "refunded" ? "full" : financial === "partially_refunded" ? "partial" : null;
    const refunded = refundStatus === "full" ? total : 0;
    const items: OrderLine[] = [];
    for (const line of group) {
      const title = get(line, "Lineitem name");
      const quantity = numeric(get(line, "Lineitem quantity"));
      if (!title || !quantity || quantity < 1) continue;
      const sku = get(line, "Lineitem sku");
      items.push({ variantId: `shopify:${sku || title}`, title, variantTitle: null, image: null, quantity: Math.round(quantity), pricePaise: paise(get(line, "Lineitem price")), comparePaise: null });
    }
    const first = group.find((r) => get(r, "Lineitem name")) ?? head;
    const firstLast = get(head, "Shipping Name", "Billing Name").split(/\s+/).filter(Boolean);
    const customer: OrderCustomer = {
      firstName: get(head, "Shipping First Name", "Billing First Name") || firstLast[0] || "Shopify",
      lastName: get(head, "Shipping Last Name", "Billing Last Name") || firstLast.slice(1).join(" "),
      phone: get(head, "Phone", "Shipping Phone", "Billing Phone").replace(/\D/g, "").slice(-15),
      email: get(head, "Email"),
      address1: get(head, "Shipping Address1", "Billing Address1"), address2: get(head, "Shipping Address2", "Billing Address2"),
      city: get(head, "Shipping City", "Billing City"), state: get(head, "Shipping Province Code", "Shipping Province", "Billing Province Code", "Billing Province"),
      pincode: get(head, "Shipping Zip", "Billing Zip"),
    };
    const tags = [...new Set(["Shopify History", ...get(head, "Tags").split(",").map((x) => x.trim()).filter(Boolean)])].slice(0, 12);
    const tracking = get(head, "Tracking Number");
    const createdId = `shopify-history-${store.id}-${simpleHash(key)}`;
    importedKeys.push(key);
    records.push({
      id: createdId, storeId: store.id, sessionId: null, checkoutChannel: "shopify_history", status, paymentMethod,
      customer, items, subtotal: paise(get(head, "Subtotal")), couponCode: get(head, "Discount Code") || null,
      couponDiscount: paise(get(head, "Discount Amount")), shipping: paise(get(head, "Shipping")), shippingTitle: get(head, "Shipping Method") || null,
      total, refunded, refundStatus, manualTags: tags, amountPaid: paid && !isCod && financial !== "partially_paid" ? total : null,
      shopifyOrderId: key, shopifyOrderName: name, courier: get(head, "Tracking Company") || null, awb: tracking || null,
      createdAt: orderDate, updatedAt: new Date(),
    });
  }
  if (!records.length) throw new Error("No valid order dates were found in this export.");
  const existing = new Set<string>();
  for (let i = 0; i < importedKeys.length; i += 500) {
    const batch = importedKeys.slice(i, i + 500);
    const found = await db.select({ key: orders.shopifyOrderId }).from(orders).where(and(eq(orders.storeId, store.id), inArray(orders.shopifyOrderId, batch)));
    for (const row of found) if (row.key) existing.add(row.key);
  }
  const fresh = records.filter((r) => !existing.has(r.shopifyOrderId ?? ""));
  for (let i = 0; i < fresh.length; i += 250) await db.insert(orders).values(fresh.slice(i, i + 250)).onConflictDoNothing();
  return { imported: fresh.length, alreadyPresent: records.length - fresh.length };
}
