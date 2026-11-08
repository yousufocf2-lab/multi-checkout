// When a store's orders go to the courier on their own. Shared by the server (auto-ship) and the settings page.
import type { Order, Store } from "~/db/schema";

export type ShipRule = {
  mode: "off" | "all" | "confirmed"; // off = ship by hand from Orders; all = every order; confirmed = only confirmed orders
  by: "whatsapp" | "team" | "either"; // with "confirmed": who confirms (customer on WhatsApp, the calling team, or either)
  prepaidNow: boolean; // prepaid orders ship right away, without any confirmation
};

/** The store's rule; stores from before rules existed keep their old behaviour (WhatsApp confirmation if it was on). */
export function shipRuleOf(store: Pick<Store, "shipRule" | "autoShip" | "confirmEnabled" | "confirmWhatsapp" | "confirmWaCod">): ShipRule {
  if (store.shipRule) return store.shipRule;
  if (!store.autoShip) return { mode: "off", by: "whatsapp", prepaidNow: true };
  const wa = store.confirmEnabled && store.confirmWhatsapp && store.confirmWaCod;
  return { mode: wa ? "confirmed" : "all", by: "whatsapp", prepaidNow: true };
}

export function cleanShipRule(v: Partial<ShipRule>): ShipRule {
  return {
    mode: v.mode === "off" || v.mode === "confirmed" ? v.mode : "all",
    by: v.by === "team" || v.by === "either" ? v.by : "whatsapp",
    prepaidNow: Boolean(v.prepaidNow),
  };
}

/** Is this order cleared to ship by the rule (ignoring the 10-minute wait)? */
export function ruleAllows(rule: ShipRule, o: Pick<Order, "paymentMethod" | "confirmStatus" | "callStatus">) {
  if (o.confirmStatus === "cancelled" || o.callStatus === "cancelled") return false; // cancelled on WhatsApp or on a call: never
  if (rule.mode === "off") return false;
  if (rule.mode === "all") return true;
  if (o.paymentMethod === "prepaid" && rule.prepaidNow) return true;
  const wa = o.confirmStatus === "confirmed", team = o.callStatus === "confirmed";
  return rule.by === "whatsapp" ? wa : rule.by === "team" ? team : wa || team;
}

/** Does the calling team need to call this order? (Not when it ships without them.) */
export function needsCall(rule: ShipRule, o: Pick<Order, "paymentMethod" | "confirmStatus">) {
  if (o.confirmStatus === "cancelled") return false;
  if (o.paymentMethod === "prepaid" && (rule.prepaidNow || rule.mode === "all")) return false;
  if (rule.mode === "confirmed" && rule.by !== "team" && o.confirmStatus === "confirmed") return false; // WhatsApp already confirmed it
  return true;
}
