// Shared shipping engine (client + server). Money in paise.

export type ShipRule = {
  id: number;
  name: string;
  pricePaise: number;
  minOrderRupees: number;
  maxOrderRupees: number | null;
  states: string[];
  pincodePrefixes: string[];
  paymentMethod: string; // any | prepaid | cod
};

export type ShipQuote = { pricePaise: number; name: string; ruleId: number | null; freeAbove: number | null };

const FREE: Omit<ShipQuote, "freeAbove"> = { pricePaise: 0, name: "Free delivery", ruleId: null };

function locationMatches(r: ShipRule, state: string, pincode: string) {
  const zoned = r.states.length > 0 || r.pincodePrefixes.length > 0;
  if (!zoned) return true;
  if (state && r.states.includes(state)) return true;
  return /^\d{6}$/.test(pincode) && r.pincodePrefixes.some((p) => p && pincode.startsWith(p));
}

function pick(rules: ShipRule[], state: string, pincode: string, method: string, value: number) {
  const matches = rules.filter((r) =>
    (r.paymentMethod === "any" || r.paymentMethod === method) &&
    value >= r.minOrderRupees * 100 &&
    (r.maxOrderRupees == null || value <= r.maxOrderRupees * 100) &&
    locationMatches(r, state, pincode),
  );
  if (!matches.length) return FREE;
  // A rate for the customer's state or pincode beats an all-India rate
  const zoned = matches.filter((r) => r.states.length > 0 || r.pincodePrefixes.length > 0);
  const pool = zoned.length ? zoned : matches;
  const best = pool.reduce((a, b) => (b.pricePaise < a.pricePaise ? b : a));
  return { pricePaise: best.pricePaise, name: best.pricePaise === 0 ? best.name || "Free delivery" : best.name, ruleId: best.id };
}

/**
 * Rates for the customer's state/pincode win over all-India rates; among those the cheapest wins.
 * No matching rule means free delivery.
 * `value` is the order value after discounts (what the customer pays for items).
 */
export function quoteShipping(rules: ShipRule[], opts: { state: string; pincode: string; method: string; value: number }): ShipQuote {
  const q = pick(rules, opts.state, opts.pincode, opts.method, opts.value);
  let freeAbove: number | null = null;
  if (q.pricePaise > 0) {
    // Smallest order value above the current one that ships free
    const thresholds = [...new Set(rules.flatMap((r) => [r.minOrderRupees * 100, r.maxOrderRupees != null ? r.maxOrderRupees * 100 + 100 : 0]))]
      .filter((t) => t > opts.value)
      .sort((a, b) => a - b);
    freeAbove = thresholds.find((t) => pick(rules, opts.state, opts.pincode, opts.method, t).pricePaise === 0) ?? null;
  }
  return { ...q, freeAbove };
}

/** Adds a shipping quote to a pricing result. `total` becomes items + shipping. */
export function withShipping<T extends { total: number }>(p: T, q: ShipQuote) {
  return { ...p, itemsTotal: p.total, shipping: q.pricePaise, shippingName: q.name, freeAbove: q.freeAbove, total: p.total + q.pricePaise };
}
