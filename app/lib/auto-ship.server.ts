// Website orders (Growpefy Store) go to the store's courier automatically, like Shopify's courier apps:
//   Delhivery  – the shipment is booked and the AWB saved on the order
//   Shiprocket – the order is created in the Shiprocket panel; AWB, status and cancellations made there come back
// Live status then comes from the normal tracking sync (and Shiprocket's webhook when it's set up).
import { and, asc, eq, gt, inArray, isNotNull, isNull, like, lt, ne, notInArray, or, sql, type SQL } from "drizzle-orm";
import { catalogVariants, courierAccounts, db, orders, stores, type CourierAccount, type Order, type Store } from "~/db.server";
import { createDelhiveryShipment } from "./couriers/delhivery.server";
import { assignShiprocketCourier, cancelShiprocketOrder, createShiprocketOrder, shiprocketOrderState } from "./couriers/shiprocket-orders.server";
import { mapStatusText } from "./couriers/common.server";
import { stateName } from "./states";
import { codAmount } from "./store-fulfil.server";
import { ruleAllows, shipRuleOf, type ShipRule } from "./ship-rule";
import { accountForOrder } from "./logistics.server";

const RETRY_MS = 30 * 60_000; // a failed booking is tried again after 30 minutes
const RETRY_PIN_MS = 24 * 3600_000; // the courier doesn't deliver to that pincode: try again next day, not every 30 minutes
const isPinError = (e: string) => /non[-\s]?serviceable|not serviceable|doesn't deliver to pincode/i.test(e);
const WAIT_MS = 10 * 60_000; // give the customer 10 minutes (wrong address, cancel) before booking
const DEFAULT_WEIGHT_G = 500;
const BOOKS = ["delhivery", "shiprocket"]; // couriers we can send orders to

/** Should this order be booked now? The store's shipping rule decides (all orders, or only confirmed ones). */
/** Orders a courier never carries: digital downloads and restaurant orders (own riders / pickup / dine-in). */
export const shipsNothing = (o: Pick<Order, "items" | "fulfilment">) => Boolean(o.fulfilment) || (o.items.some((l) => l.digital) && o.items.every((l) => l.digital || l.free));

function readyToBook(store: Store, o: Order) {
  if (shipsNothing(o)) return false;
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

export async function bookOrder(store: Store, o: Order, acc: Pick<CourierAccount, "courier" | "creds"> & { id?: number }) {
  const { weight, skus } = await variantInfo(o);
  if (acc.courier === "shiprocket") {
    const r = await createShiprocketOrder(acc.creds, { order: o, ref: orderRef(o), codPaise: codAmount(o), weightGrams: weight, skus });
    if (r.ok) {
      await db.update(orders).set({ courier: "shiprocket", courierAccountId: acc.id ?? null, courierRef: r.ref, awb: r.awb, shipStatusRaw: r.awb ? "AWB assigned" : "New in Shiprocket", shipStatusAt: new Date(), shipCheckedAt: new Date(0), shipError: null, shipBookAt: new Date() }).where(eq(orders.id, o.id));
      console.log(`[auto-ship] ${store.name} ${o.id} -> Shiprocket order ${r.ref}`);
      // Pick the courier (cheapest by default) and get the AWB straight away
      if (!r.awb) await assignSr(store.name, o.id, acc.creds, r.ref, r.shipmentId);
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
    await db.update(orders).set({ awb: r.awb, courier: "delhivery", courierAccountId: acc.id ?? null, shipStatus: "pickup_pending", shipStatusRaw: "Manifested", shipStatusAt: new Date(), shipCheckedAt: new Date(0), shipError: null, shipBookAt: new Date() }).where(eq(orders.id, o.id));
    console.log(`[auto-ship] ${store.name} ${o.id} -> Delhivery ${r.awb}`);
  } else {
    await db.update(orders).set({ shipError: r.error, shipBookAt: new Date() }).where(eq(orders.id, o.id));
    console.warn(`[auto-ship] ${store.name} ${o.id}: ${r.error}`);
  }
  return r;
}

/** Assigns a courier in Shiprocket and saves the AWB on the order (or the reason it couldn't). */
async function assignSr(storeName: string, orderId: string, creds: CourierAccount["creds"], ref: string, shipmentId?: string | null) {
  const a = await assignShiprocketCourier(creds, ref, shipmentId);
  if (a.ok) {
    await db.update(orders).set({ awb: a.awb, shipStatus: "pickup_pending", shipStatusRaw: `AWB assigned · ${a.courierName}`.slice(0, 120), shipStatusAt: new Date(), shipCheckedAt: new Date(0), shipError: null }).where(eq(orders.id, orderId));
    console.log(`[auto-ship] ${storeName} ${orderId} -> ${a.courierName} ${a.awb}${a.ratePaise ? ` (₹${a.ratePaise / 100})` : ""}`);
  } else if (!a.skip) {
    await db.update(orders).set({ shipError: a.error.slice(0, 500), shipBookAt: new Date() }).where(eq(orders.id, orderId));
    console.warn(`[auto-ship] ${storeName} ${orderId}: ${a.error}`);
  }
  return a;
}

/** Sends every waiting website order to the store's courier (the first connected one that can take orders). */
export async function runAutoShip() {
  const accs = (await db.select().from(courierAccounts).where(and(inArray(courierAccounts.courier, BOOKS), eq(courierAccounts.status, "connected"), eq(courierAccounts.autoShip, true)))
    .orderBy(asc(courierAccounts.priority), asc(courierAccounts.createdAt)))
    .filter(bookable);
  // Every account a store books with, in its chosen order: when one fails, the next one tries
  const perStore = new Map<number, CourierAccount[]>();
  for (const a of accs) perStore.set(a.storeId, [...(perStore.get(a.storeId) ?? []), a]);
  for (const [storeId, couriers] of perStore) {
    const [store] = await db.select().from(stores).where(and(eq(stores.id, storeId), eq(stores.active, true))).limit(1);
    if (!store || shipRuleOf(store).mode === "off") continue; // the store ships by hand from the Orders page
    // Only orders the rule already clears, oldest first. (Before, the first 50 open orders were read in no order:
    // a store with many orders still waiting for a call could leave confirmed orders outside those 50 for hours.)
    const list = await db.select().from(orders).where(and(
      eq(orders.storeId, store.id), inArray(orders.status, ["paid", "cod_placed"]), like(orders.shopifyOrderId, "gp:%"), isNull(orders.awb), isNull(orders.courierRef),
      or(isNull(orders.confirmStatus), ne(orders.confirmStatus, "cancelled"), eq(orders.callStatus, "confirmed")),
      or(isNull(orders.shipBookAt), lt(orders.shipBookAt, new Date(Date.now() - RETRY_MS))),
      lt(orders.createdAt, new Date(Date.now() - WAIT_MS)),
      cleared(shipRuleOf(store)),
    )).orderBy(asc(orders.createdAt)).limit(50);
    for (const o of list) {
      if (!readyToBook(store, o)) continue;
      await bookWithCouriers(store, o, couriers);
    }
  }
  await pullShiprocketChanges().catch((e) => console.error("[auto-ship] shiprocket pull", e));
}

/** SQL version of ruleAllows: which open orders the shipping rule lets through. */
function cleared(rule: ShipRule): SQL | undefined {
  const notCallCancelled = sql`${orders.callStatus} is distinct from 'cancelled'`;
  if (rule.mode === "all") return notCallCancelled;
  const wa = eq(orders.confirmStatus, "confirmed"), team = eq(orders.callStatus, "confirmed");
  const confirmed = rule.by === "whatsapp" ? wa : rule.by === "team" ? team : or(wa, team);
  return and(notCallCancelled, rule.prepaidNow ? or(confirmed, eq(orders.paymentMethod, "prepaid")) : confirmed);
}

/** Books one order with the store's courier accounts in order: if the first fails (any reason), the next one tries. */
async function bookWithCouriers(store: Store, o: Order, couriers: CourierAccount[]) {
  // Claim the order first, so the timer and an instant booking can never both send it (no double AWB)
  const claimed = await db.update(orders).set({ shipBookAt: new Date() }).where(and(
    eq(orders.id, o.id), isNull(orders.awb), isNull(orders.courierRef),
    or(isNull(orders.shipBookAt), lt(orders.shipBookAt, new Date(Date.now() - RETRY_MS))),
  )).returning({ id: orders.id });
  if (!claimed.length) return { ok: false, error: "already being booked" };
  let r: { ok: boolean; error?: string } = { ok: false };
  const errors: string[] = [];
  for (const acc of couriers) {
    r = await bookOrder(store, o, acc);
    if (r.ok) break;
    errors.push(couriers.length > 1 ? `${acc.name ?? acc.courier}: ${r.error ?? "failed"}` : r.error ?? "");
  }
  if (!r.ok && couriers.length > 1 && errors.length) {
    await db.update(orders).set({ shipError: errors.join(" · ").slice(0, 500) }).where(eq(orders.id, o.id));
  }
  if (!r.ok && errors.length && errors.every((e) => isPinError(e))) {
    // Wait a day before trying again (shipBookAt in the future = skipped until then)
    await db.update(orders).set({
      shipError: errors.length > 1 ? `None of your couriers deliver to pincode ${o.customer.pincode}. Book it by hand.` : errors[0],
      shipBookAt: new Date(Date.now() + RETRY_PIN_MS - RETRY_MS),
    }).where(eq(orders.id, o.id));
  }
  return r;
}

/**
 * Right after a confirmation (call or WhatsApp): book this order now instead of waiting for the 5-minute run.
 * Same checks as the timer: the rule must allow it, and it isn't booked twice.
 */
export async function shipNowIfReady(storeId: number, orderId: string) {
  const [store] = await db.select().from(stores).where(and(eq(stores.id, storeId), eq(stores.active, true))).limit(1);
  if (!store || shipRuleOf(store).mode === "off") return;
  const [o] = await db.select().from(orders).where(and(eq(orders.id, orderId), eq(orders.storeId, store.id))).limit(1);
  if (!o || !["paid", "cod_placed"].includes(o.status) || !o.shopifyOrderId?.startsWith("gp:") || o.awb || o.courierRef) return;
  if (o.shipBookAt && o.shipBookAt.getTime() > Date.now() - RETRY_MS) return; // being booked or waiting to retry
  if (shipsNothing(o) || !ruleAllows(shipRuleOf(store), o)) return; // confirmed orders don't wait the 10 minutes
  const couriers = (await db.select().from(courierAccounts).where(and(eq(courierAccounts.storeId, store.id), inArray(courierAccounts.courier, BOOKS), eq(courierAccounts.status, "connected"), eq(courierAccounts.autoShip, true)))
    .orderBy(asc(courierAccounts.priority), asc(courierAccounts.createdAt)))
    .filter(bookable);
  if (!couriers.length) return;
  console.log(`[auto-ship] ${store.name} ${o.id} confirmed → booking now`);
  await bookWithCouriers(store, o, couriers);
}

/** Not-yet-shipped Shiprocket statuses: shown as they are, without counting as "in transit". */
const BEFORE_PICKUP = /^(new|invoiced|ready to ship|awb assigned|label generated|manifest generated|pickup (scheduled|queued|generated|rescheduled|error|exception)|out for pickup|pickup booked|on hold|pending)$/i;

/** Reads back what changed in the Shiprocket panel: courier/AWB assigned, cancelled, picked up. */
async function pullShiprocketChanges() {
  const since = new Date(Date.now() - 30 * 86400_000);
  const list = await db.select({ id: orders.id, storeId: orders.storeId, ref: orders.courierRef, awb: orders.awb, raw: orders.shipStatusRaw, accountId: orders.courierAccountId, bookAt: orders.shipBookAt }).from(orders).where(and(
    eq(orders.courier, "shiprocket"), isNotNull(orders.courierRef), gt(orders.createdAt, since),
    or(isNull(orders.shipStatus), notInArray(orders.shipStatus, ["delivered", "rto", "returned", "cancelled"])),
    // AWB orders get live status from tracking; we only look until the courier picks it up
    or(isNull(orders.awb), isNull(orders.shipStatus)),
  )).limit(200);
  const accs = new Map<string, CourierAccount | null>();
  for (const o of list) {
    const key = `${o.storeId}:${o.accountId ?? ""}`;
    if (!accs.has(key)) {
      const a = await accountForOrder(o.storeId, { courier: "shiprocket", courierAccountId: o.accountId });
      accs.set(key, a && a.status === "connected" ? a : null);
    }
    const acc = accs.get(key);
    if (!acc) continue;
    const s = await shiprocketOrderState(acc.creds, o.ref!).catch(() => null);
    if (!s) continue;
    // Still no courier in Shiprocket: try assigning one (every 30 minutes at most)
    if (!s.awb && !o.awb && /^new$/i.test(s.status.trim()) && (acc.creds.srPick ?? "cheapest") !== "manual" && (!o.bookAt || o.bookAt.getTime() < Date.now() - 30 * 60_000)) {
      const [st] = await db.select({ name: stores.name }).from(stores).where(eq(stores.id, o.storeId)).limit(1);
      await db.update(orders).set({ shipBookAt: new Date() }).where(eq(orders.id, o.id));
      const a = await assignSr(st?.name ?? String(o.storeId), o.id, acc.creds, o.ref!);
      if (a.ok) continue;
    }
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
    void import("./abandoned-calls.server").then((m) => m.assignAllAbandoned()).catch((e) => console.error("[abandoned-calls]", e));
    void import("./ofd-calls.server").then((m) => m.assignAllOfd()).catch((e) => console.error("[ofd-calls]", e));
  }, 5 * 60_000);
  globalThis.__autoShip.unref?.();
}

/** The customer cancelled (e.g. on WhatsApp): cancel it at the courier too, if it hasn't moved yet. */
export async function cancelBookedShipment(storeId: number, o: Pick<Order, "id" | "awb" | "courier"> & { courierRef?: string | null; courierAccountId?: number | null }) {
  const [saved] = await db.select({ ref: orders.courierRef, accountId: orders.courierAccountId }).from(orders).where(eq(orders.id, o.id)).limit(1);
  const accountId = o.courierAccountId ?? saved?.accountId ?? null;
  if (o.courier === "shiprocket") {
    const row = { ref: o.courierRef === undefined ? saved?.ref ?? null : o.courierRef };
    const acc = await accountForOrder(storeId, { courier: "shiprocket", courierAccountId: accountId });
    if (!row?.ref || !acc) return;
    const r = await cancelShiprocketOrder(acc.creds, row.ref);
    if (r.ok) await db.update(orders).set({ shipStatus: "cancelled", shipStatusRaw: "Cancelled", shipStatusAt: new Date() }).where(eq(orders.id, o.id));
    else console.warn(`[auto-ship] shiprocket cancel ${o.id}: ${r.error}`);
    return;
  }
  if (!o.awb || o.courier !== "delhivery") return;
  const acc = await accountForOrder(storeId, { courier: "delhivery", courierAccountId: accountId });
  if (!acc?.creds.token) return;
  const { cancelDelhiveryShipment } = await import("./couriers/delhivery.server");
  const r = await cancelDelhiveryShipment(acc.creds.token, o.awb);
  if (r.ok) await db.update(orders).set({ shipStatus: "cancelled", shipStatusRaw: "Cancelled", shipStatusAt: new Date() }).where(eq(orders.id, o.id));
  else console.warn(`[auto-ship] cancel ${o.id} ${o.awb}: ${r.error}`);
}

/** Orders whose automatic booking failed and are still waiting for a tracking number (Shipping → Failed shipping). */
export async function failedShipments(storeId: number) {
  return db.select().from(orders).where(and(
    eq(orders.storeId, storeId), inArray(orders.status, ["paid", "cod_placed"]), isNotNull(orders.shipError), isNull(orders.awb), isNull(orders.courierRef),
    or(isNull(orders.confirmStatus), ne(orders.confirmStatus, "cancelled"), eq(orders.callStatus, "confirmed")),
    or(isNull(orders.callStatus), ne(orders.callStatus, "cancelled")),
  )).orderBy(asc(orders.createdAt)).limit(500);
}

/**
 * Reship: tries the store's couriers again right now for the chosen failed orders, oldest connection first;
 * a pincode error moves on to the next courier. Ignores the shipping rule and the retry wait (the store asked for it).
 */
export async function reshipOrders(store: Store, ids: string[]) {
  const couriers = (await db.select().from(courierAccounts).where(and(eq(courierAccounts.storeId, store.id), inArray(courierAccounts.courier, BOOKS)))
    .orderBy(asc(courierAccounts.priority), asc(courierAccounts.createdAt))).filter(bookable);
  if (!couriers.length) return { error: "Connect Delhivery (with a pickup location) or Shiprocket under Shipments first.", results: [] as { id: string; name: string; ok: boolean; message: string }[] };
  const list = ids.length ? await db.select().from(orders).where(and(
    eq(orders.storeId, store.id), inArray(orders.id, ids.slice(0, 200)), inArray(orders.status, ["paid", "cod_placed"]), isNull(orders.awb), isNull(orders.courierRef),
    or(isNull(orders.confirmStatus), ne(orders.confirmStatus, "cancelled"), eq(orders.callStatus, "confirmed")),
  )) : [];
  const results: { id: string; name: string; ok: boolean; message: string }[] = [];
  for (const o of list.filter((x) => !shipsNothing(x))) {
    const name = o.shopifyOrderName ?? `#${o.id.slice(-6).toUpperCase()}`;
    const errors: string[] = [];
    let done: { ok: boolean; awb?: string; courier?: string } = { ok: false };
    for (const acc of couriers) {
      const r = await bookOrder(store, o, acc);
      if (r.ok) { done = { ok: true, awb: "awb" in r ? (r.awb as string | undefined) : undefined, courier: acc.name ?? (acc.courier === "shiprocket" ? "Shiprocket" : "Delhivery") }; break; }
      errors.push(couriers.length > 1 ? `${acc.name ?? acc.courier}: ${r.error ?? "failed"}` : r.error ?? "");
    }
    if (done.ok) results.push({ id: o.id, name, ok: true, message: `Booked with ${done.courier}${done.awb ? `, AWB ${done.awb}` : ""}` });
    else {
      const msg = errors.length > 1 && errors.every(isPinError) ? `None of your couriers deliver to pincode ${o.customer.pincode}. Book it by hand.` : errors[errors.length - 1] || "Couldn't book";
      if (errors.length > 1) await db.update(orders).set({ shipError: msg }).where(eq(orders.id, o.id));
      results.push({ id: o.id, name, ok: false, message: msg });
    }
  }
  return { error: null, results };
}
