import { SITE_URL } from "~/components/site/SiteLayout";
import { and, asc, eq } from "drizzle-orm";
import { catalogCategories, catalogItems, db, storePages } from "~/db.server";
import { domainContext } from "~/lib/storefront-pages.server";

// [path, change frequency, priority]
const PAGES: [string, string, string][] = [
  ["/", "weekly", "1.0"], ["/pricing", "monthly", "0.9"], ["/about", "monthly", "0.7"], ["/services", "monthly", "0.8"], ["/contact", "monthly", "0.7"],
  ["/signup", "yearly", "0.6"], ["/terms", "yearly", "0.3"], ["/privacy", "yearly", "0.3"], ["/refund-policy", "yearly", "0.3"], ["/shipping-policy", "yearly", "0.3"],
];
const UPDATED = "2026-11-02";

const xml = (v: string) => v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
const response = (body: string) => new Response(body, { headers: { "Content-Type": "application/xml; charset=utf-8", "Cache-Control": "public, max-age=3600" } });

export const loader = async ({ request }: { request: Request }) => {
  const ctx = await domainContext(request);
  if (ctx?.store.platform === "growpefy" && ctx.store.storefrontDomain) {
    const [products, collections, pages] = await Promise.all([
      db.select({ handle: catalogItems.handle, updatedAt: catalogItems.updatedAt }).from(catalogItems).where(and(eq(catalogItems.storeId, ctx.store.id), eq(catalogItems.status, "active"))).orderBy(asc(catalogItems.handle)).limit(50_000),
      db.select({ handle: catalogCategories.handle, createdAt: catalogCategories.createdAt }).from(catalogCategories).where(eq(catalogCategories.storeId, ctx.store.id)).orderBy(asc(catalogCategories.handle)).limit(10_000),
      db.select({ handle: storePages.handle, updatedAt: storePages.updatedAt }).from(storePages).where(and(eq(storePages.storeId, ctx.store.id), eq(storePages.published, true))).orderBy(asc(storePages.handle)).limit(10_000),
    ]);
    const base = `https://${ctx.store.storefrontDomain}`;
    const entries = [
      { path: "/", date: new Date(), frequency: "weekly", priority: "1.0" },
      { path: "/products/all", date: new Date(), frequency: "daily", priority: "0.9" },
      ...products.map((p) => ({ path: `/product/${p.handle}`, date: p.updatedAt, frequency: "weekly", priority: "0.8" })),
      ...collections.map((c) => ({ path: `/category/${c.handle}`, date: c.createdAt, frequency: "weekly", priority: "0.7" })),
      ...pages.map((p) => ({ path: `/pages/${p.handle}`, date: p.updatedAt, frequency: "monthly", priority: "0.5" })),
    ];
    return response(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries.map((e) => `  <url><loc>${xml(base + e.path)}</loc><lastmod>${e.date.toISOString().slice(0, 10)}</lastmod><changefreq>${e.frequency}</changefreq><priority>${e.priority}</priority></url>`).join("\n")}\n</urlset>\n`);
  }
  return response(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${PAGES.map(([p, f, pr]) => `  <url><loc>${SITE_URL}${p}</loc><lastmod>${UPDATED}</lastmod><changefreq>${f}</changefreq><priority>${pr}</priority></url>`).join("\n")}\n</urlset>\n`);
};
