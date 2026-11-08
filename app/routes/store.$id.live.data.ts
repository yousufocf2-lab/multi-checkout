// Live view data, polled every few seconds by the Live view page and the home "live now" chip.
import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { requireStore, requireViewer } from "~/lib/auth.server";
import { liveSnapshot } from "~/lib/live.server";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const store = await requireStore(await requireViewer(request), params.id);
  return json(await liveSnapshot(store.id), { headers: { "Cache-Control": "no-store" } });
}
