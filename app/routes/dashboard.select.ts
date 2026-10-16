import type { LoaderFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";
import { requireViewer, viewerStores } from "~/lib/auth.server";
import { selectCookie } from "~/lib/selection.server";

/** Store switcher: /dashboard/select?store=7|all&to=/dashboard/... sets the focus store and goes back. */
export async function loader({ request }: LoaderFunctionArgs) {
  const viewer = await requireViewer(request);
  const url = new URL(request.url);
  const all = await viewerStores(viewer);
  const raw = url.searchParams.get("store") ?? "all";
  const id = raw === "all" ? null : all.find((s) => s.id === Number(raw))?.id ?? null;

  let to = url.searchParams.get("to") ?? "/dashboard";
  if (!to.startsWith("/dashboard") || to.startsWith("/dashboard/select")) to = "/dashboard";
  const target = new URL(to, url.origin);

  const m = target.pathname.match(/^\/dashboard\/stores\/(\d+)(\/[^/]+)?/);
  const section = m?.[2]?.slice(1) ?? (target.pathname === "/dashboard/stores" ? target.searchParams.get("next") : null);
  let dest: string;

  if (m || section) {
    if (id) dest = `/dashboard/stores/${id}${section ? `/${section}` : ""}`;
    else if (!section) dest = "/dashboard";
    else if (section === "orders") dest = "/dashboard/orders";
    else if (section === "ads") dest = "/dashboard/ads";
    else dest = all.length === 1 ? `/dashboard/stores/${all[0].id}/${section}` : `/dashboard/stores?next=${section}`;
  } else if (target.pathname === "/dashboard/ads" && id) {
    dest = `/dashboard/stores/${id}/ads`;
  } else {
    for (const k of ["s", "store", "page"]) target.searchParams.delete(k);
    dest = target.pathname + (target.searchParams.size ? `?${target.searchParams}` : "");
  }
  return redirect(dest, { headers: { "Set-Cookie": await selectCookie(id) } });
}

// A component (not a resource route) so <Link> switches stores without a full page reload.
export default function Select() {
  return null;
}
