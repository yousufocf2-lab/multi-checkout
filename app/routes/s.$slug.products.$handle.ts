// Growpefy Store storefront: product page.
import type { LoaderFunctionArgs } from "@remix-run/node";
import { baseScope, html, loadProduct, previewContext, renderPage, sectionData } from "~/lib/storefront.server";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const ctx = await previewContext(request, params.slug);
  const product = await loadProduct(ctx, params.handle ?? "");
  if (!product) throw new Response("Not found", { status: 404 });
  const scope = await baseScope(ctx);
  return html(await renderPage("swift", "product", {
    ...scope, template: "product", product,
    page_title: product.seo_title || product.title, page_description: product.seo_description || product.description, og_image: product.featured_image,
  }, sectionData(ctx, { exclude: product.id })));
}
