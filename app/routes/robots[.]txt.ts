import type { LoaderFunctionArgs } from "@remix-run/node";
import { SITE_URL } from "~/components/site/SiteLayout";
import { isAppHost } from "~/lib/urls.server";
import { domainContext } from "~/lib/storefront-pages.server";

const PRIVATE = ["/dashboard", "/c/", "/pay/", "/order/", "/wallet/", "/api/", "/pg/", "/proxy/", "/payu/", "/google/", "/r/", "/admin", "/onboarding", "/forgot-password"];

/** growpefy.com: index the website. Store checkout domains (*.checkout.growpefy.com): index nothing. */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const ctx = await domainContext(request);
  const body = ctx?.store.platform === "growpefy" && ctx.store.storefrontDomain
    ? `User-agent: *\nAllow: /\nDisallow: /c/\nDisallow: /pay/\nDisallow: /order/\n\nSitemap: https://${ctx.store.storefrontDomain}/sitemap.xml\n`
    : isAppHost(request)
    ? `User-agent: *\nAllow: /\n${PRIVATE.map((p) => `Disallow: ${p}`).join("\n")}\n\nSitemap: ${SITE_URL}/sitemap.xml\n`
    : "User-agent: *\nDisallow: /\n";
  return new Response(body, { headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=3600" } });
};
