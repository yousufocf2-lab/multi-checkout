// A store's own domain: category page (/category/<handle>).
import { redirect, type LoaderFunctionArgs } from "@remix-run/node";
import { collectionPage, domainContext } from "~/lib/storefront-pages.server";
import { movedTo } from "~/lib/storefront-paths";

export async function loader({ request, params }: LoaderFunctionArgs) {
  if (params.handle === "all") throw redirect(movedTo(request, "/products/all"), 301);
  const ctx = await domainContext(request);
  if (!ctx) throw new Response("Not found", { status: 404 });
  return collectionPage(ctx, params.handle ?? "all", request);
}
