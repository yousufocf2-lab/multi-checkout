// Growpefy Store storefront (preview at /s/<store>): home page.
import type { LoaderFunctionArgs } from "@remix-run/node";
import { baseScope, html, loadProducts, previewContext, renderPage, sectionData } from "~/lib/storefront.server";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const ctx = await previewContext(request, params.slug);
  const [scope, first] = await Promise.all([baseScope(ctx), loadProducts(ctx, { limit: 1 })]);
  return html(await renderPage("swift", "index", {
    ...scope, template: "index", page_title: ctx.store.name, hero_image: first[0]?.featured_image ?? null, og_image: first[0]?.featured_image ?? null,
  }, sectionData(ctx)));
}
