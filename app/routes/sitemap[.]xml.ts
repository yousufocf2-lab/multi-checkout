import { SITE_URL } from "~/components/site/SiteLayout";

// [path, change frequency, priority]
const PAGES: [string, string, string][] = [
  ["/", "weekly", "1.0"], ["/pricing", "monthly", "0.9"], ["/about", "monthly", "0.7"], ["/contact", "monthly", "0.7"],
  ["/signup", "yearly", "0.6"], ["/terms", "yearly", "0.3"], ["/privacy", "yearly", "0.3"], ["/refund-policy", "yearly", "0.3"], ["/shipping-policy", "yearly", "0.3"],
];
const UPDATED = "2026-10-24";

export const loader = () =>
  new Response(
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${PAGES.map(([p, f, pr]) => `  <url><loc>${SITE_URL}${p}</loc><lastmod>${UPDATED}</lastmod><changefreq>${f}</changefreq><priority>${pr}</priority></url>`).join("\n")}\n</urlset>\n`,
    { headers: { "Content-Type": "application/xml; charset=utf-8", "Cache-Control": "public, max-age=3600" } },
  );
