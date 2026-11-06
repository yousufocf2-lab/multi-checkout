// Home page extras: what needs attention right now (to ship, to confirm, abandoned, stock) and the new-store setup guide.
import { and, eq, gte, inArray, isNull, like, ne, or, sql } from "drizzle-orm";
import { checkoutSessions, db, orders, type Store } from "~/db.server";
import { catalogStats } from "./catalog.server";
import { themeRow } from "./themes.server";

const OK = ["paid", "cod_placed"];

export type HomeTasks = {
  toShip: number;
  toConfirm: number;
  abandoned: { n: number; value: number }; // last 7 days, rupees
  failedToday: number;
  stock: { out: number; low: number } | null; // null when no store in scope runs its own catalog
  liveCheckouts: number; // checkouts touched in the last 5 minutes
};

export async function homeTasks(scope: Store[]): Promise<HomeTasks> {
  const ids = scope.length ? scope.map((s) => s.id) : [-1];
  const week = new Date(Date.now() - 7 * 86400_000);
  const today = new Date(`${new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date())}T00:00:00+05:30`);
  const catalogStores = scope.filter((s) => s.storefrontEnabled);

  const [ship, confirm, abandoned, failed, live, stocks] = await Promise.all([
    db.select({ n: sql<number>`count(*)::int` }).from(orders).where(and(
      inArray(orders.storeId, ids), inArray(orders.status, OK), like(orders.shopifyOrderId, "gp:%"), isNull(orders.awb),
      or(isNull(orders.confirmStatus), ne(orders.confirmStatus, "cancelled")),
    )),
    // COD orders whose WhatsApp confirmation went out and the customer hasn't answered yet
    db.select({ n: sql<number>`count(*)::int` }).from(orders).where(and(
      inArray(orders.storeId, ids), eq(orders.status, "cod_placed"), eq(orders.confirmStatus, "sent"), gte(orders.createdAt, week), isNull(orders.awb),
    )),
    db.select({ n: sql<number>`count(*)::int`, value: sql<string>`coalesce(sum(${checkoutSessions.cartValue}), 0)` }).from(checkoutSessions).where(and(
      inArray(checkoutSessions.storeId, ids), gte(checkoutSessions.createdAt, week),
      sql`${checkoutSessions.updatedAt} < now() - interval '30 minutes'`,
      sql`not exists (select 1 from ${orders} o where o.session_id = ${checkoutSessions.id} and o.status in ('paid','cod_placed'))`,
    )),
    db.select({ n: sql<number>`count(*)::int` }).from(orders).where(and(inArray(orders.storeId, ids), eq(orders.status, "failed"), gte(orders.createdAt, today))),
    db.select({ n: sql<number>`count(*)::int` }).from(checkoutSessions).where(and(inArray(checkoutSessions.storeId, ids), sql`${checkoutSessions.updatedAt} > now() - interval '5 minutes'`)),
    catalogStores.length && catalogStores.length <= 10 ? Promise.all(catalogStores.map((s) => catalogStats(s.id))) : Promise.resolve(null),
  ]);

  return {
    toShip: ship[0]?.n ?? 0,
    toConfirm: confirm[0]?.n ?? 0,
    abandoned: { n: Number(abandoned[0]?.n ?? 0), value: Number(abandoned[0]?.value ?? 0) / 100 },
    failedToday: failed[0]?.n ?? 0,
    stock: stocks ? stocks.reduce((a, x) => ({ out: a.out + Number(x.out), low: a.low + Number(x.low) }), { out: 0, low: 0 }) : null,
    liveCheckouts: live[0]?.n ?? 0,
  };
}

export type SetupStep = { id: string; title: string; text: string; done: boolean; cta: string; to: string };

/** Setup guide for one store on Growpefy's own website builder. Hidden once every step is done. */
export async function setupGuide(store: Store, base: string): Promise<SetupStep[] | null> {
  if (!store.storefrontEnabled) return null;
  const [stats, theme, firstOrder] = await Promise.all([
    catalogStats(store.id),
    themeRow(store.id),
    db.select({ id: orders.id }).from(orders).where(and(eq(orders.storeId, store.id), inArray(orders.status, OK))).limit(1),
  ]);
  const steps: SetupStep[] = [
    { id: "product", title: "Add your first product", text: "Write a description, add photos and set a price.", done: Number(stats.active) > 0, cta: "Add product", to: `${base}/catalog/new` },
    { id: "theme", title: "Customize your online store", text: "Pick a theme, add your colours and banners, then publish.", done: Boolean(theme?.publishedAt), cta: "Customize theme", to: `${base}/themes` },
    { id: "logo", title: "Add your logo", text: "It shows on your website, checkout and invoices.", done: Boolean(store.logoUrl), cta: "Add logo", to: `${base}/settings` },
    { id: "payments", title: "Set up online payments", text: "Connect a payment gateway so customers can pay by UPI and cards.", done: (store.gateways ?? []).length > 0, cta: "Set up payments", to: `${base}/settings` },
    { id: "domain", title: "Connect your domain", text: "Use your own address, like www.yourbrand.com.", done: Boolean(store.storefrontDomain), cta: "Connect domain", to: `${base}/website` },
    { id: "order", title: "Get your first order", text: "Share your store link. Your first order shows up here.", done: firstOrder.length > 0, cta: "View store", to: store.storefrontDomain ? `https://${store.storefrontDomain}` : `/s/${store.slug}` },
  ];
  return steps.every((s) => s.done) ? null : steps;
}
