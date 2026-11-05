// CSV of a Growpefy Store's orders waiting to ship (one row per item), for courier bulk upload.
import type { LoaderFunctionArgs } from "@remix-run/node";
import { requireStore, requireViewer } from "~/lib/auth.server";
import { catalogAllowed } from "~/lib/catalog.server";
import { ordersToShip, shippingCsv, shippingRows } from "~/lib/store-fulfil.server";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const viewer = await requireViewer(request);
  const store = await requireStore(viewer, params.id);
  if (!catalogAllowed(viewer, store)) throw new Response("Not found", { status: 404 });
  const csv = shippingCsv(await shippingRows(store, await ordersToShip(store.id)));
  return new Response(csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${store.slug}-to-ship.csv"` } });
}
