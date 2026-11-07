// Old /collections/<handle> links move to /category/<handle> (and /collections/all to /products/all).
import { redirect, type LoaderFunctionArgs } from "@remix-run/node";
import { movedTo } from "~/lib/storefront-paths";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const base = `/s/${encodeURIComponent(params.slug ?? "")}`;
  throw redirect(movedTo(request, params.handle === "all" ? `${base}/products/all` : `${base}/category/${encodeURIComponent(params.handle ?? "")}`), 301);
};
