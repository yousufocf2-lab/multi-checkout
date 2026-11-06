import type { LoaderFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";
import { requireStore, requireViewer } from "~/lib/auth.server";
import { selectCookie } from "~/lib/selection.server";

/** A store's overview is the main Overview focused on that store. */
export async function loader({ request, params }: LoaderFunctionArgs) {
  const store = await requireStore(await requireViewer(request), params.id);
  const search = new URL(request.url).search;
  return redirect(`/dashboard${search}`, { headers: { "Set-Cookie": await selectCookie(store.id) } });
}

export default function StoreIndex() {
  return null;
}
