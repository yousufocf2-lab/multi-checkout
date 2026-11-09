// A store's own domain: searchSuggest (website search).
import type { LoaderFunctionArgs } from "@remix-run/node";
import { domainContext, searchSuggest } from "~/lib/storefront-pages.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const ctx = await domainContext(request);
  if (!ctx) throw new Response("Not found", { status: 404 });
  return searchSuggest(ctx, request);
}
