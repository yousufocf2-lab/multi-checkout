// Draft orders: the store owner builds an order (phone / WhatsApp / Instagram), then either sends the customer a
// checkout link or turns it into an order right away (COD or already paid).
import crypto from "node:crypto";
import { and, desc, eq, ilike, inArray, or, sql } from "drizzle-orm";
import { catalogItems, catalogVariants, checkoutSessions, db, draftOrders, orders, type DraftDiscount, type DraftLine, type DraftOrder, type OrderCustomer, type Store } from "~/db.server";
import { coverOf, GP_PREFIX } from "./catalog.server";
import { finalizeOrder, newOrderId } from "./orders.server";
import { searchProducts } from "./platform.server";
import { storeBaseUrl } from "./urls.server";
import { draftName, draftTotals } from "./drafts";

const own = (s: Store) => s.platform === "growpefy";
/** Custom (typed) items can only be sold by stores that run their own catalog; Shopify needs real products. */
export const customItemsAllowed = own;
export { draftName, draftTotals };

export async function listDrafts(storeId: number, opts: { status?: string; q?: string } = {}) {
  const where = [eq(draftOrders.storeId, storeId)];
  if (opts.status === "open") where.push(inArray(draftOrders.status, ["open", "link_sent"]));
  else if (opts.status && opts.status !== "all") where.push(eq(draftOrders.status, opts.status as DraftOrder["status"]));
  if (opts.q?.trim()) {
    const q = `%${opts.q.trim()}%`;
    where.push(or(sql`${draftOrders.customer}->>'firstName' ilike ${q}`, sql`${draftOrders.customer}->>'phone' ilike ${q}`, sql`('#D' || ${draftOrders.number}) ilike ${q}`)!);
  }
  return db.select().from(draftOrders).where(and(...where)).orderBy(desc(draftOrders.createdAt)).limit(300);
}

export async function draftCounts(storeId: number) {
  const rows = await db.select({ status: draftOrders.status, n: sql<number>`count(*)::int` }).from(draftOrders).where(eq(draftOrders.storeId, storeId)).groupBy(draftOrders.status);
  const by = Object.fromEntries(rows.map((r) => [r.status, r.n])) as Record<string, number>;
  return { all: rows.reduce((n, r) => n + r.n, 0), open: (by.open ?? 0) + (by.link_sent ?? 0), completed: by.completed ?? 0, cancelled: by.cancelled ?? 0 };
}

export async function getDraft(storeId: number, id: number) {
  const [d] = await db.select().from(draftOrders).where(and(eq(draftOrders.storeId, storeId), eq(draftOrders.id, id))).limit(1);
  return d ?? null;
}

export type DraftInput = { items: DraftLine[]; customer: Partial<OrderCustomer>; discount: DraftDiscount | null; shippingPaise: number; shippingTitle: string | null; note: string | null; tags: string[] };

function clean(store: Store, input: DraftInput): DraftInput {
  const items = input.items.slice(0, 100).map((l) => ({
    variantId: String(l.variantId).slice(0, 120), productId: l.productId ? String(l.productId).slice(0, 120) : undefined,
    title: String(l.title || "Item").slice(0, 200), variantTitle: l.variantTitle ? String(l.variantTitle).slice(0, 120) : null,
    image: l.image && /^https?:\/\//.test(l.image) ? l.image : null,
    quantity: Math.max(1, Math.min(999, Math.round(Number(l.quantity) || 1))),
    pricePaise: Math.max(0, Math.round(Number(l.pricePaise) || 0)),
    comparePaise: l.comparePaise ? Math.max(0, Math.round(Number(l.comparePaise))) : null,
    ...(l.custom ? { custom: true } : {}),
  })).filter((l) => !l.custom || customItemsAllowed(store));
  const c = input.customer ?? {};
  const pick = (v: unknown, n = 200) => (typeof v === "string" ? v.trim().slice(0, n) : "");
  const discount = input.discount && Number(input.discount.value) > 0
    ? { type: input.discount.type === "flat" ? "flat" as const : "percent" as const, value: Math.max(0, Number(input.discount.value)), reason: pick(input.discount.reason, 120) || undefined }
    : null;
  return {
    items, discount,
    customer: { firstName: pick(c.firstName, 80), lastName: pick(c.lastName, 80), phone: pick(c.phone, 15).replace(/\D/g, "").slice(-10), email: pick(c.email, 120), address1: pick(c.address1, 300), address2: pick(c.address2, 300), city: pick(c.city, 80), state: pick(c.state, 40), pincode: pick(c.pincode, 6).replace(/\D/g, "") },
    shippingPaise: Math.max(0, Math.round(Number(input.shippingPaise) || 0)), shippingTitle: pick(input.shippingTitle, 80) || null,
    note: pick(input.note, 2000) || null, tags: (input.tags ?? []).map((t) => pick(t, 40)).filter(Boolean).slice(0, 20),
  };
}

export async function saveDraft(store: Store, input: DraftInput, id: number | null, by: string | null) {
  const data = clean(store, input);
  if (id) {
    const d = await getDraft(store.id, id);
    if (!d) throw new Error("This draft no longer exists.");
    if (d.status === "completed") throw new Error("This draft is already an order.");
    await db.update(draftOrders).set({ ...data, updatedAt: new Date() }).where(eq(draftOrders.id, id));
    return id;
  }
  // Next number per store, starting at 1001
  for (let i = 0; i < 3; i++) {
    const [{ n }] = await db.select({ n: sql<number>`coalesce(max(${draftOrders.number}), 1000)::int` }).from(draftOrders).where(eq(draftOrders.storeId, store.id));
    try {
      const [r] = await db.insert(draftOrders).values({ ...data, storeId: store.id, number: n + 1, createdBy: by }).returning({ id: draftOrders.id });
      return r.id;
    } catch (e) { if (i === 2) throw e; }
  }
  throw new Error("Couldn't save the draft");
}

function requireReady(d: DraftOrder, needAddress: boolean) {
  if (!d.items.length) throw new Error("Add at least one product.");
  const c = d.customer;
  if (!/^[6-9]\d{9}$/.test(c.phone ?? "")) throw new Error("Add the customer's 10-digit mobile number.");
  if (needAddress) {
    if (!c.firstName) throw new Error("Add the customer's name.");
    if ((c.address1 ?? "").length < 5 || !c.city || !/^\d{6}$/.test(c.pincode ?? "")) throw new Error("Add the full delivery address with a 6-digit pincode.");
  }
}

/** A checkout link with these products and the customer's details filled in; they pay with any method there. */
export async function sendDraftLink(store: Store, id: number) {
  const d = await getDraft(store.id, id);
  if (!d) throw new Error("Draft not found.");
  requireReady(d, false);
  const items = d.items.filter((l) => !l.custom).map((l) => ({ variantId: l.variantId, quantity: l.quantity }));
  if (!items.length) throw new Error("Checkout links can't carry custom items. Add store products, or create the order directly.");
  const sid = crypto.randomBytes(12).toString("base64url");
  await db.insert(checkoutSessions).values({ id: sid, storeId: store.id, items, customer: d.customer, tracking: { sourceUrl: `draft:${draftName(d.number)}` } });
  await db.update(draftOrders).set({ status: "link_sent", sessionId: sid, updatedAt: new Date() }).where(eq(draftOrders.id, d.id));
  const url = `${storeBaseUrl(store)}/c/${sid}`;
  const skipped = d.items.length - items.length;
  return { url, note: skipped ? `${skipped} custom item${skipped > 1 ? "s were" : " was"} left out of the link.` : null, discountNote: d.discount ? "The draft discount isn't added to the link; share a coupon code if you want to give it." : null };
}

/** Turns the draft into a real order: COD (collect on delivery) or already paid (UPI / bank transfer / cash). */
export async function completeDraft(store: Store, id: number, how: "cod" | "paid") {
  const d = await getDraft(store.id, id);
  if (!d) throw new Error("Draft not found.");
  if (d.status === "completed") throw new Error("This draft is already an order.");
  requireReady(d, true);
  const t = draftTotals(d);
  const c = d.customer;
  const customer: OrderCustomer = { firstName: c.firstName ?? "", lastName: c.lastName ?? "", phone: c.phone ?? "", email: c.email ?? "", address1: c.address1 ?? "", address2: c.address2 ?? "", city: c.city ?? "", state: c.state ?? "", pincode: c.pincode ?? "" };
  const items = d.items.map((l) => ({
    variantId: l.custom && !l.variantId.startsWith(GP_PREFIX) ? `${GP_PREFIX}custom-${crypto.randomBytes(3).toString("hex")}` : l.variantId,
    productId: l.productId, title: l.title, variantTitle: l.variantTitle, image: l.image, quantity: l.quantity, pricePaise: l.pricePaise, comparePaise: l.comparePaise,
  }));
  const orderId = newOrderId();
  const [order] = await db.insert(orders).values({
    id: orderId, storeId: store.id, status: how === "cod" ? "cod_placing" : "pending_payment", paymentMethod: how === "cod" ? "cod" : "prepaid",
    customer, items, subtotal: t.subtotal, offerDiscount: t.discount, shipping: t.shipping, shippingTitle: d.shippingTitle, total: t.total,
    tracking: { sourceUrl: `draft:${draftName(d.number)}` },
  }).returning();
  await db.update(draftOrders).set({ status: "completed", orderId, updatedAt: new Date() }).where(eq(draftOrders.id, d.id));
  const done = await finalizeOrder(store, order, how === "cod" ? { status: "cod_placed" } : { status: "paid", amountPaid: t.total, gateway: "manual" });
  return { orderId, name: done?.shopifyOrderName ?? null };
}

export async function cancelDraft(storeId: number, id: number) {
  await db.update(draftOrders).set({ status: "cancelled", updatedAt: new Date() }).where(and(eq(draftOrders.storeId, storeId), eq(draftOrders.id, id), inArray(draftOrders.status, ["open", "link_sent"])));
}

export async function deleteDraft(storeId: number, id: number) {
  await db.delete(draftOrders).where(and(eq(draftOrders.storeId, storeId), eq(draftOrders.id, id), sql`${draftOrders.status} <> 'completed'`));
}

/** Product search for the draft editor: one row per variant with its price. */
export async function searchDraftProducts(store: Store, q: string) {
  if (own(store)) {
    const rows = await db.select({ v: catalogVariants, i: catalogItems }).from(catalogVariants)
      .innerJoin(catalogItems, eq(catalogItems.id, catalogVariants.itemId))
      .where(and(eq(catalogVariants.storeId, store.id), eq(catalogItems.status, "active"), q.trim() ? or(ilike(catalogItems.title, `%${q.trim()}%`), ilike(catalogVariants.sku, `%${q.trim()}%`)) : undefined))
      .orderBy(desc(catalogItems.createdAt), catalogVariants.position).limit(40);
    return rows.map((r) => ({
      variantId: `${GP_PREFIX}${r.v.id}`, productId: `${GP_PREFIX}${r.i.id}`, title: r.i.title, variantTitle: r.v.title === "Default" ? null : r.v.title,
      image: r.v.imageUrl ?? coverOf(r.i.images), pricePaise: r.v.pricePaise, comparePaise: r.v.compareAtPaise, stock: r.v.stock, available: r.v.stock == null || r.v.stock > 0,
    }));
  }
  const products = await searchProducts(store, q);
  return products.flatMap((p) => p.variants.map((v) => ({
    variantId: v.id, productId: p.id, title: p.title, variantTitle: v.title || null, image: p.image, pricePaise: v.pricePaise, comparePaise: v.comparePaise, stock: null as number | null, available: v.available,
  }))).slice(0, 60);
}
