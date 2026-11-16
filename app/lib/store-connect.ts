// Special logic → Store data connect (super admin only; stores never see it).
// Connected stores share customer order data: while a customer has a live order on another
// connected store, Cash on Delivery is blocked for them. Prepaid always stays open.
import type { StoreConnectGroup } from "~/db/schema";

export const MIN_STORES = 2;
export const MAX_STORES = 10;
export const MAX_GROUPS = 20;
/** An order that was placed but never shipped stops counting after this many days. */
export const PLACED_WINDOW_DAYS = 30;

export const DEFAULT_BLOCK_ON: StoreConnectGroup["blockOn"] = { placed: true, inTransit: true, delivered: true };

export function newGroupId() {
  return Math.random().toString(36).slice(2, 10);
}

/** Cleans saved groups: valid ids, 2–10 unique stores, a store in one group only (first group wins). */
export function resolveGroups(raw: unknown, knownStoreIds?: Set<number>): StoreConnectGroup[] {
  const list = Array.isArray(raw) ? raw : [];
  const taken = new Set<number>();
  const out: StoreConnectGroup[] = [];
  for (const g of list.slice(0, MAX_GROUPS)) {
    if (!g || typeof g !== "object") continue;
    const r = g as Partial<StoreConnectGroup>;
    const ids = (Array.isArray(r.storeIds) ? r.storeIds : [])
      .map((n) => Math.floor(Number(n)))
      .filter((n, i, a) => n > 0 && a.indexOf(n) === i && (!knownStoreIds || knownStoreIds.has(n)) && !taken.has(n))
      .slice(0, MAX_STORES);
    ids.forEach((n) => taken.add(n));
    const b: Partial<StoreConnectGroup["blockOn"]> = r.blockOn ?? {};
    out.push({
      id: typeof r.id === "string" && /^[a-z0-9]{4,16}$/.test(r.id) ? r.id : newGroupId(),
      name: String(r.name ?? "").trim().slice(0, 60) || "Connected stores",
      enabled: Boolean(r.enabled) && ids.length >= MIN_STORES,
      storeIds: ids,
      blockOn: { placed: b.placed ?? DEFAULT_BLOCK_ON.placed, inTransit: b.inTransit ?? DEFAULT_BLOCK_ON.inTransit, delivered: b.delivered ?? DEFAULT_BLOCK_ON.delivered },
      sameStore: Boolean(r.sameStore),
    });
  }
  return out;
}

export type LinkedHit = { orderId: string; storeId: number; state: "placed" | "in_transit" | "delivered"; createdAt: string };

export const STATE_LABEL: Record<LinkedHit["state"], string> = { placed: "Placed, not shipped yet", in_transit: "Shipped / in transit", delivered: "Delivered" };
