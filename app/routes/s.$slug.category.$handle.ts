// Growpefy Store storefront preview: category page (/category/<handle>).
import { redirect, type LoaderFunctionArgs } from "@remix-run/node";
import { collectionPage } from "~/lib/storefront-pages.server";
import { previewContext } from "~/lib/storefront.server";
import { movedTo } from "~/lib/storefront-paths";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  if (params.handle === "all") throw redirect(movedTo(request, `/s/${encodeURIComponent(params.slug ?? "")}/products/all`), 301);
  return collectionPage(await previewContext(request, params.slug), params.handle ?? "all", request);
};
