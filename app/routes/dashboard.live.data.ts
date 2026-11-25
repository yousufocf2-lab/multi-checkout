// All-stores live data for the super admin's globe, polled every few seconds.
import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { requireViewer, viewerStores } from "~/lib/auth.server";
import { liveSnapshotAll } from "~/lib/live.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const viewer = await requireViewer(request);
  if (viewer.role !== "admin") throw new Response("Not found", { status: 404 });
  const list = await viewerStores(viewer);
  return json(await liveSnapshotAll(list.map((s) => ({ id: s.id, name: s.name }))), { headers: { "Cache-Control": "no-store" } });
}
