// Growpefy Store storefront: category page (/collections/all = every product).
import type { LoaderFunctionArgs } from "@remix-run/node";
import { baseScope, html, loadProducts, previewContext, renderPage, sectionData } from "~/lib/storefront.server";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const ctx = await previewContext(request, params.slug);
  const scope = await baseScope(ctx);
  const handle = params.handle ?? "all";
  const cat = handle === "all" ? null : scope.collections.find((c) => c.handle === handle);
  if (handle !== "all" && !cat) throw new Response("Not found", { status: 404 });
  const products = await loadProducts(ctx, { category: cat?.handle });
  const collection = { title: cat?.title ?? "All products", description: cat?.description ?? "", handle, products };
  return html(await renderPage("swift", "collection", { ...scope, template: "collection", collection, page_title: collection.title }, sectionData(ctx)));
}
