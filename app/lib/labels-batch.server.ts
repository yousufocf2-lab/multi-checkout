// Shipping label batches: "print new labels" picks every booked Delhivery shipment whose label hasn't been printed
// from Growpefy yet, prints them as one batch and remembers it, so nothing gets printed twice or missed.
import { and, asc, desc, eq, inArray, isNotNull, isNull, ne, sql } from "drizzle-orm";
import { catalogVariants, db, orders, type Store } from "~/db.server";
import { courierAccountsFor } from "./logistics.server";
import { GP_PREFIX } from "./catalog.server";
import { delhiveryPackingSlips } from "./couriers/delhivery.server";
import { mergePdfs, shiprocketLabelsPdf } from "./couriers/shiprocket-orders.server";
import { resolveLabel, type LabelConfig } from "./label-config";
import { labelsPdf, loadLogo, type LabelOrder } from "./labels.server";

const cols = {
  id: orders.id, awb: orders.awb, shopifyOrderName: orders.shopifyOrderName, paymentMethod: orders.paymentMethod, total: orders.total,
  amountPaid: orders.amountPaid, advance: orders.advance, customer: orders.customer, items: orders.items, createdAt: orders.createdAt,
  courierAccountId: orders.courierAccountId, courier: orders.courier, courierRef: orders.courierRef,
};
/** Booked with Delhivery or Shiprocket, not picked up, not cancelled, label not printed yet. */
const LABEL_COURIERS = ["delhivery", "shiprocket"];
const pendingWhere = (storeId: number) => and(
  eq(orders.storeId, storeId), inArray(orders.courier, LABEL_COURIERS), isNotNull(orders.awb), isNull(orders.labelPrintedAt),
  eq(orders.shipStatus, "pickup_pending"), ne(orders.status, "cancelled"),
);

export async function labelSummary(storeId: number) {
  const [p] = await db.select({ n: sql<number>`count(*)::int` }).from(orders).where(pendingWhere(storeId));
  const batches = await db.select({ batch: orders.labelBatch, n: sql<number>`count(*)::int`, at: sql<string>`max(${orders.labelPrintedAt})` })
    .from(orders).where(and(eq(orders.storeId, storeId), isNotNull(orders.labelBatch), sql`${orders.labelPrintedAt} > now() - interval '15 days'`))
    .groupBy(orders.labelBatch).orderBy(desc(sql`max(${orders.labelPrintedAt})`)).limit(8);
  return { pending: p?.n ?? 0, batches: batches.map((b) => ({ batch: b.batch!, count: b.n, at: new Date(b.at).toISOString() })) };
}

/** SKU of each Growpefy catalog variant in these orders. */
async function skusFor(list: LabelOrder[]) {
  const ids = [...new Set(list.flatMap((o) => o.items.map((l) => l.variantId)).filter((v) => v?.startsWith(GP_PREFIX)))];
  const nums = ids.map((v) => parseInt(v.slice(GP_PREFIX.length), 10)).filter((n) => n > 0);
  if (!nums.length) return new Map<string, string>();
  const rows = await db.select({ id: catalogVariants.id, sku: catalogVariants.sku }).from(catalogVariants).where(inArray(catalogVariants.id, nums));
  return new Map(rows.filter((r) => r.sku).map((r) => [`${GP_PREFIX}${r.id}`, r.sku!]));
}

type Row = LabelOrder & { courierAccountId?: number | null; courier?: string | null; courierRef?: string | null };

/** Delhivery labels in Growpefy's design; Shiprocket labels straight from Shiprocket (the courier's format); one PDF. */
async function render(store: Store, list: Row[], batch: string, cfgIn?: LabelConfig, slipsOverride?: Awaited<ReturnType<typeof delhiveryPackingSlips>>) {
  const sr = list.filter((o) => o.courier === "shiprocket" && o.courierRef);
  const own = list.filter((o) => !sr.includes(o));
  const parts: Uint8Array[] = [];
  if (own.length) parts.push(new Uint8Array(await renderOwn(store, own, batch, cfgIn, slipsOverride)));
  if (sr.length) {
    const accounts = (await courierAccountsFor(store.id)).filter((a) => a.courier === "shiprocket");
    for (const a of accounts) {
      const mine = sr.filter((o) => (o.courierAccountId ? o.courierAccountId === a.id : a.id === accounts[0]?.id));
      if (!mine.length) continue;
      const r = await shiprocketLabelsPdf(a.creds, mine.map((o) => o.courierRef!)).catch((e) => { console.error("[labels] shiprocket", e); return { pdf: null, missing: mine.map((o) => o.courierRef!) }; });
      if (r.pdf) parts.push(r.pdf);
      if (r.missing.length) console.warn(`[labels] store ${store.id}: no Shiprocket label for ${r.missing.length} order(s)`);
    }
  }
  if (!parts.length) throw new Response("Couldn't get the labels from the courier. Try again in a minute.", { status: 502 });
  return Buffer.from(await mergePdfs(parts));
}

async function renderOwn(store: Store, list: Row[], batch: string, cfgIn?: LabelConfig, slipsOverride?: Awaited<ReturnType<typeof delhiveryPackingSlips>>) {
  const cfg = cfgIn ?? resolveLabel(store.labelConfig);
  // Label data from each Delhivery account that booked these shipments
  const accounts = (await courierAccountsFor(store.id)).filter((a) => a.courier === "delhivery");
  const acc = accounts[0];
  let slips = slipsOverride;
  if (!slips) {
    slips = new Map();
    for (const a of accounts) {
      const awbs = list.filter((o) => o.awb && (o.courierAccountId ? o.courierAccountId === a.id : a.id === acc?.id)).map((o) => o.awb!);
      if (awbs.length && a.creds.token) for (const [k, v] of await delhiveryPackingSlips(a.creds.token, awbs)) slips.set(k, v);
    }
  }
  const [logo, skus] = await Promise.all([cfg.logo ? loadLogo(cfg.logoUrl) : Promise.resolve(null), skusFor(list)]);
  return labelsPdf(list, slips, cfg, { name: store.name, pickupName: acc?.creds.pickupName ?? null, logo, skus }, batch);
}

const batchName = (d: Date) => d.toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "numeric", minute: "2-digit", hour12: true });

/** Prints every label not printed yet (oldest first) as a new batch. */
export async function printNewLabels(store: Store) {
  const list = await db.select(cols).from(orders).where(pendingWhere(store.id)).orderBy(asc(orders.createdAt)).limit(300);
  if (!list.length) return null;
  const now = new Date();
  const batch = batchName(now);
  const pdf = await render(store, list, batch);
  await db.update(orders).set({ labelPrintedAt: now, labelBatch: batch }).where(and(inArray(orders.id, list.map((o) => o.id)), isNull(orders.labelPrintedAt)));
  console.log(`[labels] store ${store.id}: printed ${list.length} label(s), batch ${batch}`);
  return { pdf, batch, count: list.length };
}

/** Prints a past batch again (nothing is marked). */
export async function reprintBatch(store: Store, batch: string) {
  const list = await db.select(cols).from(orders).where(and(eq(orders.storeId, store.id), eq(orders.labelBatch, batch))).orderBy(asc(orders.createdAt));
  if (!list.length) return null;
  return { pdf: await render(store, list, batch), batch, count: list.length };
}

/** One shipment's label; marks it printed if it wasn't. */
export async function printOne(store: Store, orderId: string) {
  const [o] = await db.select({ ...cols, labelPrintedAt: orders.labelPrintedAt, labelBatch: orders.labelBatch, courier: orders.courier }).from(orders)
    .where(and(eq(orders.storeId, store.id), eq(orders.id, orderId))).limit(1);
  if (!o?.awb || !LABEL_COURIERS.includes(o.courier ?? "")) return null;
  const batch = o.labelBatch ?? `Single ${batchName(new Date())}`;
  const pdf = await render(store, [o], batch);
  if (!o.labelPrintedAt) await db.update(orders).set({ labelPrintedAt: new Date(), labelBatch: batch }).where(eq(orders.id, o.id));
  return { pdf, batch, count: 1 };
}

/** Designer preview: the store's latest real order (or a sample), drawn with an unsaved design. Nothing is marked. */
export async function previewLabel(store: Store, cfg: LabelConfig) {
  const [real] = await db.select(cols).from(orders).where(and(eq(orders.storeId, store.id), ne(orders.status, "cancelled"), eq(orders.paymentMethod, "cod")))
    .orderBy(desc(orders.createdAt)).limit(1);
  const sample: LabelOrder = real ? { ...real, awb: real.awb ?? "12345678901234" } : {
    id: "SAMPLE00000001", awb: "12345678901234", shopifyOrderName: "#1001", paymentMethod: "cod", total: 189900, amountPaid: null, advance: null, createdAt: new Date(),
    customer: { firstName: "Rahul", lastName: "Sharma", phone: "9876543210", email: "", address1: "Flat 402, Shanti Apartments, MG Road, near City Mall", address2: "", city: "Lucknow", state: "UP", pincode: "226001" },
    items: [{ variantId: "sample", title: "Sample product", variantTitle: "Black", image: null, quantity: 1, pricePaise: 189900, comparePaise: null }],
  };
  const slips = new Map([[sample.awb!, { awb: sample.awb!, sortCode: "LKO/CHB", destination: "Lucknow_Chinhat_D (Uttar Pradesh)", sellerName: null, sellerAddress: null, returnAddress: null }]]);
  return render(store, cfg.size === "a4x4" ? [sample, sample, sample, sample] : [sample], "Preview", cfg, slips);
}
