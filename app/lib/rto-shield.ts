// RTO Shield: block COD or all orders from a customer based on their shipment history with this store.
// Shared by server and browser.

export type ShipStatus = "in_transit" | "delivered" | "rto_transit" | "rto" | "returned" | "cancelled";

export const SHIP_STATUS_LABELS: Record<ShipStatus, string> = {
  in_transit: "In transit",
  delivered: "Delivered",
  rto_transit: "RTO in transit",
  rto: "RTO",
  returned: "Returned",
  cancelled: "Cancelled",
};

export type ShieldAction = "cod" | "all";
export const ACTION_LABELS: Record<ShieldAction, string> = { cod: "Block COD", all: "Block all orders" };

/** Live rules last only while the customer has an order in that status. */
export type LiveRule = { on: boolean; action: ShieldAction };
export type Tier = { count: number; action: ShieldAction };

export type RtoShieldSettings = {
  enabled: boolean;
  neverBlockPrepaid: boolean;
  inTransit: LiveRule; // while an order is on its way
  rtoTransit: LiveRule; // while an order is coming back
  delivered: LiveRule; // after an order is delivered (permanent)
  history: {
    on: boolean;
    countRto: boolean;
    countReturned: boolean;
    tiers: Tier[]; // e.g. 2 → COD, 5 → all (permanent)
  };
};

export const DEFAULT_SHIELD: RtoShieldSettings = {
  enabled: false,
  neverBlockPrepaid: true,
  inTransit: { on: false, action: "cod" },
  rtoTransit: { on: false, action: "cod" },
  delivered: { on: false, action: "cod" },
  history: { on: true, countRto: true, countReturned: false, tiers: [{ count: 2, action: "cod" }, { count: 5, action: "all" }] },
};

export const MAX_TIERS = 4;

const act = (v: unknown): ShieldAction => (v === "all" ? "all" : "cod");
const live = (v: Partial<LiveRule> | undefined, d: LiveRule): LiveRule => ({ on: Boolean(v?.on ?? d.on), action: act(v?.action ?? d.action) });

/** Fills defaults and cleans saved settings (tiers sorted by count, unique, 1..99). */
export function resolveShield(raw: Partial<RtoShieldSettings> | null | undefined): RtoShieldSettings {
  const r = raw ?? {};
  const h: Partial<RtoShieldSettings["history"]> = r.history ?? {};
  const tiers = (Array.isArray(h.tiers) ? h.tiers : DEFAULT_SHIELD.history.tiers)
    .map((t) => ({ count: Math.max(1, Math.min(99, Math.floor(Number(t?.count) || 0))), action: act(t?.action) }))
    .filter((t, i, a) => t.count >= 1 && a.findIndex((x) => x.count === t.count) === i)
    .sort((a, b) => a.count - b.count)
    .slice(0, MAX_TIERS);
  return {
    enabled: Boolean(r.enabled),
    neverBlockPrepaid: r.neverBlockPrepaid ?? DEFAULT_SHIELD.neverBlockPrepaid,
    inTransit: live(r.inTransit, DEFAULT_SHIELD.inTransit),
    rtoTransit: live(r.rtoTransit, DEFAULT_SHIELD.rtoTransit),
    delivered: live(r.delivered, DEFAULT_SHIELD.delivered),
    history: {
      on: h.on ?? DEFAULT_SHIELD.history.on,
      countRto: h.countRto ?? true,
      countReturned: h.countReturned ?? false,
      tiers,
    },
  };
}

export type ShipCounts = Partial<Record<ShipStatus, number>>;
export type ShieldHit = { scope: ShieldAction; reason: string };

/** Pure decision from a customer's shipment counts. The strongest matching rule wins. */
export function decideShield(s: RtoShieldSettings, c: ShipCounts): ShieldHit | null {
  if (!s.enabled) return null;
  const hits: ShieldHit[] = [];
  if (s.inTransit.on && (c.in_transit ?? 0) > 0) hits.push({ scope: s.inTransit.action, reason: "in_transit" });
  if (s.rtoTransit.on && (c.rto_transit ?? 0) > 0) hits.push({ scope: s.rtoTransit.action, reason: "rto_transit" });
  if (s.delivered.on && (c.delivered ?? 0) > 0) hits.push({ scope: s.delivered.action, reason: "delivered" });
  if (s.history.on) {
    const n = (s.history.countRto ? (c.rto ?? 0) + (c.rto_transit ?? 0) : 0) + (s.history.countReturned ? c.returned ?? 0 : 0);
    const tier = [...s.history.tiers].reverse().find((t) => n >= t.count);
    if (tier) hits.push({ scope: tier.action, reason: `history:${n}` });
  }
  if (!hits.length) return null;
  const strongest = hits.find((h) => h.scope === "all") ?? hits[0];
  if (strongest.scope === "all" && s.neverBlockPrepaid) return { scope: "cod", reason: strongest.reason };
  return strongest;
}

export const SHIELD_MESSAGE: Record<ShieldAction, string> = {
  cod: "Cash on Delivery isn't available for this number right now. You can pay online.",
  all: "We can't take an order from this number right now. Please contact the store for help.",
};

/** Plain-language reason for the dashboard. */
export function reasonText(reason: string) {
  if (reason === "in_transit") return "Has an order in transit";
  if (reason === "rto_transit") return "Has an order coming back (RTO)";
  if (reason === "delivered") return "Has a delivered order";
  if (reason.startsWith("history:")) return `${reason.split(":")[1]} RTO / returns`;
  return reason;
}

/** Filter tabs on the logistics page. */
export const SHIP_FILTERS = ["all", "in_transit", "delivered", "rto_transit", "rto", "returned"] as const;
export type ShipFilter = (typeof SHIP_FILTERS)[number];
