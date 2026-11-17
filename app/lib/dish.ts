// Restaurant dishes: veg / non-veg / egg, "sold out today", and add-on groups (extra cheese, dips…).
// Stored on catalog_items.extra; shared by the editor, the storefront and checkout pricing.
//
// Add-ons ride along inside the cart line's variant id, so every existing step (cart, checkout
// session, order lines, stock) keeps working unchanged: "gp:123~a=0.1,1.0" = variant 123 with
// option 1 of group 0 and option 0 of group 1. Prices always come from the catalog, never the browser.

export type Diet = "veg" | "nonveg" | "egg";
export type AddonOption = { name: string; price: number }; // ₹
export type AddonGroup = { name: string; min: number; max: number; options: AddonOption[] };
export type DishInfo = { diet: Diet | null; soldOut: boolean; spicy: 0 | 1 | 2 | 3; bestseller: boolean; serves: string; addons: AddonGroup[] };

export const DIET_LABEL: Record<Diet, string> = { veg: "Veg", nonveg: "Non-veg", egg: "Contains egg" };

const clamp = (n: number, lo: number, hi: number) => (Number.isFinite(n) ? Math.min(hi, Math.max(lo, Math.round(n))) : lo);

export function resolveAddons(raw: unknown): AddonGroup[] {
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, 8).flatMap((g): AddonGroup[] => {
    if (!g || typeof g !== "object") return [];
    const r = g as Partial<AddonGroup>;
    const options = (Array.isArray(r.options) ? r.options : []).slice(0, 20)
      .map((o) => ({ name: String(o?.name ?? "").trim().slice(0, 60), price: clamp(Number(o?.price ?? 0), 0, 100000) }))
      .filter((o) => o.name);
    if (!options.length) return [];
    const max = clamp(Number(r.max ?? options.length), 1, options.length);
    return [{ name: String(r.name ?? "").trim().slice(0, 60) || "Add-ons", min: clamp(Number(r.min ?? 0), 0, max), max, options }];
  });
}

export function dishOf(extra: unknown): DishInfo {
  const x = (extra && typeof extra === "object" ? extra : {}) as Record<string, unknown>;
  const d = x.diet;
  return {
    diet: d === "veg" || d === "nonveg" || d === "egg" ? d : null,
    soldOut: Boolean(x.soldOut),
    spicy: clamp(Number(x.spicy ?? 0), 0, 3) as DishInfo["spicy"],
    bestseller: Boolean(x.bestseller),
    serves: String(x.serves ?? "").slice(0, 30),
    addons: resolveAddons(x.addons),
  };
}

/** "gp:123~a=0.1,1.0" → base "gp:123" and [[0,1],[1,0]]. */
export function splitAddons(variantId: string): { base: string; picks: [number, number][] } {
  const i = variantId.indexOf("~a=");
  if (i < 0) return { base: variantId, picks: [] };
  const picks = variantId.slice(i + 3).split(",").map((p) => p.split(".").map(Number) as [number, number])
    .filter(([g, o]) => Number.isInteger(g) && Number.isInteger(o) && g >= 0 && o >= 0).slice(0, 40);
  return { base: variantId.slice(0, i), picks };
}

export function joinAddons(base: string, picks: [number, number][]) {
  const uniq = [...new Set(picks.map(([g, o]) => `${g}.${o}`))].sort();
  return uniq.length ? `${base}~a=${uniq.join(",")}` : base;
}

/**
 * Checks the picked add-ons against the dish. Returns the chosen options (with prices) or an error
 * when a required group is missing or a group has too many.
 */
export function pricedAddons(groups: AddonGroup[], picks: [number, number][]): { ok: true; chosen: { group: string; name: string; price: number }[] } | { ok: false; error: string } {
  const chosen: { group: string; name: string; price: number }[] = [];
  for (const [gi, g] of groups.entries()) {
    const mine = [...new Set(picks.filter(([x]) => x === gi).map(([, o]) => o))].filter((o) => o < g.options.length);
    if (mine.length < g.min) return { ok: false, error: `Choose ${g.min === 1 ? "an option" : `${g.min} options`} for ${g.name}` };
    if (mine.length > g.max) return { ok: false, error: `Choose up to ${g.max} for ${g.name}` };
    for (const o of mine) chosen.push({ group: g.name, name: g.options[o].name, price: g.options[o].price });
  }
  return { ok: true, chosen };
}
