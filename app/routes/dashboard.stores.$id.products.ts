import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { requireStore, requireViewer } from "~/lib/auth.server";
import { searchProducts } from "~/lib/shopify.server";

/** JSON product search for the dashboard product picker. */
export async function loader({ request, params }: LoaderFunctionArgs) {
  const store = await requireStore(await requireViewer(request), params.id);
  const q = new URL(request.url).searchParams.get("q") ?? "";
  try {
    const items = await searchProducts(store, q);
    return json({ products: items.map((p) => ({ id: p.id, title: p.title, image: p.image })) });
  } catch (e) {
    return json({ products: [], error: store.adminToken ? (e instanceof Error ? e.message : "Search failed") : "Connect Shopify first (Setup tab)" });
  }
}
