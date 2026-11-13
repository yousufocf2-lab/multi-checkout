// The storefront's pages, shared by the preview (/s/<store>/...) and the store's own domain (www.brand.com/...).
import crypto from "node:crypto";
import { eq, or } from "drizzle-orm";
import { checkoutSessions, db, stores } from "~/db.server";
import { catalogLines, GP_PREFIX } from "./catalog.server";
import { clientIp } from "./orders.server";
import { pageByHandle, publishedPage } from "./store-pages.server";
import { renderCustomLiquid, sanitize } from "./custom-liquid.server";
import { PAGE_BLOCKS_CSS } from "./page-blocks";
import { baseScope, demoProducts, frameVars, html, loadProduct, loadProducts, loadProductsByIds, renderPage, sampleProduct, SAMPLE, sectionData, themeLook, themeOf, isDemo, type ShopContext } from "./storefront.server";
import { requestHost, storeBaseUrl } from "./urls.server";
import { reviewsForProduct } from "./reviews.server";
import { searchProducts, suggest } from "./search.server";

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
  const sampleHero = ctx.demoPreset === "mira" ? "https://images.unsplash.com/photo-1548036328-c9fa89d128fa?auto=format&fit=crop&w=1800&q=82"
    : ctx.demoPreset === "luma" ? "https://images.unsplash.com/photo-1608248543803-ba4f8c70ae0b?auto=format&fit=crop&w=1800&q=82"
      : ctx.demoPreset === "thread" ? "https://images.unsplash.com/photo-1529139574466-a303027c1d8b?auto=format&fit=crop&w=1800&q=82"
        : ctx.demoPreset === "stride" ? "https://images.unsplash.com/photo-1581285864607-ef85509e7324?auto=format&fit=crop&w=1800&q=82"
          : ctx.demoPreset === "playday" ? "https://images.unsplash.com/photo-1685358268305-c621b38e75d8?auto=format&fit=crop&w=1800&q=82" : null;
  const hero = ctx.demoPreset === "scentelier" ? "https://images.unsplash.com/photo-1594035910387-fea47794261f?auto=format&fit=crop&w=2000&q=85" : sampleHero;
  return html(await renderPage(themeOf(ctx.look?.data), "index", {
    ...scope, template: "index", page_title: ctx.store.name, hero_image: hero ?? first[0]?.featured_image ?? null, og_image: hero ?? first[0]?.featured_image ?? null, canonical_url: canonical(ctx, "/"),
  }, sectionData(ctx), ctx.look));
}

export async function productPage(ctx: ShopContext, handle: string, reviewSubmitted = false) {
  const product = (await loadProduct(ctx, handle))
    ?? (isDemo(ctx) ? demoProducts(ctx).find((p) => p.handle === handle) ?? null : null)
    ?? (handle === SAMPLE && ctx.look?.editor ? sampleProduct(ctx) : null);
  if (!product) throw await notFound(ctx, "This product isn't available any more. Have a look at everything else in the shop.");
  const scope = await baseScope(ctx);
  const reviewData = product.id ? await reviewsForProduct(ctx.store.id, Number(product.id)) : { rows: [], count: 0, average: 0 };
  return html(await renderPage(themeOf(ctx.look?.data), "product", {
    ...scope, template: "product", product,
    reviews: reviewData.rows, review_count: reviewData.count, review_average: reviewData.average, review_submitted: reviewSubmitted,
    page_title: product.seo_title || product.title, page_description: product.seo_description || product.description, og_image: product.featured_image, canonical_url: canonical(ctx, `/product/${product.handle || handle}`),
  }, sectionData(ctx, { exclude: product.id }), ctx.look));
}

export async function collectionPage(ctx: ShopContext, handle: string) {
  const scope = await baseScope(ctx);
  const cat = handle === "all" ? null : scope.collections.find((c) => c.handle === handle);
  if (handle !== "all" && !cat) throw await notFound(ctx, "This category isn't available. Have a look at everything in the shop.");
  const products = isDemo(ctx) ? demoProducts(ctx, cat?.handle) : await loadProducts(ctx, { category: cat?.handle });
  const collection = { title: cat?.title ?? "All products", description: cat?.description ?? "", handle, products };
  return html(await renderPage(themeOf(ctx.look?.data), "collection", { ...scope, template: "collection", collection, page_title: collection.title, canonical_url: canonical(ctx, handle === "all" ? "/products/all" : `/category/${handle}`) }, sectionData(ctx), ctx.look));
}

export async function infoPage(ctx: ShopContext, handle: string) {
  type P = { title: string; handle: string; bodyHtml: string; seoTitle?: string | null; seoDescription?: string | null; layout?: string; hideTitle?: boolean; published?: boolean };
  const miraPages: Record<string, P> = {
    "about-us": { title: "A little about Mira", handle: "about-us", bodyHtml: "<p>We believe the best bags are the ones you reach for every day. Mira brings together thoughtful shapes, considered details and easy-to-carry favourites for wherever life takes you.</p><h2>Made for your everyday</h2><p>From a roomy tote for busy mornings to a hands-free crossbody for weekends, every piece is designed to feel lovely and work hard.</p><p>This is sample copy for the theme preview. Replace it with your own brand story.</p>" },
    "contact-us": { title: "We’re here to help", handle: "contact-us", bodyHtml: `<p>Need help choosing a bag or checking an order? Our customer care team would love to help.</p>${ctx.store.supportPhone ? `<p><strong>Call us:</strong> <a href="tel:${ctx.store.supportPhone}">${ctx.store.supportPhone}</a></p>` : "<p><strong>Call us:</strong> Your store phone number will appear here.</p>"}<p><strong>Hours:</strong> Monday to Saturday, 10:00 am–6:00 pm</p><p>This is sample contact-page content. Add your real support details before publishing.</p>` },
    "shipping-returns": { title: "Shipping & returns", handle: "shipping-returns", bodyHtml: "<h2>Delivery</h2><p>Orders are packed with care and dispatched promptly. Delivery times depend on your location.</p><h2>Returns</h2><p>If something isn’t right, contact our team with your order number and we’ll guide you through the store’s return policy.</p><p>This is sample copy for the theme preview. Replace it with your store’s actual terms.</p>" },
  };
  const lumaPages: Record<string, P> = {
    "about-us": { title: "Our approach to skincare", handle: "about-us", bodyHtml: "<p>Luma makes everyday skincare feel clear, considered and easy to keep up with.</p><h2>Simple steps, thoughtful formulas</h2><p>Our sample routine focuses on gentle cleansing, hydration and daily sun care. This is preview copy—replace it with your own brand story.</p>" },
    "contact-us": { title: "Talk to our care team", handle: "contact-us", bodyHtml: `<p>Questions about a routine or an order? Our team is happy to help.</p>${ctx.store.supportPhone ? `<p><strong>Call us:</strong> <a href="tel:${ctx.store.supportPhone}">${ctx.store.supportPhone}</a></p>` : "<p><strong>Call us:</strong> Your store phone number will appear here.</p>"}<p><strong>Hours:</strong> Monday to Saturday, 10:00 am–6:00 pm</p><p>Sample preview content. Add your real support details before publishing.</p>` },
    "shipping-returns": { title: "Delivery & returns", handle: "shipping-returns", bodyHtml: "<h2>Delivery</h2><p>Orders are packed with care and dispatched promptly. Delivery times depend on your location.</p><h2>Returns</h2><p>Contact our team with your order number and we’ll guide you through the store’s return policy.</p><p>This is sample preview copy; replace it with your actual terms.</p>" },
  };
  const threadPages: Record<string, P> = {
    "about-us": { title: "Made for the everyday", handle: "about-us", bodyHtml: "<p>Thread is about getting dressed without overthinking it. We build dependable pieces with relaxed fits, useful details and room to make them your own.</p><h2>Wear it on repeat</h2><p>Our sample collection is designed to work together, move easily and earn its place in your everyday rotation. Replace this preview story with your brand's own.</p>" },
    "contact-us": { title: "Need a hand?", handle: "contact-us", bodyHtml: `<p>Questions about sizing, fit or an order? Our team can help you find the right piece.</p>${ctx.store.supportPhone ? `<p><strong>Call us:</strong> <a href="tel:${ctx.store.supportPhone}">${ctx.store.supportPhone}</a></p>` : "<p><strong>Call us:</strong> Your store phone number will appear here.</p>"}<p><strong>Hours:</strong> Monday to Saturday, 10:00 am–6:00 pm</p><p>Sample preview content. Add your real support details before publishing.</p>` },
    "shipping-returns": { title: "Shipping & returns", handle: "shipping-returns", bodyHtml: "<h2>Delivery</h2><p>We pack each order with care. Delivery timing depends on your location.</p><h2>Fit not right?</h2><p>Contact our team with your order number and we’ll help you understand the store’s return and exchange policy.</p><p>This is sample preview copy; replace it with your actual terms.</p>" },
  };
  const stridePages: Record<string, P> = {
    "about-us": { title: "Made to keep you moving", handle: "about-us", bodyHtml: "<p>Stride is a footwear studio built around the miles that make up real life: the daily commute, the long walk home and the plans that run late.</p><h2>Find your everyday pace</h2><p>Our sample range balances comfort, considered materials and versatile design. Replace this preview story with your own brand story.</p>" },
    "contact-us": { title: "We can help you find your fit", handle: "contact-us", bodyHtml: `<p>Need help with shoe sizing, fit or an order? Our team is here for you.</p>${ctx.store.supportPhone ? `<p><strong>Call us:</strong> <a href="tel:${ctx.store.supportPhone}">${ctx.store.supportPhone}</a></p>` : "<p><strong>Call us:</strong> Your store phone number will appear here.</p>"}<p><strong>Hours:</strong> Monday to Saturday, 10:00 am–6:00 pm</p><p>Sample preview content. Add your real support details before publishing.</p>` },
    "shipping-returns": { title: "Delivery & easy exchanges", handle: "shipping-returns", bodyHtml: "<h2>Delivery</h2><p>We pack each pair carefully. Delivery timing depends on your location.</p><h2>Finding the right fit</h2><p>If your size isn't quite right, contact our team to understand the store's exchange and return policy.</p><p>This is sample preview copy; replace it with your actual terms.</p>" },
  };
  const playdayPages: Record<string, P> = {
    "about-us": { title: "A little more wonder, every day", handle: "about-us", bodyHtml: "<p>Playday is a happy corner for toys that turn a quiet afternoon into a whole new adventure. We believe good play gives little imaginations plenty of room to grow.</p><h2>Picked for curious minds</h2><p>Our sample shelves bring together playful discoveries for building, learning, make-believe and cuddles. This is preview copy—replace it with your own story.</p>" },
    "contact-us": { title: "Talk to our playroom team", handle: "contact-us", bodyHtml: `<p>Need help picking a gift or finding the right toy? We’re happy to help you choose.</p>${ctx.store.supportPhone ? `<p><strong>Call us:</strong> <a href="tel:${ctx.store.supportPhone}">${ctx.store.supportPhone}</a></p>` : "<p><strong>Call us:</strong> Add your store phone number in settings.</p>"}<p><strong>Email:</strong> Add your customer-care email in the footer settings before publishing this theme.</p><p><strong>Hours:</strong> Monday to Saturday, 10:00 am–6:00 pm</p>` },
    "shipping-returns": { title: "Delivery & returns", handle: "shipping-returns", bodyHtml: "<h2>Delivery</h2><p>We pack each order with care. Delivery timing depends on your location.</p><h2>Returns</h2><p>For help with a return or exchange, contact the store team with your order number. Replace this sample page with your actual policy before publishing.</p>" },
  };
  const scentelierPages: Record<string, P> = {
    "about-us": { title: "A house of considered fragrance", handle: "about-us", bodyHtml: "<p>Scentelier is a study in the way fragrance holds a moment. We bring together expressive notes, thoughtful blends and bottles made to become part of your daily ritual.</p><h2>Find your own signature</h2><p>From bright first impressions to warm, lingering dry-downs, our sample collection is an invitation to explore scent at your own pace.</p><p>This is sample preview copy. Replace it with your own brand story before publishing.</p>" },
    "contact-us": { title: "A note to our fragrance team", handle: "contact-us", bodyHtml: `<p>Need help choosing a scent, gifting or checking an order? We would love to help.</p>${ctx.store.supportPhone ? `<p><strong>Call us:</strong> <a href="tel:${ctx.store.supportPhone}">${ctx.store.supportPhone}</a></p>` : "<p><strong>Call us:</strong> Your store phone number will appear here.</p>"}<p><strong>Email:</strong> Add your customer-care email in the footer settings.</p><p><strong>Hours:</strong> Monday to Saturday, 10:00 am–6:00 pm</p>` },
    "shipping-returns": { title: "Delivery & returns", handle: "shipping-returns", bodyHtml: "<h2>Carefully packed, delivered with care</h2><p>Orders are prepared with care. Delivery timing depends on your location.</p><h2>Need a hand?</h2><p>Contact our team with your order number and we will guide you through the store's delivery and return policy. Replace this sample page with your actual terms before publishing.</p>" },
  };
  const pulsePages: Record<string, P> = {
    "about-us": { title: "Built for the way you listen", handle: "about-us", bodyHtml: "<p>We make audio and wearables that look as good as they sound: earbuds, headphones, smartwatches and speakers designed for everyday life.</p><h2>Design-led, tested hard</h2><p>Every product is tuned for clear calls, long battery and comfort you forget about. This is sample copy for the theme preview; replace it with your own story.</p>" },
    "contact-us": { title: "Support that answers", handle: "contact-us", bodyHtml: `<p>Questions about an order, warranty or a product? Our team is here to help.</p>${ctx.store.supportPhone ? `<p><strong>Call us:</strong> <a href="tel:${ctx.store.supportPhone}">${ctx.store.supportPhone}</a></p>` : "<p><strong>Call us:</strong> Your store phone number will appear here.</p>"}<p><strong>Hours:</strong> Monday to Saturday, 10:00 am–7:00 pm</p>` },
    "shipping-returns": { title: "Shipping, returns & warranty", handle: "shipping-returns", bodyHtml: "<h2>Delivery</h2><p>Orders ship within 24 hours and usually arrive in 3–6 days.</p><h2>Warranty</h2><p>Every product has a 1-year warranty against manufacturing defects. Sample policy for the preview; add your own terms before publishing.</p>" },
  };
  const page: P | null = (await publishedPage(ctx.store.id, handle))
    ?? (ctx.owner ? await pageByHandle(ctx.store.id, handle) : null)
    ?? (ctx.demoPreset === "mira" ? miraPages[handle] ?? null : ctx.demoPreset === "luma" ? lumaPages[handle] ?? null : ctx.demoPreset === "thread" ? threadPages[handle] ?? null : ctx.demoPreset === "stride" ? stridePages[handle] ?? null : ctx.demoPreset === "playday" ? playdayPages[handle] ?? null : ctx.demoPreset === "scentelier" ? scentelierPages[handle] ?? null : ctx.demoPreset === "pulse" ? pulsePages[handle] ?? null : null)
    ?? (handle === SAMPLE && ctx.look?.editor ? { title: "About us", handle: SAMPLE, bodyHtml: "<p>This is how your pages (shipping policy, returns, about us) look. Add them from the Pages menu.</p>" } : null);
  if (!page) throw await notFound(ctx);
  const scope = await baseScope(ctx);
  // Page content works like a Custom Liquid section: Liquid + HTML/CSS shown directly, code with scripts in a secure frame.
  const settings = (scope as { settings?: Record<string, unknown> }).settings ?? {};
  const out = await renderCustomLiquid(page.bodyHtml, { ...scope, page: { title: page.title, handle: page.handle } }, { id: `page-${page.handle}`.slice(0, 40), editor: false, vars: frameVars(settings) });
  const content = out.error ? sanitize(page.bodyHtml) : out.html;
  const plain = content.replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/\{\{[^}]*\}\}/g, "").replace(/\s+/g, " ").trim();
  return html(await renderPage(themeOf(ctx.look?.data), "page", {
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
  return html(await renderPage(themeOf(ctx.look?.data), "page", {
    ...scope, template: "page",
    page: { title: "Page not found", content, handle: "not-found", layout: "narrow", hide_title: false, draft: false, blocks_css: "" },
    page_title: "Page not found", page_description: "", canonical_url: "",
  }, sectionData(ctx), ctx.look), 404);
}

export async function cartPage(ctx: ShopContext) {
  const scope = await baseScope(ctx);
  return html(await renderPage(themeOf(ctx.look?.data), "cart", { ...scope, template: "cart", page_title: "Cart" }, sectionData(ctx), ctx.look));
}

/**
 * Cart -> the Growpefy checkout. Items go in as "gp:<variant id>" so the checkout prices them from the store's own
 * catalog and keeps the order in Growpefy (nothing is created on Shopify).
 */
/** Meta pixel's first-party cookies on the store's domain (_fbp browser id, _fbc ad click id) for Conversions API matching. */
function metaCookies(request: Request) {
  const jar = request.headers.get("cookie") ?? "";
  const get = (k: string) => { const m = jar.match(new RegExp(`(?:^|;\\s*)${k}=([^;]+)`)); if (!m) return undefined; try { return decodeURIComponent(m[1]).slice(0, 200); } catch { return undefined; } };
  const fbp = get("_fbp"), fbc = get("_fbc");
  return { ...(fbp && /^fb\.\d\./.test(fbp) ? { fbp } : {}), ...(fbc && /^fb\.\d\./.test(fbc) ? { fbc } : {}) };
}

export async function startCheckout(request: Request, ctx: ShopContext) {
  const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  let body: { lines?: { variantId?: unknown; qty?: unknown }[]; src?: unknown } = {};
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
    tracking: {
      ip: clientIp(request), ua: request.headers.get("user-agent")?.slice(0, 500) ?? undefined, sourceUrl: request.headers.get("referer")?.slice(0, 500) ?? undefined,
      ...metaCookies(request),
      ...(typeof body.src === "string" && body.src ? { src: body.src.replace(/[^\w.\- ]/g, "").slice(0, 60) } : {}),
    },
  });
  const sum = (xs: { quantity: number }[]) => xs.reduce((n, x) => n + x.quantity, 0);
  return reply({ url: `${storeBaseUrl(ctx.store)}/c/${id}`, note: sum(lines) < sum(items) ? "Some items were sold out and were left out." : null });
}

/** Search results: forgiving matches; when nothing is close, the nearest products and then the rest (never empty). */
export async function searchPage(ctx: ShopContext, request: Request) {
  const q = (new URL(request.url).searchParams.get("q") ?? "").trim().slice(0, 80);
  const [scope, r] = await Promise.all([baseScope(ctx), searchProducts(ctx.store.id, q, 48)]);
  const products = await loadProductsByIds(ctx, r.ids);
  const collection = {
    title: q ? `Results for “${q}”` : "Search", handle: "search", products,
    description: q && !r.exact ? "We couldn't find an exact match, so here are the closest products." : "",
    search: { q, exact: r.exact, categories: r.categories.map((c) => ({ title: c.title, url: `${ctx.root}/category/${c.handle}` })) },
  };
  return html(await renderPage(themeOf(ctx.look?.data), "collection", { ...scope, template: "collection", collection, page_title: collection.title, canonical_url: "" }, sectionData(ctx), ctx.look));
}

/** JSON for the header's live search. */
export async function searchSuggest(ctx: ShopContext, request: Request) {
  const q = (new URL(request.url).searchParams.get("q") ?? "").trim().slice(0, 80);
  return new Response(JSON.stringify(await suggest(ctx.store.id, ctx.root, q)), { headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } });
}
