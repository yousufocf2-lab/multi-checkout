// Shipping labels (4×6 PDF). POST = print every label not printed yet as a new batch; GET ?batch= reprints a batch,
// GET ?order= prints one shipment's label.
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { can, requireStore, requireViewer } from "~/lib/auth.server";
import { printNewLabels, printOne, reprintBatch } from "~/lib/labels-batch.server";

async function storeFor(request: Request, id: string | undefined) {
  const viewer = await requireViewer(request);
  if (!can(viewer, "rto") && !can(viewer, "orders")) throw new Response("Not allowed", { status: 403 });
  return requireStore(viewer, id);
}

const pdf = (r: { pdf: Buffer; batch: string }) =>
  new Response(new Uint8Array(r.pdf), { headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="labels-${r.batch.replace(/[^\w]+/g, "-")}.pdf"`, "Cache-Control": "no-store" } });
const nothing = (text: string) =>
  new Response(`<!doctype html><meta charset="utf-8"><title>Shipping labels</title><body style="font:15px system-ui;padding:40px;color:#333">${text}<br><br><a href="javascript:window.close()">Close</a></body>`, { headers: { "Content-Type": "text/html; charset=utf-8" } });

export async function action({ request, params }: ActionFunctionArgs) {
  const store = await storeFor(request, params.id);
  const r = await printNewLabels(store);
  return r ? pdf(r) : nothing("No new labels to print. Every booked Delhivery shipment waiting for pickup already has its label.");
}

export async function loader({ request, params }: LoaderFunctionArgs) {
  const store = await storeFor(request, params.id);
  const u = new URL(request.url);
  const batch = u.searchParams.get("batch");
  const order = u.searchParams.get("order");
  const r = batch ? await reprintBatch(store, batch) : order ? await printOne(store, order) : null;
  return r ? pdf(r) : nothing("Label not found.");
}
