import type { LoaderFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";
import { requireStore, requireViewer } from "~/lib/auth.server";
import { selectCookie } from "~/lib/selection.server";

/** Store orders live in the main Orders page, focused on that store. */
export async function loader({ request, params }: LoaderFunctionArgs) {
  const store = await requireStore(await requireViewer(request), params.id);
  return redirect(`/dashboard/orders${new URL(request.url).search}`, { headers: { "Set-Cookie": await selectCookie(store.id) } });
}

export default function StoreOrders() {
  return null;
}
