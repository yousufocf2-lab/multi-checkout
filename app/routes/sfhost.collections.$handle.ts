// A store's own domain: category page.
import type { LoaderFunctionArgs } from "@remix-run/node";
import { collectionPage, domainContext } from "~/lib/storefront-pages.server";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const ctx = await domainContext(request);
  if (!ctx) throw new Response("Not found", { status: 404 });
  return collectionPage(ctx, params.handle ?? "all");
}
