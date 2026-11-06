import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { can, requireStore, requireViewer } from "~/lib/auth.server";
import { searchDraftProducts } from "~/lib/drafts.server";

/** JSON: products (one row per variant) for the draft order editor. */
export async function loader({ request, params }: LoaderFunctionArgs) {
  const viewer = await requireViewer(request);
  const store = await requireStore(viewer, params.id);
  if (!can(viewer, "orders")) return json({ products: [], error: "Not allowed" }, { status: 403 });
  try {
    return json({ products: await searchDraftProducts(store, new URL(request.url).searchParams.get("q") ?? ""), error: null });
  } catch (e) {
    return json({ products: [], error: e instanceof Error ? e.message : "Search failed" });
  }
}
