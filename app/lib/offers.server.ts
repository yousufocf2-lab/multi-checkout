import { and, desc, eq } from "drizzle-orm";
import { db, freeOffers, type FreeOffer, type Store } from "~/db.server";
import type { PaymentMethod, PricedLine } from "./pricing";
import { fetchUpsellProducts } from "./shopify.server";

export type FreeLine = PricedLine & { free: true; offer: string };
export type OfferHint = { offer: string; need: number; gifts: string };

export function activeOffers(storeId: number) {
  return db.select().from(freeOffers).where(and(eq(freeOffers.storeId, storeId), eq(freeOffers.active, true))).orderBy(desc(freeOffers.createdAt));
}

/** How many qualifying items the paid cart has for an offer. */
function qualifyingQty(o: FreeOffer, paid: PricedLine[]) {
  if (o.buyMode === "any") return paid.reduce((n, l) => n + l.quantity, 0);
  const ids = new Set(o.buyProducts.map((p) => p.id));
  return paid.filter((l) => ids.has(l.productId)).reduce((n, l) => n + l.quantity, 0);
}

const allows = (o: FreeOffer, m: PaymentMethod) => o.paymentRestriction === "any" || o.paymentRestriction === m;

/**
 * Free gift lines for the cart, per payment method, plus hints for offers the cart almost qualifies for.
 * Free lines are priced ₹0 (comparePaise keeps the real price for "worth ₹X").
 */
export async function freeGiftsFor(store: Store, paid: PricedLine[], offers?: FreeOffer[]) {
  const list = offers ?? (await activeOffers(store.id));
  const empty = { prepaid: [] as FreeLine[], cod: [] as FreeLine[], hints: [] as OfferHint[] };
  if (!list.length || !paid.length || !store.adminToken) return empty;

  const won = list
    .map((o) => {
      const qty = qualifyingQty(o, paid);
      const min = Math.max(1, o.minQty);
      return { o, qty, min, times: qty >= min ? (o.repeat ? Math.floor(qty / min) : 1) : 0 };
    });

  const giftIds = [...new Set(won.filter((w) => w.times > 0).flatMap((w) => w.o.freeProducts.map((p) => p.id)))];
  let catalog: Awaited<ReturnType<typeof fetchUpsellProducts>> = [];
  if (giftIds.length) {
    try {
      catalog = await fetchUpsellProducts(store, giftIds);
    } catch (e) {
      console.error("[free gifts]", e instanceof Error ? e.message : e);
    }
  }
  const byId = new Map(catalog.map((p) => [p.id, p]));

  const linesFor = (m: PaymentMethod) => {
    const out: FreeLine[] = [];
    for (const w of won) {
      if (!w.times || !allows(w.o, m)) continue;
      for (const ref of w.o.freeProducts) {
        const p = byId.get(ref.id);
        const v = p?.variants.find((x) => x.available);
        if (!p || !v) continue; // sold out gifts are skipped
        const quantity = Math.max(1, w.o.freeQty) * w.times;
        const same = out.find((l) => l.variantId === v.id);
        if (same) { same.quantity += quantity; continue; }
        out.push({
          variantId: v.id, productId: p.id, title: p.title, variantTitle: v.title || null, image: p.image,
          quantity, pricePaise: 0, comparePaise: v.pricePaise, free: true, offer: w.o.name,
        });
      }
    }
    return out;
  };

  const hints: OfferHint[] = won
    .filter((w) => !w.times && (w.qty > 0 || w.o.buyMode === "any") && w.o.paymentRestriction !== "cod")
    .map((w) => ({ offer: w.o.name, need: w.min - w.qty, gifts: w.o.freeProducts.map((p) => p.title).join(", ") }))
    .filter((h) => h.need > 0 && h.need <= 5);

  return { prepaid: linesFor("prepaid"), cod: linesFor("cod"), hints };
}
