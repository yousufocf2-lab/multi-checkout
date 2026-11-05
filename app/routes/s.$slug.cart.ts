// Growpefy Store storefront: cart page (the cart itself lives in the shopper's browser).
import type { LoaderFunctionArgs } from "@remix-run/node";
import { baseScope, html, previewContext, renderPage, sectionData } from "~/lib/storefront.server";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const ctx = await previewContext(request, params.slug);
  const scope = await baseScope(ctx);
  return html(await renderPage("swift", "cart", { ...scope, template: "cart", page_title: "Cart" }, sectionData(ctx)));
}
