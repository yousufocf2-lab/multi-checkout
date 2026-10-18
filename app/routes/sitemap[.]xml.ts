import { SITE_URL } from "~/components/site/SiteLayout";

const PAGES = ["/", "/pricing", "/contact", "/terms", "/privacy", "/refund-policy", "/shipping-policy", "/signup", "/login"];

export const loader = () =>
  new Response(
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${PAGES.map((p) => `  <url><loc>${SITE_URL}${p}</loc></url>`).join("\n")}\n</urlset>\n`,
    { headers: { "Content-Type": "application/xml; charset=utf-8", "Cache-Control": "public, max-age=3600" } },
  );
