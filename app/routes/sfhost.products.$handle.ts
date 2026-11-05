// A store's own domain: product page.
import type { LoaderFunctionArgs } from "@remix-run/node";
import { domainContext, productPage } from "~/lib/storefront-pages.server";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const ctx = await domainContext(request);
  if (!ctx) throw new Response("Not found", { status: 404 });
  return productPage(ctx, params.handle ?? "");
}
