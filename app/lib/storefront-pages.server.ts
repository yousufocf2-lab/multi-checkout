// The storefront's pages, shared by the preview (/s/<store>/...) and the store's own domain (www.brand.com/...).
import crypto from "node:crypto";
import { eq, or } from "drizzle-orm";
import { checkoutSessions, db, stores } from "~/db.server";
import { catalogLines, GP_PREFIX } from "./catalog.server";
import { clientIp } from "./orders.server";
import { pageByHandle, publishedPage } from "./store-pages.server";
import { renderCustomLiquid, sanitize } from "./custom-liquid.server";
import { PAGE_BLOCKS_CSS } from "./page-blocks";
import { baseScope, frameVars, html, loadProduct, loadProducts, renderPage, sampleProduct, SAMPLE, sectionData, themeLook, type ShopContext } from "./storefront.server";
import { requestHost, storeBaseUrl } from "./urls.server";
import { reviewsForProduct } from "./reviews.server";

const THEME = "swift";
const canonical = (ctx: ShopContext, path: string) => !ctx.preview && ctx.store.storefrontDomain ? `https://${ctx.store.storefrontDomain}${path}` : "";

/** The store whose own domain this request came in on (www.brand.com or brand.com). Null when none. */
export async function domainContext(request: Request): Promise<ShopContext | null> {
  const host = requestHost(request);
  const bare = host.replace(/^www\./, "");
  const [store] = await db.select().from(stores)
    .where(or(eq(stores.storefrontDomain, host), eq(stores.storefrontDomain, bare), eq(stores.storefrontDomain, `www.${bare}`))).limit(1);
  if (!store || !store.active || !store.storefrontDomain) return null;
  // One address per store: brand.com -> www.brand.com (or the other way round)
  if (store.storefrontDomain !== host && (request.method === "GET" || request.method === "HEAD")) {
    const u = new URL(request.url);
    throw new Response(null, { status: 301, headers: { Location: `https://${store.storefrontDomain}${u.pathname.replace(/^\/sfhost/, "")}${u.search}` } });
  }
  return { store, root: "", preview: false, look: await themeLook(store.id) };
}

export async function homePage(ctx: ShopContext) {
  const [scope, first] = await Promise.all([baseScope(ctx), loadProducts(ctx, { limit: 1 })]);
  return html(await renderPage(THEME, "index", {
    ...scope, template: "index", page_title: ctx.store.name, hero_image: first[0]?.featured_image ?? null, og_image: first[0]?.featured_image ?? null, canonical_url: canonical(ctx, "/"),
  }, sectionData(ctx), ctx.look));
}

export async function productPage(ctx: ShopContext, handle: string, reviewSubmitted = false) {
  const product = (await loadProduct(ctx, handle)) ?? (handle === SAMPLE && ctx.look?.editor ? sampleProduct(ctx) : null);
  if (!product) throw await notFound(ctx, "This product isn't available any more. Have a look at everything else in the shop.");
  const scope = await baseScope(ctx);
  const reviewData = product.id ? await reviewsForProduct(ctx.store.id, Number(product.id)) : { rows: [], count: 0, average: 0 };
  return html(await renderPage(THEME, "product", {
    ...scope, template: "product", product,
    reviews: reviewData.rows, review_count: reviewData.count, review_average: reviewData.average, review_submitted: reviewSubmitted,
    page_title: product.seo_title || product.title, page_description: product.seo_description || product.description, og_image: product.featured_image, canonical_url: canonical(ctx, `/product/${product.handle || handle}`),
  }, sectionData(ctx, { exclude: product.id }), ctx.look));
}

export async function collectionPage(ctx: ShopContext, handle: string) {
  const scope = await baseScope(ctx);
  const cat = handle === "all" ? null : scope.collections.find((c) => c.handle === handle);
  if (handle !== "all" && !cat) throw await notFound(ctx, "This category isn't available. Have a look at everything in the shop.");
  const products = await loadProducts(ctx, { category: cat?.handle });
  const collection = { title: cat?.title ?? "All products", description: cat?.description ?? "", handle, products };
  return html(await renderPage(THEME, "collection", { ...scope, template: "collection", collection, page_title: collection.title, canonical_url: canonical(ctx, handle === "all" ? "/products/all" : `/category/${handle}`) }, sectionData(ctx), ctx.look));
}

export async function infoPage(ctx: ShopContext, handle: string) {
  type P = { title: string; handle: string; bodyHtml: string; seoTitle?: string | null; seoDescription?: string | null; layout?: string; hideTitle?: boolean; published?: boolean };
  const page: P | null = (await publishedPage(ctx.store.id, handle))
    ?? (ctx.owner ? await pageByHandle(ctx.store.id, handle) : null)
    ?? (handle === SAMPLE && ctx.look?.editor ? { title: "About us", handle: SAMPLE, bodyHtml: "<p>This is how your pages (shipping policy, returns, about us) look. Add them from the Pages menu.</p>" } : null);
  if (!page) throw await notFound(ctx);
  const scope = await baseScope(ctx);
  // Page content works like a Custom Liquid section: Liquid + HTML/CSS shown directly, code with scripts in a secure frame.
  const settings = (scope as { settings?: Record<string, unknown> }).settings ?? {};
  const out = await renderCustomLiquid(page.bodyHtml, { ...scope, page: { title: page.title, handle: page.handle } }, { id: `page-${page.handle}`.slice(0, 40), editor: false, vars: frameVars(settings) });
  const content = out.error ? sanitize(page.bodyHtml) : out.html;
  const plain = content.replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/\{\{[^}]*\}\}/g, "").replace(/\s+/g, " ").trim();
  return html(await renderPage(THEME, "page", {
    ...scope, template: "page",
    page: { title: page.title, content, handle: page.handle, layout: page.layout === "wide" ? "wide" : "narrow", hide_title: Boolean(page.hideTitle), draft: page.published === false, blocks_css: PAGE_BLOCKS_CSS },
    page_title: page.seoTitle || page.title, page_description: page.seoDescription || plain.slice(0, 160),
    canonical_url: canonical(ctx, `/pages/${handle}`),
  }, sectionData(ctx), ctx.look));
}

/** A friendly "page not found" in the store's own theme (header, footer, a link back to the shop), status 404. */
export async function notFound(ctx: ShopContext, note = "The page you're looking for doesn't exist or has moved.") {
  const scope = await baseScope(ctx);
  const all = `${ctx.root}/products/all`;
  const content = `<div style="text-align:center;padding:24px 0 8px"><p style="margin:0 0 20px">${note}</p><p style="margin:0"><a href="${all}" style="display:inline-block;padding:12px 28px;background:#111;color:#fff;text-decoration:none">Continue shopping</a></p></div>`;
  return html(await renderPage(THEME, "page", {
    ...scope, template: "page",
    page: { title: "Page not found", content, handle: "not-found", layout: "narrow", hide_title: false, draft: false, blocks_css: "" },
    page_title: "Page not found", page_description: "", canonical_url: "",
  }, sectionData(ctx), ctx.look), 404);
}

export async function cartPage(ctx: ShopContext) {
  const scope = await baseScope(ctx);
  return html(await renderPage(THEME, "cart", { ...scope, template: "cart", page_title: "Cart" }, sectionData(ctx), ctx.look));
}

/**
 * Cart -> the Growpefy checkout. Items go in as "gp:<variant id>" so the checkout prices them from the store's own
 * catalog and keeps the order in Growpefy (nothing is created on Shopify).
 */
export async function startCheckout(request: Request, ctx: ShopContext) {
  const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  let body: { lines?: { variantId?: unknown; qty?: unknown }[] } = {};
  try { body = await request.json(); } catch { return reply({ error: "Your cart couldn't be read. Please try again." }, 400); }

  const merged = new Map<string, number>();
  for (const l of (Array.isArray(body.lines) ? body.lines : []).slice(0, 50)) {
    const id = Math.floor(Number(l.variantId));
    const q = Math.floor(Number(l.qty));
    if (!(id > 0) || !(q > 0)) continue;
    const key = `${GP_PREFIX}${id}`;
    merged.set(key, Math.min(20, (merged.get(key) ?? 0) + q));
  }
  const items = [...merged].map(([variantId, quantity]) => ({ variantId, quantity }));
  if (!items.length) return reply({ error: "Your cart is empty." }, 400);

  const lines = await catalogLines(ctx.store, items);
  if (!lines.length) return reply({ error: "These items are sold out or no longer available." }, 409);

  const id = crypto.randomBytes(12).toString("base64url");
  await db.insert(checkoutSessions).values({
    id, storeId: ctx.store.id,
    items: lines.map((l) => ({ variantId: l.variantId, quantity: l.quantity })),
    tracking: { ip: clientIp(request), ua: request.headers.get("user-agent")?.slice(0, 500) ?? undefined, sourceUrl: request.headers.get("referer")?.slice(0, 500) ?? undefined },
  });
  const sum = (xs: { quantity: number }[]) => xs.reduce((n, x) => n + x.quantity, 0);
  return reply({ url: `${storeBaseUrl(ctx.store)}/c/${id}`, note: sum(lines) < sum(items) ? "Some items were sold out and were left out." : null });
}
