// A store's own domain: old /collections/<handle> links move to /category/<handle> (and /collections/all to /products/all).
import { redirect, type LoaderFunctionArgs } from "@remix-run/node";
import { movedTo } from "~/lib/storefront-paths";

export async function loader({ request, params }: LoaderFunctionArgs) {
  throw redirect(movedTo(request, params.handle === "all" ? "/products/all" : `/category/${encodeURIComponent(params.handle ?? "")}`), 301);
}
