// Website orders (Growpefy Store) are booked with the store's courier automatically when the courier supports it
// (Delhivery today). The AWB is saved on the order; live status then comes from the normal tracking sync.
import { and, eq, inArray, isNull, like, lt, ne, or } from "drizzle-orm";
import { catalogVariants, courierAccounts, db, orders, stores, type Order, type Store } from "~/db.server";
import { createDelhiveryShipment } from "./couriers/delhivery.server";
import { stateName } from "./states";
import { codAmount } from "./store-fulfil.server";

const RETRY_MS = 30 * 60_000; // a failed booking is tried again after 30 minutes
const WAIT_MS = 10 * 60_000; // give the customer 10 minutes (wrong address, cancel) before booking
const DEFAULT_WEIGHT_G = 500;

/** Should this order be booked now? COD orders waiting for WhatsApp confirmation wait for the customer's "Confirm". */
function readyToBook(store: Store, o: Order) {
  if (o.confirmStatus === "cancelled") return false;
  if (Date.now() - o.createdAt.getTime() < WAIT_MS) return false;
  const needsConfirm = store.confirmEnabled && store.confirmWhatsapp && (o.paymentMethod === "prepaid" ? store.confirmWaPrepaid : store.confirmWaCod);
  return !needsConfirm || o.confirmStatus === "confirmed" || o.paymentMethod === "prepaid";
}

async function weightOf(o: Order) {
  const ids = o.items.map((l) => Number(l.variantId.replace(/^gp:/, ""))).filter(Boolean);
  const rows = ids.length ? await db.select({ id: catalogVariants.id, w: catalogVariants.weightGrams }).from(catalogVariants).where(inArray(catalogVariants.id, ids)) : [];
  const w = new Map(rows.map((r) => [r.id, r.w]));
  return o.items.reduce((g, l) => g + (w.get(Number(l.variantId.replace(/^gp:/, ""))) ?? DEFAULT_WEIGHT_G) * l.quantity, 0);
}

export async function bookOrder(store: Store, o: Order, acc: { creds: { token?: string; pickupName?: string } }) {
  const c = o.customer;
  const r = await createDelhiveryShipment(acc.creds.token ?? "", acc.creds.pickupName ?? "", {
    order: o.shopifyOrderName?.replace(/^#/, "") ?? o.id, name: `${c.firstName} ${c.lastName}`.trim(), phone: c.phone, email: c.email || undefined,
    address: [c.address1, c.address2].filter(Boolean).join(", "), city: c.city, state: stateName(c.state) || c.state, pin: c.pincode,
    cod: o.paymentMethod !== "prepaid", codAmount: codAmount(o) / 100, total: o.total / 100,
    products: o.items.map((l) => `${l.title}${l.variantTitle ? ` (${l.variantTitle})` : ""} x${l.quantity}`).join(", "),
    quantity: o.items.reduce((n, l) => n + l.quantity, 0), weightGrams: await weightOf(o),
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

/** Books every waiting website order for stores whose Delhivery has a pickup location set. */
export async function runAutoShip() {
  const accs = await db.select().from(courierAccounts).where(and(eq(courierAccounts.courier, "delhivery"), eq(courierAccounts.status, "connected")));
  for (const acc of accs.filter((a) => a.creds.token && a.creds.pickupName)) {
    const [store] = await db.select().from(stores).where(and(eq(stores.id, acc.storeId), eq(stores.active, true))).limit(1);
    if (!store) continue;
    const list = await db.select().from(orders).where(and(
      eq(orders.storeId, store.id), inArray(orders.status, ["paid", "cod_placed"]), like(orders.shopifyOrderId, "gp:%"), isNull(orders.awb),
      or(isNull(orders.confirmStatus), ne(orders.confirmStatus, "cancelled")),
      or(isNull(orders.shipBookAt), lt(orders.shipBookAt, new Date(Date.now() - RETRY_MS))),
    )).limit(50);
    for (const o of list) if (readyToBook(store, o)) await bookOrder(store, o, acc);
  }
}

declare global { var __autoShip: NodeJS.Timeout | undefined; }
export function startAutoShip() {
  if (globalThis.__autoShip || !process.env.DATABASE_URL) return;
  globalThis.__autoShip = setInterval(() => void runAutoShip().catch((e) => console.error("[auto-ship]", e)), 5 * 60_000);
  globalThis.__autoShip.unref?.();
}

/** The customer cancelled (e.g. on WhatsApp): cancel the Delhivery shipment we booked, if it hasn't moved yet. */
export async function cancelBookedShipment(storeId: number, o: Pick<Order, "id" | "awb" | "courier">) {
  if (!o.awb || o.courier !== "delhivery") return;
  const [acc] = await db.select().from(courierAccounts).where(and(eq(courierAccounts.storeId, storeId), eq(courierAccounts.courier, "delhivery"))).limit(1);
  if (!acc?.creds.token) return;
  const { cancelDelhiveryShipment } = await import("./couriers/delhivery.server");
  const r = await cancelDelhiveryShipment(acc.creds.token, o.awb);
  if (r.ok) await db.update(orders).set({ shipStatus: "cancelled", shipStatusRaw: "Cancelled", shipStatusAt: new Date() }).where(eq(orders.id, o.id));
  else console.warn(`[auto-ship] cancel ${o.id} ${o.awb}: ${r.error}`);
}
