// A store's own domain (www.brand.com/): home page. server.mjs sends storefront paths here.
import type { LoaderFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";
import { eq } from "drizzle-orm";
import { db, stores } from "~/db.server";
import { env } from "~/lib/env.server";
import { domainContext, homePage } from "~/lib/storefront-pages.server";
import { requestHost } from "~/lib/urls.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const ctx = await domainContext(request);
  if (ctx) return homePage(ctx);
  // Not a Growpefy Store domain: an old checkout domain (checkout.brand.com) goes to the brand's website
  const [old] = await db.select({ url: stores.storefrontUrl }).from(stores).where(eq(stores.checkoutDomain, requestHost(request))).limit(1);
  throw redirect(old?.url || env.appUrl);
}
