// Abandoned checkout calling. "True abandoned" = a checkout left with a mobile number, where the customer didn't
// order afterwards and isn't blocked (block list, or RTO Shield right now). These are shared out round-robin to
// team members with the "abandoned_calls" permission, who call, fill in missing details, change the cart / price
// and place the COD order; a confirmed call books the shipment straight away (the store's shipping rule decides).
import { and, asc, desc, eq, gte, inArray, isNotNull, isNull, lt, notInArray, or, sql } from "drizzle-orm";
import {
  blockedCustomers, checkoutSessions, db, orders, rtoShieldExempt, stores, teamMembers,
  type CallCartLine, type CheckoutSession, type OrderCustomer, type OrderEvent, type OrderLine, type Store,
} from "~/db.server";
import { normPhone } from "./blocklist";
import { OUTSOURCE_TAG } from "./order-route";
import { hasCourier } from "./logistics.server";
import { finalizeOrder, newOrderId } from "./orders.server";
import { decideShield, resolveShield, type ShipCounts, type ShipStatus } from "./rto-shield";
import { INDIAN_STATES } from "./states";
import { linkedCodBlocked } from "./store-connect.server";

export const ABANDON_PERM = "abandoned_calls";
export const ABANDON_TAG = "Abandoned Recovered";
// Zavli's orders recovered on a call are marked OUTSOURCE (Zavli never routes its own orders out, so it can't be confused)
const OUTSOURCE_TAG_STORES = new Set([3]);
const tagFor = (storeId: number) => (OUTSOURCE_TAG_STORES.has(storeId) ? OUTSOURCE_TAG : ABANDON_TAG);
const WINDOW_DAYS = 7; // checkouts older than this aren't given to callers
const IDLE_MIN = 15; // give the customer this long to come back by themselves before a caller gets it
const LIVE: string[] = ["paid", "cod_placed", "cod_placing", "pending_payment", "cancelled"];

export type TrueRow = Pick<CheckoutSession, "id" | "storeId" | "customer" | "createdAt" | "updatedAt">;

const stateName = (code: string) => INDIAN_STATES.find((s) => s.code === code.toUpperCase())?.name.toLowerCase() ?? code.toLowerCase();

/**
 * Keeps only true abandoned checkouts: valid mobile, no order by that number (any store of the same owner group isn't
 * checked; same store, from 1 hour before the checkout on), not blocked, and only the newest checkout per number.
 */
export async function filterTrueAbandoned<T extends TrueRow>(rows: T[]): Promise<T[]> {
  const withPhone = rows
    .map((r) => ({ r, phone: normPhone(r.customer?.phone ?? "") ?? "" }))
    .filter((x) => /^[6-9]\d{9}$/.test(x.phone))
    .sort((a, b) => b.r.updatedAt.getTime() - a.r.updatedAt.getTime());
  if (!withPhone.length) return [];
  const storeIds = [...new Set(withPhone.map((x) => x.r.storeId))];
  const phones = [...new Set(withPhone.map((x) => x.phone))];

  // Ordered anyway (or an order that was cancelled): earliest order time per store + phone
  const ordered = await db.select({ storeId: orders.storeId, phone: sql<string>`${orders.customer}->>'phone'`, last: sql<string>`max(${orders.createdAt})` })
    .from(orders)
    .where(and(inArray(orders.storeId, storeIds), inArray(orders.status, LIVE), sql`${orders.customer}->>'phone' in (${sql.join(phones.map((p) => sql`${p}`), sql`, `)})`))
    .groupBy(orders.storeId, sql`${orders.customer}->>'phone'`);
  const lastOrder = new Map(ordered.map((o) => [`${o.storeId}:${o.phone}`, new Date(o.last)]));

  // Block list (permanent): phone, email, pincode, city, state
  const blocks = await db.select({ storeId: blockedCustomers.storeId, kind: blockedCustomers.kind, value: blockedCustomers.value })
    .from(blockedCustomers).where(inArray(blockedCustomers.storeId, storeIds));
  const blocked = new Set(blocks.map((b) => `${b.storeId}:${b.kind}:${b.value}`));

  // RTO Shield (permanent tiers and temporary in-transit rules) per store
  const storeRows = await db.select({ id: stores.id, rtoShield: stores.rtoShield }).from(stores).where(inArray(stores.id, storeIds));
  const shieldOf = new Map<number, ReturnType<typeof resolveShield> | null>();
  for (const s of storeRows) {
    const r = resolveShield(s.rtoShield);
    shieldOf.set(s.id, r.enabled && (await hasCourier(s.id)) ? r : null);
  }
  const shieldStores = storeRows.filter((s) => shieldOf.get(s.id)).map((s) => s.id);
  const counts = new Map<string, ShipCounts>();
  const exempt = new Set<string>();
  if (shieldStores.length) {
    const rows2 = await db.select({ storeId: orders.storeId, phone: sql<string>`${orders.customer}->>'phone'`, s: orders.shipStatus, n: sql<number>`count(*)::int` })
      .from(orders)
      .where(and(inArray(orders.storeId, shieldStores), isNotNull(orders.shipStatus), sql`${orders.customer}->>'phone' in (${sql.join(phones.map((p) => sql`${p}`), sql`, `)})`))
      .groupBy(orders.storeId, sql`${orders.customer}->>'phone'`, orders.shipStatus);
    for (const r of rows2) {
      const k = `${r.storeId}:${r.phone}`;
      const c = counts.get(k) ?? {};
      c[r.s as ShipStatus] = Number(r.n);
      counts.set(k, c);
    }
    for (const e of await db.select({ storeId: rtoShieldExempt.storeId, phone: rtoShieldExempt.phone }).from(rtoShieldExempt).where(inArray(rtoShieldExempt.storeId, shieldStores))) exempt.add(`${e.storeId}:${e.phone}`);
  }

  const seen = new Set<string>();
  const out: T[] = [];
  const linkedCache = new Map<string, Promise<boolean>>();
  for (const { r, phone } of withPhone) {
    const key = `${r.storeId}:${phone}`;
    if (seen.has(key)) continue; // newest checkout per customer only
    seen.add(key);
    const last = lastOrder.get(key);
    if (last && last.getTime() >= r.createdAt.getTime() - 3600_000) continue;
    const c = r.customer ?? {};
    const hit = (kind: string, v: string | null | undefined) => Boolean(v) && blocked.has(`${r.storeId}:${kind}:${v}`);
    if (hit("phone", phone) || hit("email", c.email?.trim().toLowerCase()) || hit("pincode", c.pincode?.replace(/\s+/g, "").toUpperCase())
      || hit("city", c.city?.trim().toLowerCase().replace(/\s+/g, " ")) || hit("state", c.state ? stateName(c.state) : null)) continue;
    const sh = shieldOf.get(r.storeId);
    if (sh && !exempt.has(key) && decideShield(sh, counts.get(key) ?? {})) continue;
    if (!linkedCache.has(key)) linkedCache.set(key, linkedCodBlocked(r.storeId, phone));
    if (await linkedCache.get(key)) continue; // COD blocked while they have a live order on a connected store
    out.push(r);
  }
  return out;
}

/** Abandoned-checkout candidates (not yet ordered from this checkout) in a time range, newest first. */
export async function abandonedCandidates(storeIds: number[], from: Date, to: Date, idleMinutes = 3, extra?: ReturnType<typeof and>) {
  return db.select({ id: checkoutSessions.id, storeId: checkoutSessions.storeId, customer: checkoutSessions.customer, createdAt: checkoutSessions.createdAt, updatedAt: checkoutSessions.updatedAt })
    .from(checkoutSessions)
    .where(and(
      inArray(checkoutSessions.storeId, storeIds.length ? storeIds : [-1]),
      gte(checkoutSessions.createdAt, from), lt(checkoutSessions.createdAt, to),
      sql`${checkoutSessions.updatedAt} < now() - make_interval(mins => ${Math.round(idleMinutes)}::int)`,
      sql`not exists (select 1 from ${orders} o where o.session_id = ${checkoutSessions.id} and o.status in ('paid','cod_placed','cod_placing'))`,
      isNotNull(checkoutSessions.cartSnapshot),
      sql`length(regexp_replace(coalesce(${checkoutSessions.customer}->>'phone', ''), '\\D', '', 'g')) >= 10`,
      extra,
    ))
    .orderBy(desc(checkoutSessions.updatedAt))
    .limit(5000);
}

/** Active team members of this store's owner with the abandoned-calling permission, oldest first. */
export async function abandonCallersFor(store: Pick<Store, "id" | "ownerId">) {
  if (!store.ownerId) return [];
  const rows = await db.select({ id: teamMembers.id, name: teamMembers.name, perms: teamMembers.perms, storeIds: teamMembers.storeIds, expiresAt: teamMembers.expiresAt })
    .from(teamMembers).where(and(eq(teamMembers.scope, "owner"), eq(teamMembers.ownerId, store.ownerId), eq(teamMembers.active, true))).orderBy(asc(teamMembers.id));
  return rows.filter((m) => m.perms.includes(ABANDON_PERM) && (!m.storeIds || m.storeIds.includes(store.id)) && (!m.expiresAt || m.expiresAt > new Date()))
    .map((m) => ({ id: m.id, name: m.name }));
}

/** Gives each new true abandoned checkout (or one whose caller left) to the next caller in turn. */
export async function assignAbandoned(store: Store) {
  const team = await abandonCallersFor(store);
  if (!team.length) return 0;
  const ids = team.map((m) => m.id);
  const cands = await abandonedCandidates([store.id], new Date(Date.now() - WINDOW_DAYS * 86400_000), new Date(Date.now() + 60_000), IDLE_MIN,
    and(or(isNull(checkoutSessions.callStatus), eq(checkoutSessions.callStatus, "follow_up")),
      or(isNull(checkoutSessions.callAssignedTo), notInArray(checkoutSessions.callAssignedTo, ids))));
  const real = (await filterTrueAbandoned(cands)).reverse(); // oldest first
  let rr = store.abandonRr ?? 0;
  for (const s of real) {
    const m = team[rr % team.length];
    rr++;
    await db.update(checkoutSessions).set({ callAssignedTo: m.id, callAssignedAt: new Date() }).where(eq(checkoutSessions.id, s.id));
  }
  if (real.length) await db.update(stores).set({ abandonRr: rr % 1_000_000 }).where(eq(stores.id, store.id));
  return real.length;
}

/** Runs with the auto-ship timer, so checkouts reach callers even if nobody has the page open. */
export async function assignAllAbandoned() {
  const owners = await db.selectDistinct({ ownerId: teamMembers.ownerId }).from(teamMembers)
    .where(and(eq(teamMembers.scope, "owner"), eq(teamMembers.active, true), sql`${teamMembers.perms} @> ${JSON.stringify([ABANDON_PERM])}::jsonb`));
  const ids = owners.map((o) => o.ownerId).filter((x): x is number => x != null);
  if (!ids.length) return;
  for (const s of await db.select().from(stores).where(inArray(stores.ownerId, ids))) await assignAbandoned(s).catch((e) => console.error("[abandoned-calls] assign", s.id, e));
}

export const ABANDON_TABS = ["to_call", "follow_up", "converted", "not_interested", "all"] as const;
export type AbandonTab = (typeof ABANDON_TABS)[number];
const tabOf = (s: Pick<CheckoutSession, "callStatus">): Exclude<AbandonTab, "all"> => (s.callStatus ?? "to_call") as Exclude<AbandonTab, "all">;

/** The cart as the caller sees it: their saved edits, or the customer's own cart. */
export function cartOf(s: Pick<CheckoutSession, "callCart" | "items" | "cartSnapshot">): CallCartLine[] {
  if (s.callCart?.length) return s.callCart;
  const snap = s.cartSnapshot ?? [];
  const same = snap.length === s.items.length;
  return snap.map((l, i) => ({
    variantId: same ? s.items[i].variantId : null, title: l.title, variantTitle: l.variantTitle, image: l.image,
    quantity: l.quantity, pricePaise: l.pricePaise, listPaise: l.pricePaise,
  }));
}

/** Fields the customer didn't fill in. */
export function missingFields(c: Partial<OrderCustomer>) {
  const out: string[] = [];
  if (!c.firstName?.trim()) out.push("Name");
  if ((c.address1 ?? "").trim().length < 5) out.push("Address");
  if (!c.city?.trim()) out.push("City");
  if (!INDIAN_STATES.some((s) => s.code === c.state)) out.push("State");
  if (!/^\d{6}$/.test(c.pincode ?? "")) out.push("Pincode");
  return out;
}

/**
 * Everything the abandoned calling tab shows. `me` = the caller's team member id (null for the owner / a manager,
 * who see every caller's checkouts). Open checkouts (to call / follow-up) are re-checked so a customer who ordered
 * by themselves, or got blocked, drops out.
 */
export async function abandonBoard(store: Store, me: number | null, tab: AbandonTab, query = "") {
  await assignAbandoned(store);
  const team = await abandonCallersFor(store);
  const since = new Date(Date.now() - 30 * 86400_000);
  const rows = await db.select().from(checkoutSessions).where(and(
    eq(checkoutSessions.storeId, store.id), gte(checkoutSessions.createdAt, since),
    me == null ? isNotNull(checkoutSessions.callAssignedTo) : eq(checkoutSessions.callAssignedTo, me),
  )).orderBy(desc(checkoutSessions.updatedAt)).limit(1000);
  const open = rows.filter((r) => r.callStatus == null || r.callStatus === "follow_up");
  const stillTrue = new Set((await filterTrueAbandoned(open)).map((r) => r.id));
  const live = rows.filter((r) => (r.callStatus == null || r.callStatus === "follow_up") ? stillTrue.has(r.id) : true);
  const counts = { to_call: 0, follow_up: 0, converted: 0, not_interested: 0, all: live.length };
  for (const r of live) counts[tabOf(r)]++;
  const q = query.trim().toLowerCase();
  const digits = q.replace(/\D/g, "").slice(-10);
  const list = live
    .filter((r) => tab === "all" || tabOf(r) === tab)
    .filter((r) => !q || [r.customer?.firstName, r.customer?.lastName, r.customer?.city].filter(Boolean).join(" ").toLowerCase().includes(q)
      || (digits.length === 10 && normPhone(r.customer?.phone ?? "") === digits) || r.id.toLowerCase().endsWith(q))
    .sort((a, b) => tab === "follow_up"
      ? (a.callFollowUpAt?.getTime() ?? Infinity) - (b.callFollowUpAt?.getTime() ?? Infinity)
      : b.updatedAt.getTime() - a.updatedAt.getTime())
    .slice(0, 200);
  const nameOf = new Map(team.map((t) => [t.id, t.name]));
  const dayStart = (() => { const d = new Date(Date.now() + 5.5 * 3600_000); d.setUTCHours(0, 0, 0, 0); return d.getTime() - 5.5 * 3600_000; })();
  const teamStats = team.map((t) => {
    const mine = live.filter((r) => r.callAssignedTo === t.id);
    return {
      ...t, you: t.id === me,
      waiting: mine.filter((r) => tabOf(r) === "to_call").length, follow: mine.filter((r) => tabOf(r) === "follow_up").length,
      converted: mine.filter((r) => r.callStatus === "converted" && (r.callAt?.getTime() ?? 0) >= dayStart).length,
      lost: mine.filter((r) => r.callStatus === "not_interested" && (r.callAt?.getTime() ?? 0) >= dayStart).length,
    };
  });
  return {
    team: teamStats, counts,
    items: list.map((s) => {
      const c = s.customer ?? {};
      return {
        id: s.id, at: s.createdAt.toISOString(), lastActive: s.updatedAt.toISOString(), tab: tabOf(s),
        stage: s.paymentAttempted ? "Payment not completed" : c.address1 ? "Left after address" : "Left after contact details",
        customer: {
          firstName: c.firstName ?? "", lastName: c.lastName ?? "", email: c.email ?? "", address1: c.address1 ?? "", address2: c.address2 ?? "",
          city: c.city ?? "", state: c.state ?? "", pincode: c.pincode ?? "",
        },
        missing: missingFields(c),
        cart: cartOf(s), edited: Boolean(s.callCart?.length),
        attempts: s.callAttempts, followUpAt: s.callFollowUpAt?.toISOString() ?? null, note: s.callNote ?? "",
        callBy: s.callBy, callAt: s.callAt?.toISOString() ?? null, orderId: s.callOrderId,
        assignee: s.callAssignedTo != null ? nameOf.get(s.callAssignedTo) ?? "Former member" : null, assigneeId: s.callAssignedTo,
      };
    }),
  };
}

/** The checkout, if this caller may work on it (owner / manager: any of the store's). */
async function mine(store: Store, id: string, me: number | null) {
  const [s] = await db.select().from(checkoutSessions).where(and(eq(checkoutSessions.id, id), eq(checkoutSessions.storeId, store.id))).limit(1);
  if (!s) return null;
  if (me != null && s.callAssignedTo !== me) return null;
  return s;
}

/** The customer's number for the caller (counts as a call attempt). */
export async function abandonPhone(store: Store, id: string, me: number | null) {
  const s = await mine(store, id, me);
  if (!s) return { error: "This checkout is assigned to someone else." };
  const phone = normPhone(s.customer?.phone ?? "") ?? "";
  if (!/^\d{10}$/.test(phone)) return { error: "No valid customer number." };
  await db.update(checkoutSessions).set({ callAttempts: sql`${checkoutSessions.callAttempts} + 1` }).where(eq(checkoutSessions.id, s.id));
  return { phone };
}

type Edit = { cart: CallCartLine[]; customer: Partial<OrderCustomer>; shippingPaise?: number; note?: string };

function cleanEdit(e: Edit) {
  const pick = (v: unknown, n: number) => (typeof v === "string" ? v.trim().slice(0, n) : "");
  const cart = (Array.isArray(e.cart) ? e.cart : []).slice(0, 50).map((l) => ({
    variantId: l.variantId ? String(l.variantId).slice(0, 120) : null, productId: l.productId ? String(l.productId).slice(0, 120) : undefined,
    title: pick(l.title, 200) || "Item", variantTitle: pick(l.variantTitle, 120) || null, image: typeof l.image === "string" && /^https?:\/\//.test(l.image) ? l.image : null,
    quantity: Math.max(1, Math.min(99, Math.round(Number(l.quantity) || 1))),
    pricePaise: Math.max(0, Math.min(10_000_000, Math.round(Number(l.pricePaise) || 0))),
    listPaise: Math.max(0, Math.round(Number(l.listPaise) || 0)),
  }));
  const c = e.customer ?? {};
  const customer = {
    firstName: pick(c.firstName, 80), lastName: pick(c.lastName, 80), email: pick(c.email, 120), address1: pick(c.address1, 300), address2: pick(c.address2, 300),
    city: pick(c.city, 80), state: pick(c.state, 4).toUpperCase(), pincode: pick(c.pincode, 6).replace(/\D/g, ""),
  };
  return { cart, customer, shippingPaise: Math.max(0, Math.min(100_000, Math.round(Number(e.shippingPaise) || 0))), note: pick(e.note, 300) };
}

/** Saves the caller's changes (cart, details) without placing the order. */
export async function saveAbandonEdit(store: Store, id: string, me: number | null, e: Edit) {
  const s = await mine(store, id, me);
  if (!s) return { error: "This checkout is assigned to someone else." };
  if (s.callStatus === "converted") return { error: "This checkout is already an order." };
  const d = cleanEdit(e);
  await db.update(checkoutSessions).set({ callCart: d.cart, customer: { ...(s.customer ?? {}), ...d.customer } }).where(eq(checkoutSessions.id, s.id));
  return { ok: "Saved." };
}

/** Follow-up later, or not interested. */
export async function abandonOutcome(store: Store, id: string, me: number | null, by: string, kind: "follow_up" | "not_interested", followUpAt: Date | null, note: string) {
  const s = await mine(store, id, me);
  if (!s) return { error: "This checkout is assigned to someone else." };
  if (s.callStatus === "converted") return { error: "This checkout is already an order." };
  const text = note.trim().slice(0, 300);
  await db.update(checkoutSessions).set({
    callStatus: kind, callAt: new Date(), callBy: by.slice(0, 120),
    callFollowUpAt: kind === "follow_up" ? followUpAt ?? new Date(Date.now() + 3600_000) : null,
    ...(text ? { callNote: s.callNote ? `${s.callNote}\n${text}` : text } : {}),
  }).where(eq(checkoutSessions.id, s.id));
  return { ok: kind === "follow_up" ? "Moved to follow-up." : "Marked not interested." };
}

/** Places the COD order from the call (edited cart, price and details) and sends it to the courier. */
export async function convertAbandoned(store: Store, id: string, me: number | null, by: string, e: Edit) {
  const s = await mine(store, id, me);
  if (!s) return { error: "This checkout is assigned to someone else." };
  if (s.callStatus === "converted" || s.callOrderId) return { error: "This checkout is already an order." };
  const d = cleanEdit(e);
  if (!d.cart.length) return { error: "Add at least one product." };
  if (d.cart.some((l) => !l.variantId)) return { error: "Remove the items marked unavailable, or add them again from the product search." };
  const phone = normPhone(s.customer?.phone ?? "") ?? "";
  if (!/^[6-9]\d{9}$/.test(phone)) return { error: "This checkout has no valid mobile number." };
  const c = d.customer;
  if (!c.lastName && /\s/.test(c.firstName)) { const [f, ...r] = c.firstName.split(/\s+/); c.firstName = f; c.lastName = r.join(" "); }
  const miss = missingFields(c);
  if (miss.length) return { error: `Fill in: ${miss.join(", ")}.` };
  const customer: OrderCustomer = { firstName: c.firstName, lastName: c.lastName, phone, email: c.email || s.customer?.email || "", address1: c.address1, address2: c.address2, city: c.city, state: c.state, pincode: c.pincode };
  const items: OrderLine[] = d.cart.map((l) => ({
    variantId: l.variantId!, productId: l.productId, title: l.title, variantTitle: l.variantTitle, image: l.image, quantity: l.quantity,
    pricePaise: l.pricePaise, comparePaise: l.listPaise > l.pricePaise ? l.listPaise : null,
  }));
  const subtotal = items.reduce((sum, l) => sum + l.pricePaise * l.quantity, 0);
  const total = subtotal + d.shippingPaise;
  // Lock the checkout so two taps (or two people) can't make two orders
  const [lock] = await db.update(checkoutSessions).set({ callOrderId: "pending" })
    .where(and(eq(checkoutSessions.id, s.id), isNull(checkoutSessions.callOrderId))).returning({ id: checkoutSessions.id });
  if (!lock) return { error: "This checkout is already an order." };
  try {
    const now = new Date();
    const stamp: OrderEvent = { at: now.toISOString(), by, text: `Placed and confirmed on call from an abandoned checkout${d.note ? ` (${d.note})` : ""}` };
    const [order] = await db.insert(orders).values({
      id: newOrderId(), storeId: store.id, sessionId: s.id, checkoutChannel: store.smartCheckout ? "premium_checkout" : "native",
      status: "cod_placing", paymentMethod: "cod", customer, items,
      subtotal, paymentDiscount: 0, couponCode: null, couponDiscount: 0, offerDiscount: 0,
      shipping: d.shippingPaise, shippingTitle: d.shippingPaise ? "Delivery" : null, total, paymentFee: 0, tip: 0, advance: null,
      tracking: s.tracking ?? {}, manualTags: [tagFor(store.id)],
      staffNote: `Abandoned checkout recovered on call by ${by}.${d.note ? ` ${d.note}` : ""}`,
      callStatus: "confirmed", callAt: now, callBy: by.slice(0, 120), assignedTo: s.callAssignedTo, assignedAt: now,
      timeline: [stamp],
    }).returning();
    await finalizeOrder(store, order, { status: "cod_placed" });
    await db.update(checkoutSessions).set({
      callOrderId: order.id, callStatus: "converted", callAt: now, callBy: by.slice(0, 120), callFollowUpAt: null,
      callCart: d.cart, customer: { ...(s.customer ?? {}), ...customer },
    }).where(eq(checkoutSessions.id, s.id));
    // Confirmed on the call: book the shipment now (the store's shipping rule still decides)
    void import("./auto-ship.server").then((m) => m.shipNowIfReady(store.id, order.id)).catch((err) => console.error("[auto-ship] now", err));
    console.log(`[abandoned-calls] store ${store.id}: order ${order.id} from checkout ${s.id} by ${by}`);
    return { ok: "Order placed and confirmed. It goes to the courier now.", orderId: order.id };
  } catch (err) {
    await db.update(checkoutSessions).set({ callOrderId: null }).where(and(eq(checkoutSessions.id, s.id), eq(checkoutSessions.callOrderId, "pending")));
    console.error("[abandoned-calls] convert", s.id, err);
    return { error: err instanceof Error ? err.message : "Couldn't place the order." };
  }
}

/** Owner / manager: give a checkout to another caller. */
export async function reassignAbandoned(store: Store, id: string, memberId: number) {
  const team = await abandonCallersFor(store);
  if (!team.some((t) => t.id === memberId)) return { error: "Choose someone from the abandoned calling team." };
  await db.update(checkoutSessions).set({ callAssignedTo: memberId, callAssignedAt: new Date() }).where(and(eq(checkoutSessions.id, id), eq(checkoutSessions.storeId, store.id)));
  return { ok: "Checkout reassigned." };
}

