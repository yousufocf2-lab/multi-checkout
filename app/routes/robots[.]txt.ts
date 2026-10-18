import { SITE_URL } from "~/components/site/SiteLayout";

export const loader = () =>
  new Response(`User-agent: *\nAllow: /\nDisallow: /dashboard\nDisallow: /c/\nDisallow: /pay/\nDisallow: /order/\nDisallow: /wallet/\nDisallow: /api/\n\nSitemap: ${SITE_URL}/sitemap.xml\n`, {
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=3600" },
  });
