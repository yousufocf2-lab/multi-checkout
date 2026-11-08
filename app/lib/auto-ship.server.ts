// Website orders (Growpefy Store) go to the store's courier automatically, like Shopify's courier apps:
//   Delhivery  – the shipment is booked and the AWB saved on the order
//   Shiprocket – the order is created in the Shiprocket panel; AWB, status and cancellations made there come back
// Live status then comes from the normal tracking sync (and Shiprocket's webhook when it's set up).
import { and, asc, eq, gt, inArray, isNotNull, isNull, like, lt, ne, notInArray, or } from "drizzle-orm";
import { catalogVariants, courierAccounts, db, orders, stores, type CourierAccount, type Order, type Store } from "~/db.server";
import { createDelhiveryShipment } from "./couriers/delhivery.server";
import { cancelShiprocketOrder, createShiprocketOrder, shiprocketOrderState } from "./couriers/shiprocket-orders.server";
import { mapStatusText } from "./couriers/common.server";
import { stateName } from "./states";
import { codAmount } from "./store-fulfil.server";
import { ruleAllows, shipRuleOf } from "./ship-rule";

const RETRY_MS = 30 * 60_000; // a failed booking is tried again after 30 minutes
const RETRY_PIN_MS = 24 * 3600_000; // the courier doesn't deliver to that pincode: try again next day, not every 30 minutes
const isPinError = (e: string) => /non[-\s]?serviceable|not serviceable|doesn't deliver to pincode/i.test(e);
const WAIT_MS = 10 * 60_000; // give the customer 10 minutes (wrong address, cancel) before booking
const DEFAULT_WEIGHT_G = 500;
const BOOKS = ["delhivery", "shiprocket"]; // couriers we can send orders to

/** Should this order be booked now? The store's shipping rule decides (all orders, or only confirmed ones). */
function readyToBook(store: Store, o: Order) {
  if (Date.now() - o.createdAt.getTime() < WAIT_MS) return false;
  return ruleAllows(shipRuleOf(store), o);
}

const variantNum = (id: string) => Number(id.replace(/^gp:/, ""));

async function variantInfo(o: Order) {
  const ids = o.items.map((l) => variantNum(l.variantId)).filter(Boolean);
  const rows = ids.length ? await db.select({ id: catalogVariants.id, w: catalogVariants.weightGrams, sku: catalogVariants.sku }).from(catalogVariants).where(inArray(catalogVariants.id, ids)) : [];
  const byId = new Map(rows.map((r) => [r.id, r]));
  const weight = o.items.reduce((g, l) => g + (byId.get(variantNum(l.variantId))?.w ?? DEFAULT_WEIGHT_G) * l.quantity, 0);
  const skus = new Map(o.items.map((l) => [l.variantId, byId.get(variantNum(l.variantId))?.sku ?? ""]));
  return { weight, skus };
}

const orderRef = (o: Order) => o.shopifyOrderName?.replace(/^#/, "") ?? o.id;

/** Can this courier account take orders? */
function bookable(a: CourierAccount) {
  if (a.status !== "connected" || a.creds.viaShopify) return false;
  if (a.courier === "delhivery") return Boolean(a.creds.token && a.creds.pickupName);
  if (a.courier === "shiprocket") return Boolean(a.creds.email && a.creds.password);
  return false;
}

export async function bookOrder(store: Store, o: Order, acc: Pick<CourierAccount, "courier" | "creds">) {
  const { weight, skus } = await variantInfo(o);
  if (acc.courier === "shiprocket") {
    const r = await createShiprocketOrder(acc.creds, { order: o, ref: orderRef(o), codPaise: codAmount(o), weightGrams: weight, skus });
    if (r.ok) {
      await db.update(orders).set({ courier: "shiprocket", courierRef: r.ref, awb: r.awb, shipStatusRaw: r.awb ? "AWB assigned" : "New in Shiprocket", shipStatusAt: new Date(), shipCheckedAt: new Date(0), shipError: null, shipBookAt: new Date() }).where(eq(orders.id, o.id));
      console.log(`[auto-ship] ${store.name} ${o.id} -> Shiprocket order ${r.ref}`);
    } else {
      await db.update(orders).set({ shipError: r.error, shipBookAt: new Date() }).where(eq(orders.id, o.id));
      console.warn(`[auto-ship] ${store.name} ${o.id}: ${r.error}`);
    }
    return r;
  }
  const c = o.customer;
  const r = await createDelhiveryShipment(acc.creds.token ?? "", acc.creds.pickupName ?? "", {
    order: orderRef(o), name: `${c.firstName} ${c.lastName}`.trim(), phone: c.phone, email: c.email || undefined,
    address: [c.address1, c.address2].filter(Boolean).join(", "), city: c.city, state: stateName(c.state) || c.state, pin: c.pincode,
    cod: o.paymentMethod !== "prepaid", codAmount: codAmount(o) / 100, total: o.total / 100,
    products: o.items.map((l) => `${l.title}${l.variantTitle ? ` (${l.variantTitle})` : ""} x${l.quantity}`).join(", "),
    quantity: o.items.reduce((n, l) => n + l.quantity, 0), weightGrams: weight,
  });
  if (r.ok) {
    await db.update(orders).set({ awb: r.awb, courier: "delhivery", shipStatus: "in_transit", shipStatusRaw: "Manifested", shipStatusAt: new Date(), shipCheckedAt: new Date(0), shipError: null, shipBookAt: new Date() }).where(eq(orders.id, o.id));
    console.log(`[auto-ship] ${store.name} ${o.id} -> Delhivery ${r.awb}`);
  } else {
    await db.update(orders).set({ shipError: r.error, shipBookAt: new Date() }).where(eq(orders.id, o.id));
    console.warn(`[auto-ship] ${store.name} ${o.id}: ${r.error}`);
  }
  return r;
}

/** Sends every waiting website order to the store's courier (the first connected one that can take orders). */
export async function runAutoShip() {
  const accs = (await db.select().from(courierAccounts).where(and(inArray(courierAccounts.courier, BOOKS), eq(courierAccounts.status, "connected"))).orderBy(asc(courierAccounts.createdAt)))
    .filter(bookable);
  // Every courier a store can book with, oldest connection first: the next one takes orders the first can't deliver
  const perStore = new Map<number, CourierAccount[]>();
  for (const a of accs) perStore.set(a.storeId, [...(perStore.get(a.storeId) ?? []), a]);
  for (const [storeId, couriers] of perStore) {
    const [store] = await db.select().from(stores).where(and(eq(stores.id, storeId), eq(stores.active, true))).limit(1);
    if (!store || shipRuleOf(store).mode === "off") continue; // the store ships by hand from the Orders page
    const list = await db.select().from(orders).where(and(
      eq(orders.storeId, store.id), inArray(orders.status, ["paid", "cod_placed"]), like(orders.shopifyOrderId, "gp:%"), isNull(orders.awb), isNull(orders.courierRef),
      or(isNull(orders.confirmStatus), ne(orders.confirmStatus, "cancelled")),
      or(isNull(orders.shipBookAt), lt(orders.shipBookAt, new Date(Date.now() - RETRY_MS))),
    )).limit(50);
    for (const o of list) {
      if (!readyToBook(store, o)) continue;
      let r: { ok: boolean; error?: string } = { ok: false };
      const errors: string[] = [];
      for (const acc of couriers) {
        r = await bookOrder(store, o, acc);
        if (r.ok) break;
        errors.push(r.error ?? "");
        if (!isPinError(r.error ?? "")) break; // only a pincode problem moves on to the next courier
      }
      if (!r.ok && errors.length && errors.every(isPinError)) {
        // Wait a day before trying again (shipBookAt in the future = skipped until then)
        await db.update(orders).set({
          shipError: errors.length > 1 ? `None of your couriers deliver to pincode ${o.customer.pincode}. Book it by hand.` : errors[0],
          shipBookAt: new Date(Date.now() + RETRY_PIN_MS - RETRY_MS),
        }).where(eq(orders.id, o.id));
      }
    }
  }
  await pullShiprocketChanges().catch((e) => console.error("[auto-ship] shiprocket pull", e));
}

/** Not-yet-shipped Shiprocket statuses: shown as they are, without counting as "in transit". */
const BEFORE_PICKUP = /^(new|invoiced|ready to ship|awb assigned|label generated|manifest generated|pickup (scheduled|queued|generated|rescheduled|error|exception)|out for pickup|pickup booked|on hold|pending)$/i;

/** Reads back what changed in the Shiprocket panel: courier/AWB assigned, cancelled, picked up. */
async function pullShiprocketChanges() {
  const since = new Date(Date.now() - 30 * 86400_000);
  const list = await db.select({ id: orders.id, storeId: orders.storeId, ref: orders.courierRef, awb: orders.awb, raw: orders.shipStatusRaw }).from(orders).where(and(
    eq(orders.courier, "shiprocket"), isNotNull(orders.courierRef), gt(orders.createdAt, since),
    or(isNull(orders.shipStatus), notInArray(orders.shipStatus, ["delivered", "rto", "returned", "cancelled"])),
    // AWB orders get live status from tracking; we only look until the courier picks it up
    or(isNull(orders.awb), isNull(orders.shipStatus)),
  )).limit(200);
  const accs = new Map<number, CourierAccount | null>();
  for (const o of list) {
    if (!accs.has(o.storeId)) {
      const [a] = await db.select().from(courierAccounts).where(and(eq(courierAccounts.storeId, o.storeId), eq(courierAccounts.courier, "shiprocket"))).limit(1);
      accs.set(o.storeId, a && a.status === "connected" ? a : null);
    }
    const acc = accs.get(o.storeId);
    if (!acc) continue;
    const s = await shiprocketOrderState(acc.creds, o.ref!).catch(() => null);
    if (!s) continue;
    const raw = s.status.slice(0, 100) || o.raw || null;
    const status = /cancel/i.test(s.status) ? "cancelled" : BEFORE_PICKUP.test(s.status.trim()) ? null : mapStatusText(s.status);
    if (raw === o.raw && (s.awb ?? null) === (o.awb ?? null) && !status) continue;
    await db.update(orders).set({
      ...(s.awb && s.awb !== o.awb ? { awb: s.awb, shipCheckedAt: new Date(0) } : {}),
      shipStatusRaw: raw, shipStatusAt: new Date(),
      ...(status ? { shipStatus: status } : {}),
    }).where(eq(orders.id, o.id));
  }
}

declare global { var __autoShip: NodeJS.Timeout | undefined; }
export function startAutoShip() {
  if (globalThis.__autoShip || !process.env.DATABASE_URL) return;
  globalThis.__autoShip = setInterval(() => {
    void runAutoShip().catch((e) => console.error("[auto-ship]", e));
    // New orders reach the calling team even when nobody has the page open
    void import("./calls.server").then((m) => m.assignAllCalls()).catch((e) => console.error("[calls]", e));
  }, 5 * 60_000);
  globalThis.__autoShip.unref?.();
}

/** The customer cancelled (e.g. on WhatsApp): cancel it at the courier too, if it hasn't moved yet. */
export async function cancelBookedShipment(storeId: number, o: Pick<Order, "id" | "awb" | "courier"> & { courierRef?: string | null }) {
  if (o.courier === "shiprocket") {
    const [row] = o.courierRef === undefined ? await db.select({ ref: orders.courierRef }).from(orders).where(eq(orders.id, o.id)).limit(1) : [{ ref: o.courierRef }];
    const [acc] = await db.select().from(courierAccounts).where(and(eq(courierAccounts.storeId, storeId), eq(courierAccounts.courier, "shiprocket"))).limit(1);
    if (!row?.ref || !acc) return;
    const r = await cancelShiprocketOrder(acc.creds, row.ref);
    if (r.ok) await db.update(orders).set({ shipStatus: "cancelled", shipStatusRaw: "Cancelled", shipStatusAt: new Date() }).where(eq(orders.id, o.id));
    else console.warn(`[auto-ship] shiprocket cancel ${o.id}: ${r.error}`);
    return;
  }
  if (!o.awb || o.courier !== "delhivery") return;
  const [acc] = await db.select().from(courierAccounts).where(and(eq(courierAccounts.storeId, storeId), eq(courierAccounts.courier, "delhivery"))).limit(1);
  if (!acc?.creds.token) return;
  const { cancelDelhiveryShipment } = await import("./couriers/delhivery.server");
  const r = await cancelDelhiveryShipment(acc.creds.token, o.awb);
  if (r.ok) await db.update(orders).set({ shipStatus: "cancelled", shipStatusRaw: "Cancelled", shipStatusAt: new Date() }).where(eq(orders.id, o.id));
  else console.warn(`[auto-ship] cancel ${o.id} ${o.awb}: ${r.error}`);
}
