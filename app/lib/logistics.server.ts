// Courier connections and shipment status sync (feeds RTO Shield). A store can connect any number of couriers.
import { randomBytes } from "node:crypto";
import { and, asc, count, eq, gt, gte, inArray, isNotNull, isNull, lt, notInArray, or, sql } from "drizzle-orm";
import { courierAccounts, db, orders, stores, type CourierAccount, type CourierCreds, type Store } from "~/db.server";
import { COURIERS, courierById, type CourierInfo } from "./courier-catalog";
import { CourierAuthError, mapStatusText, parseDate, seal, type TrackResult } from "./couriers/common.server";
import { PROVIDERS } from "./couriers/providers.server";
import type { ShipStatus } from "./rto-shield";
import { fetchFulfillmentTracking, storeConnected, type OrderTracking } from "./platform.server";

export { COURIERS };

/** The store's courier accounts in its booking order (1 first). */
export async function courierAccountsFor(storeId: number) {
  return db.select().from(courierAccounts).where(eq(courierAccounts.storeId, storeId)).orderBy(asc(courierAccounts.priority), asc(courierAccounts.createdAt));
}

/** The account an order was booked with (or, for older orders, the store's first account of that courier). */
export async function accountForOrder(storeId: number, o: { courier: string | null; courierAccountId?: number | null }) {
  if (o.courierAccountId) {
    const [a] = await db.select().from(courierAccounts).where(and(eq(courierAccounts.id, o.courierAccountId), eq(courierAccounts.storeId, storeId))).limit(1);
    if (a) return a;
  }
  if (!o.courier) return null;
  const [a] = await db.select().from(courierAccounts).where(and(eq(courierAccounts.storeId, storeId), eq(courierAccounts.courier, o.courier)))
    .orderBy(asc(courierAccounts.priority), asc(courierAccounts.createdAt)).limit(1);
  return a ?? null;
}

/** First account of a courier (for courier-wide things like webhooks). */
export async function firstAccountOf(storeId: number, courier: string) {
  return accountForOrder(storeId, { courier });
}

/** RTO Shield unlocks once at least one courier is connected. */
export async function hasCourier(storeId: number) {
  const [r] = await db.select({ n: count() }).from(courierAccounts).where(and(eq(courierAccounts.storeId, storeId), eq(courierAccounts.status, "connected")));
  return Number(r?.n ?? 0) > 0;
}

type Input = Partial<Record<"token" | "clientName" | "email" | "password" | "clientId" | "username" | "label" | "mode" | "pickupName" | "name" | "srPick", string>>;

/**
 * Connects a courier account. `accountId` = update that account; otherwise a new account is added, even for a
 * courier already connected (a second Delhivery account, say), at the end of the booking order.
 */
export async function connectCourier(store: Store, courierId: string, input: Input, accountId?: number | null): Promise<{ ok: true } | { ok: false; error: string }> {
  const info = courierById(courierId);
  if (!info) return { ok: false, error: "Pick a courier from the list" };
  const v = (k: keyof Input) => String(input[k] ?? "").trim();
  const [existing] = accountId ? await db.select().from(courierAccounts).where(and(eq(courierAccounts.storeId, store.id), eq(courierAccounts.id, accountId), eq(courierAccounts.courier, info.id))).limit(1) : [];
  if (accountId && !existing) return { ok: false, error: "That courier account wasn't found" };
  let creds: CourierCreds = {};

  if (info.kind === "api" && v("mode") === "shopify") {
    // No API login: track this courier's AWBs from the status its app sends to Shopify
    creds = { viaShopify: true };
  } else if (info.kind === "api") {
    for (const f of info.fields ?? []) {
      if (!f.optional && !v(f.name) && !(f.name === "password" && existing?.creds.password)) return { ok: false, error: `Enter the ${f.label.toLowerCase()}` };
    }
    if (info.id === "delhivery") {
      const token = v("token").replace(/^Token\s+/i, "");
      if (token.length < 10) return { ok: false, error: "Paste the full API token" };
      creds = { token, clientName: v("clientName").slice(0, 80) || undefined, pickupName: v("pickupName").slice(0, 80) || undefined };
    } else {
      creds = {
        email: v("email").toLowerCase() || undefined,
        clientId: v("clientId") || undefined,
        username: v("username") || undefined,
        // keep the saved password when the form leaves it empty
        password: v("password") ? seal(v("password")) : existing?.creds.password,
        ...(info.id === "shiprocket" ? {
          pickupName: v("pickupName").slice(0, 80) || undefined,
          srPick: (["cheapest", "recommended", "fastest", "manual"].includes(v("srPick")) ? v("srPick") : existing?.creds.srPick ?? "cheapest") as "cheapest" | "recommended" | "fastest" | "manual",
          token: existing?.creds.token || randomBytes(20).toString("hex"), // key for Shiprocket's status webhook
        } : {}),
      };
    }
    const t = await PROVIDERS[info.id].test(creds);
    if (!t.ok) return t;
  } else if (info.kind === "push") {
    creds = { token: existing?.creds.token || randomBytes(20).toString("hex") };
  } else {
    creds = { label: v("label").slice(0, 60) || undefined };
  }

  const name = v("name").slice(0, 60) || null;
  if (existing) {
    await db.update(courierAccounts).set({ creds, status: "connected", lastError: null, ...(name ? { name } : {}) }).where(eq(courierAccounts.id, existing.id));
  } else {
    const all = await courierAccountsFor(store.id);
    const same = all.filter((a) => a.courier === info.id).length;
    await db.insert(courierAccounts).values({
      storeId: store.id, courier: info.id, creds, status: "connected", priority: all.reduce((m, a) => Math.max(m, a.priority), 0) + 1,
      name: name ?? (same ? `${info.name} ${same + 1}` : null),
    });
  }
  void syncStoreShipments(store).catch((e) => console.error("[logistics] first sync:", e instanceof Error ? e.message : e));
  return { ok: true };
}

/** Removes one courier account (by id; or every account of a courier when given its name, for old forms). */
export async function disconnectCourier(storeId: number, courierOrId: string | number) {
  const id = Number(courierOrId);
  if (Number.isInteger(id) && id > 0) await db.delete(courierAccounts).where(and(eq(courierAccounts.storeId, storeId), eq(courierAccounts.id, id)));
  else await db.delete(courierAccounts).where(and(eq(courierAccounts.storeId, storeId), eq(courierAccounts.courier, String(courierOrId))));
}

/** Booking order and settings of the store's courier accounts. `order` = account ids, first is tried first. */
export async function arrangeCouriers(storeId: number, order: number[], patch: Record<number, { name?: string; autoShip?: boolean }>) {
  const all = await courierAccountsFor(storeId);
  const ids = [...order.filter((id) => all.some((a) => a.id === id)), ...all.map((a) => a.id).filter((id) => !order.includes(id))];
  for (let i = 0; i < ids.length; i++) {
    const p = patch[ids[i]] ?? {};
    await db.update(courierAccounts).set({
      priority: i + 1,
      ...(p.name !== undefined ? { name: p.name.trim().slice(0, 60) || null } : {}),
      ...(p.autoShip !== undefined ? { autoShip: p.autoShip } : {}),
    }).where(and(eq(courierAccounts.id, ids[i]), eq(courierAccounts.storeId, storeId)));
  }
}

const FINAL: ShipStatus[] = ["rto", "returned", "cancelled"];
/** A shipment cancelled after pickup can still turn into an RTO at the courier, so keep watching it for a while */
const CANCELLED_WATCH_DAYS = 15;
const LOOKBACK_DAYS = 90;
const RECHECK_MS = 3 * 3600_000;
const RECHECK_ACTIVE_MS = 25 * 60_000; // out for delivery / NDR change within the day
const DELIVERED_WATCH_DAYS = 20; // delivered orders can still come back as returns
const PUSH_IDS = COURIERS.filter((c) => c.kind === "push").map((c) => c.id);

const re = (c: CourierInfo) => (c.match ? new RegExp(c.match, "i") : null);

/** Which connected courier an AWB belongs to, from the Shopify tracking company and URL. */
export function pickCourier(accounts: { courier: string }[], t: { company: string | null; url: string | null }) {
  const infos = accounts.map((a) => courierById(a.courier)).filter((c): c is CourierInfo => Boolean(c));
  const company = t.company ?? "";
  const hay = `${company} ${t.url ?? ""}`;
  // 1. an aggregator's own tracking link or name (Shiprocket books on Xpressbees, Delhivery…)
  const agg = infos.find((c) => c.aggregator && re(c)?.test(hay));
  if (agg) return agg.id;
  // 2. the courier named on the fulfillment
  const direct = infos.find((c) => !c.aggregator && re(c)?.test(company)) ?? infos.find((c) => !c.aggregator && re(c)?.test(hay));
  if (direct) return direct.id;
  // 3. an aggregator is the best guess for unknown couriers, then "other" (Shopify status)
  return infos.find((c) => c.aggregator)?.id ?? "other";
}

const SHOPIFY_MAP: Record<string, ShipStatus> = {
  DELIVERED: "delivered", CANCELED: "cancelled", LABEL_VOIDED: "cancelled", FAILURE: "rto_transit", NOT_DELIVERED: "rto_transit",
};

/** Shipment status from Shopify (tags like “RTO Delivered” win, then the fulfillment status). */
export function shopifyShipStatus(t: OrderTracking, awb?: string | null): TrackResult | null {
  const tag = t.tags.find((x) => /\brto\b|\brts\b|return(ed)? to origin/i.test(x));
  if (tag) return { awb: awb ?? "", status: mapStatusText(tag), raw: `Shopify tag · ${tag}`, at: null };
  const f = (awb && t.fulfillments.find((x) => x.tracking.some((y) => y.number === awb))) || t.fulfillments[0];
  if (!f?.status) return t.cancelled ? { awb: awb ?? "", status: "cancelled", raw: "Shopify · order cancelled", at: null } : null;
  const status = SHOPIFY_MAP[f.status] ?? "in_transit";
  return { awb: awb ?? "", status, raw: `Shopify · ${f.status.toLowerCase().replace(/_/g, " ")}`, at: status === "in_transit" ? null : parseDate(f.updatedAt) };
}

type Watch = { id: string; awb: string | null; courier: string | null; gid: string | null; shipStatus: ShipStatus | null; accountId?: number | null };

async function saveStatus(o: Watch, r: TrackResult | null, courier?: string) {
  const now = new Date();
  const extra = r ? await deliveryFields(o, r, now) : {};
  if (r?.status && r.status !== o.shipStatus) {
    await db.update(orders).set({ shipStatus: r.status, shipStatusRaw: r.raw.slice(0, 120), shipStatusAt: r.at ?? now, shipCheckedAt: now, ...extra, ...(courier ? { courier } : {}) }).where(eq(orders.id, o.id));
    return 1;
  }
  await db.update(orders).set({ shipCheckedAt: now, ...extra, ...(r?.raw ? { shipStatusRaw: r.raw.slice(0, 120) } : {}), ...(courier ? { courier } : {}) }).where(eq(orders.id, o.id));
  return 0;
}

/**
 * Out for delivery / NDR bookkeeping: counts delivery attempts (from the courier's scans, or by counting each new
 * "out for delivery"), and on every new attempt clears the delivery-day call so the caller rings the customer again.
 */
async function deliveryFields(o: Watch, r: TrackResult, now: Date): Promise<Partial<typeof orders.$inferInsert>> {
  const relevant = r.status === "out_for_delivery" || r.status === "ndr" || r.status === "delivered" || (r.attempts ?? 0) > 0;
  if (!relevant) return {};
  const [cur] = await db.select({ attempts: orders.ofdAttempts, ofdAt: orders.ofdAt, deliveredAt: orders.deliveredAt, ndrAt: orders.ndrAt }).from(orders).where(eq(orders.id, o.id)).limit(1);
  if (!cur) return {};
  const out: Partial<typeof orders.$inferInsert> = {};
  let attempts = r.attempts ?? cur.attempts;
  // No scan history: a fresh "out for delivery" is the next attempt
  if (r.attempts == null && r.status === "out_for_delivery" && o.shipStatus !== "out_for_delivery") attempts = cur.attempts + 1;
  if (r.status === "out_for_delivery" && attempts < 1) attempts = 1;
  if (attempts > cur.attempts) {
    Object.assign(out, { ofdAttempts: attempts, ofdAt: r.status === "out_for_delivery" ? r.at ?? now : cur.ofdAt ?? r.at ?? now, ofdCallStatus: null, ofdFollowUpAt: null });
  } else if (r.status === "out_for_delivery" && !cur.ofdAt) out.ofdAt = r.at ?? now;
  if (r.status === "ndr" && (o.shipStatus !== "ndr" || !cur.ndrAt)) Object.assign(out, { ndrAt: r.at ?? now, ndrReason: r.ndrReason ?? null });
  else if (r.status === "ndr" && r.ndrReason) out.ndrReason = r.ndrReason;
  if (r.status === "delivered" && !cur.deliveredAt) out.deliveredAt = r.at ?? now;
  return out;
}

/** Links AWBs from Shopify fulfillments, then refreshes statuses from each courier (Shopify as the fallback). */
export async function syncStoreShipments(store: Store, opts: { force?: boolean } = {}) {
  const accounts = (await courierAccountsFor(store.id)).filter((a) => a.status === "connected" || opts.force);
  if (!accounts.length) return { linked: 0, updated: 0 };
  const shopify = storeConnected(store); // Shopify or WooCommerce
  const since = new Date(Date.now() - LOOKBACK_DAYS * 86400_000);
  const errors = new Map<number, { msg: string; auth: boolean }>();
  let linked = 0, updated = 0;

  // 1. AWBs for orders that don't have one yet
  if (shopify) {
    try {
      const pending = await db.select({ id: orders.id, gid: orders.shopifyOrderId }).from(orders)
        .where(and(eq(orders.storeId, store.id), inArray(orders.status, ["paid", "cod_placed"]), isNotNull(orders.shopifyOrderId), isNull(orders.awb), gt(orders.createdAt, since),
          or(isNull(orders.shipCheckedAt), lt(orders.shipCheckedAt, new Date(Date.now() - RECHECK_MS)))))
        .orderBy(asc(orders.createdAt)).limit(300);
      for (let i = 0; i < pending.length; i += 50) {
        const chunk = pending.slice(i, i + 50);
        const found = new Map((await fetchFulfillmentTracking(store, chunk.map((o) => o.gid!))).map((f) => [f.orderId, f]));
        for (const o of chunk) {
          const t = found.get(o.gid!);
          const first = t?.tracking[0];
          if (t && first) {
            const courier = pickCourier(accounts, first);
            const s = shopifyShipStatus(t, first.number);
            await db.update(orders).set({
              awb: first.number.slice(0, 40), courier, shipStatus: s?.status ?? "in_transit", shipStatusRaw: s?.raw ?? "Shipped",
              shipStatusAt: s?.at ?? new Date(), shipCheckedAt: new Date(0),
            }).where(eq(orders.id, o.id));
            linked++;
          } else {
            await db.update(orders).set({ shipCheckedAt: new Date() }).where(eq(orders.id, o.id));
          }
        }
      }
    } catch (e) {
      console.error(`[logistics] ${store.name} link:`, e instanceof Error ? e.message : e);
    }
  }

  // 2. Live status for shipped orders (push couriers update themselves through the webhook)
  const watch: Watch[] = await db.select({ id: orders.id, awb: orders.awb, courier: orders.courier, gid: orders.shopifyOrderId, shipStatus: orders.shipStatus, accountId: orders.courierAccountId }).from(orders)
    .where(and(eq(orders.storeId, store.id), isNotNull(orders.awb), isNotNull(orders.courier), gt(orders.createdAt, since),
      PUSH_IDS.length ? notInArray(orders.courier, PUSH_IDS) : undefined,
      or(isNull(orders.shipStatus), notInArray(orders.shipStatus, FINAL),
        and(eq(orders.shipStatus, "cancelled"), gt(orders.shipStatusAt, new Date(Date.now() - CANCELLED_WATCH_DAYS * 86400_000)))),
      or(sql`${orders.shipStatus} is distinct from 'delivered'`, gt(orders.shipStatusAt, new Date(Date.now() - DELIVERED_WATCH_DAYS * 86400_000))),
      opts.force ? undefined : or(isNull(orders.shipCheckedAt), lt(orders.shipCheckedAt, new Date(Date.now() - RECHECK_MS)),
        and(sql`${orders.shipStatus} in ('in_transit','out_for_delivery','ndr')`, lt(orders.shipCheckedAt, new Date(Date.now() - RECHECK_ACTIVE_MS))))))
    .orderBy(asc(orders.shipCheckedAt)).limit(1000);

  const apiAccounts = accounts.filter((a) => courierById(a.courier)?.kind === "api" && PROVIDERS[a.courier] && !a.creds.viaShopify);
  // aggregators first: they can track AWBs of many couriers
  apiAccounts.sort((a, b) => Number(Boolean(courierById(b.courier)?.aggregator)) - Number(Boolean(courierById(a.courier)?.aggregator)));

  const track = async (acc: CourierAccount, list: Watch[]) => {
    const p = PROVIDERS[acc.courier];
    const out = new Map<string, TrackResult>();
    try {
      for (let i = 0; i < list.length; i += p.batch) {
        for (const r of await p.track(acc.creds, list.slice(i, i + p.batch).map((o) => o.awb!))) out.set(r.awb, r);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      errors.set(acc.id, { msg, auth: e instanceof CourierAuthError || /rejected|token|password|expired/i.test(msg) });
    }
    return out;
  };

  let leftover: Watch[] = [];
  // Each order goes to the account that booked it; older orders (no account saved) to the first account of that courier
  const firstOf = new Map<string, number>();
  for (const a of apiAccounts) if (!firstOf.has(a.courier)) firstOf.set(a.courier, a.id);
  const owner = (o: Watch) => (o.accountId && apiAccounts.some((a) => a.id === o.accountId) ? o.accountId : firstOf.get(o.courier ?? "") ?? null);
  for (const acc of apiAccounts) {
    const mine = watch.filter((o) => owner(o) === acc.id);
    if (!mine.length) continue;
    const res = await track(acc, mine);
    for (const o of mine) {
      const r = res.get(o.awb!);
      if (r) updated += await saveStatus(o, r);
      else leftover.push(o);
    }
  }
  // AWBs the assigned courier didn't know: try the other connected APIs once
  for (const acc of apiAccounts) {
    const tryList = leftover.filter((o) => owner(o) !== acc.id);
    if (!tryList.length || errors.has(acc.id)) continue;
    const res = await track(acc, tryList);
    if (!res.size) continue;
    const next: Watch[] = [];
    for (const o of leftover) {
      const r = owner(o) !== acc.id ? res.get(o.awb!) : undefined;
      if (r) { updated += await saveStatus(o, r, acc.courier); await db.update(orders).set({ courierAccountId: acc.id }).where(eq(orders.id, o.id)); }
      else next.push(o);
    }
    leftover = next;
  }
  // Shopify-tracked couriers, "other", and anything the APIs couldn't find
  const viaShopify = [...watch.filter((o) => !apiAccounts.some((a) => a.courier === o.courier)), ...leftover].filter((o) => o.gid);
  if (shopify && viaShopify.length) {
    try {
      for (let i = 0; i < viaShopify.length; i += 50) {
        const chunk = viaShopify.slice(i, i + 50);
        const found = new Map((await fetchFulfillmentTracking(store, chunk.map((o) => o.gid!))).map((f) => [f.orderId, f]));
        for (const o of chunk) {
          const t = found.get(o.gid!);
          updated += await saveStatus(o, t ? shopifyShipStatus(t, o.awb) : null);
        }
      }
    } catch (e) {
      console.error(`[logistics] ${store.name} shopify status:`, e instanceof Error ? e.message : e);
    }
  }

  const now = new Date();
  for (const a of accounts) {
    const err = errors.get(a.id);
    await db.update(courierAccounts)
      .set(err ? { lastError: err.msg.slice(0, 500), status: err.auth ? "error" : a.status } : { lastSyncAt: now, lastError: null, status: "connected" })
      .where(eq(courierAccounts.id, a.id));
  }
  return { linked, updated };
}

/** Status updates pushed by a courier (Shipnex). Matches by AWB, or by order reference to link a new AWB. */
export async function applyPushedStatuses(storeId: number, courier: string, items: { awb: string; status: string; ref?: string; at?: string }[]) {
  let matched = 0, changed = 0;
  for (const it of items.slice(0, 500)) {
    const awb = it.awb.trim().slice(0, 40);
    if (!awb || !it.status) continue;
    let [o] = await db.select({ id: orders.id, awb: orders.awb, courier: orders.courier, gid: orders.shopifyOrderId, shipStatus: orders.shipStatus }).from(orders)
      .where(and(eq(orders.storeId, storeId), eq(orders.awb, awb))).limit(1);
    if (!o && it.ref) {
      const ref = it.ref.trim().replace(/^#/, "");
      [o] = await db.select({ id: orders.id, awb: orders.awb, courier: orders.courier, gid: orders.shopifyOrderId, shipStatus: orders.shipStatus }).from(orders)
        .where(and(eq(orders.storeId, storeId), or(eq(orders.id, ref), eq(orders.shopifyOrderName, `#${ref}`), eq(orders.shopifyOrderName, ref)))).limit(1);
      if (o) await db.update(orders).set({ awb, courier }).where(eq(orders.id, o.id));
    }
    if (!o) continue;
    matched++;
    changed += await saveStatus(o, { awb, status: mapStatusText(it.status), raw: it.status.slice(0, 100), at: parseDate(it.at) });
  }
  await db.update(courierAccounts).set({ lastSyncAt: new Date(), lastError: null }).where(and(eq(courierAccounts.storeId, storeId), eq(courierAccounts.courier, courier)));
  return { matched, changed };
}

/** Shipment status counts for a store (last 90 days) for the dashboard. */
export type DateWindow = { from: Date | null; to: Date | null };
const inWindow = (w?: DateWindow) => and(w?.from ? gte(orders.createdAt, w.from) : undefined, w?.to ? lt(orders.createdAt, w.to) : undefined);

export async function shipmentSummary(storeId: number, w?: DateWindow) {
  const rows = await db.select({ s: orders.shipStatus, n: count() }).from(orders)
    .where(and(eq(orders.storeId, storeId), isNotNull(orders.shipStatus), w ? inWindow(w) : gt(orders.createdAt, new Date(Date.now() - LOOKBACK_DAYS * 86400_000))))
    .groupBy(orders.shipStatus);
  return Object.fromEntries(rows.map((r) => [r.s, Number(r.n)])) as Partial<Record<ShipStatus, number>>;
}

/** Shipments per courier (last 90 days). */
export async function shipmentsByCourier(storeId: number) {
  const rows = await db.select({ c: orders.courier, n: count() }).from(orders)
    .where(and(eq(orders.storeId, storeId), isNotNull(orders.courier), gt(orders.createdAt, new Date(Date.now() - LOOKBACK_DAYS * 86400_000))))
    .groupBy(orders.courier);
  return Object.fromEntries(rows.map((r) => [r.c, Number(r.n)])) as Record<string, number>;
}

/**
 * Delivery performance per courier account over the last `days`: shipments, delivered, RTO (incl. returned) and in
 * transit. Older orders without a saved account count under the first account of their courier.
 */
export async function courierPerformance(storeId: number, w: DateWindow) {
  const accounts = await courierAccountsFor(storeId);
  const rows = await db.select({ c: orders.courier, a: orders.courierAccountId, s: orders.shipStatus, n: count() }).from(orders)
    .where(and(eq(orders.storeId, storeId), isNotNull(orders.shipStatus), inWindow(w)))
    .groupBy(orders.courier, orders.courierAccountId, orders.shipStatus);
  const firstOf = new Map<string, number>();
  for (const a of accounts) if (!firstOf.has(a.courier)) firstOf.set(a.courier, a.id);
  const by = new Map<string, { key: string; accountId: number | null; courier: string; total: number; delivered: number; rto: number; transit: number }>();
  for (const r of rows) {
    if (r.s === "cancelled") continue;
    const courier = r.c ?? "other";
    const accountId = r.a && accounts.some((a) => a.id === r.a) ? r.a : firstOf.get(courier) ?? null;
    const key = accountId ? `a${accountId}` : `c${courier}`;
    const x = by.get(key) ?? { key, accountId, courier, total: 0, delivered: 0, rto: 0, transit: 0 };
    const n = Number(r.n);
    x.total += n;
    if (r.s === "delivered") x.delivered += n;
    else if (r.s === "rto" || r.s === "returned" || r.s === "rto_transit") x.rto += n;
    else x.transit += n;
    by.set(key, x);
  }
  return [...by.values()].sort((a, b) => b.total - a.total);
}

import { SHIP_FILTERS, type ShipFilter } from "~/lib/rto-shield";
export { SHIP_FILTERS, type ShipFilter };

/** Shipped orders for the logistics page, newest first, with a status filter and search (order / AWB / phone). */
export const PAGE_SIZES = [10, 20, 30, 50, 100] as const;
export async function shipmentList(storeId: number, opts: { filter: ShipFilter; q: string; page: number; window: DateWindow; per?: number }) {
  const PAGE = (PAGE_SIZES as readonly number[]).includes(opts.per ?? 0) ? opts.per! : 10;
  const q = opts.q.trim().replace(/[%_]/g, "").slice(0, 40);
  const where = and(
    eq(orders.storeId, storeId), isNotNull(orders.awb),
    inWindow(opts.window),
    opts.filter !== "all" ? eq(orders.shipStatus, opts.filter) : undefined,
    q ? or(sql`${orders.awb} ilike ${`%${q}%`}`, sql`${orders.shopifyOrderName} ilike ${`%${q}%`}`, sql`${orders.customer}->>'phone' like ${`%${q}%`}`) : undefined,
  );
  const rows = await db.select({
    id: orders.id, name: orders.shopifyOrderName, customer: orders.customer, method: orders.paymentMethod, total: orders.total,
    awb: orders.awb, courier: orders.courier, status: orders.shipStatus, raw: orders.shipStatusRaw, at: orders.shipStatusAt, createdAt: orders.createdAt,
    labelAt: orders.labelPrintedAt, labelBatch: orders.labelBatch, accountId: orders.courierAccountId,
    attempts: orders.ofdAttempts, ndrReason: orders.ndrReason, reattemptAt: orders.reattemptAt,
  }).from(orders).where(where).orderBy(
    // Out for delivery / NDR: fresh (1st attempt) first, then 2nd, 3rd…
    ...(opts.filter === "ndr" || opts.filter === "out_for_delivery" ? [asc(orders.ofdAttempts)] : []),
    sql`${orders.shipStatusAt} desc nulls last`, sql`${orders.createdAt} desc`).limit(PAGE + 1).offset((Math.max(1, opts.page) - 1) * PAGE);
  const [t] = await db.select({ n: count() }).from(orders).where(where);
  return { rows: rows.slice(0, PAGE), hasMore: rows.length > PAGE, total: Number(t?.n ?? 0), per: PAGE };
}

const SYNC_EVERY_MS = 20 * 60_000;
declare global {
  // eslint-disable-next-line no-var
  var __shipmentWatcher: ReturnType<typeof setInterval> | undefined;
}

/** Log after the first sync: out for delivery / NDR counts per store (to check them against the courier panel). */
async function ndrAudit() {
  const rows = await db.select({ store: orders.storeId, s: orders.shipStatus, n: count(), multi: sql<number>`count(*) filter (where ${orders.ofdAttempts} >= 2)::int` }).from(orders)
    .where(and(inArray(orders.shipStatus, ["out_for_delivery", "ndr"]), gt(orders.createdAt, new Date(Date.now() - LOOKBACK_DAYS * 86400_000))))
    .groupBy(orders.storeId, orders.shipStatus);
  console.log(`[ndr-audit] ${JSON.stringify(rows)}`);
}

async function syncAll() {
  const rows = await db.selectDistinct({ storeId: courierAccounts.storeId }).from(courierAccounts).where(eq(courierAccounts.status, "connected"));
  if (!rows.length) return;
  const list = await db.select().from(stores).where(and(inArray(stores.id, rows.map((r) => r.storeId)), eq(stores.active, true)));
  for (const s of list) await syncStoreShipments(s).catch(() => {});
}

/** Refreshes shipment statuses every hour for stores with a courier connected. */
export function startShipmentWatcher() {
  if (globalThis.__shipmentWatcher || !process.env.DATABASE_URL) return;
  globalThis.__shipmentWatcher = setInterval(() => void syncAll().catch(() => {}), SYNC_EVERY_MS);
  globalThis.__shipmentWatcher.unref?.();
  setTimeout(() => void syncAll().then(ndrAudit).catch(() => {}), 60_000).unref?.();
}

export type { CourierAccount };
