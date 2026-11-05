// Upload one photo or video for a store's catalog. Body = the file itself; Content-Type = its type.
import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { requireStore, requireViewer } from "~/lib/auth.server";
import { catalogAllowed } from "~/lib/catalog.server";
import { mediaReady, uploadMedia } from "~/lib/media.server";

export const loader = () => json({ error: "POST only" }, { status: 405 });

export async function action({ request, params }: ActionFunctionArgs) {
  const viewer = await requireViewer(request);
  const store = await requireStore(viewer, params.id);
  if (!catalogAllowed(viewer, store)) return json({ error: "Not allowed" }, { status: 403 });
  if (!mediaReady()) return json({ error: "Media storage isn't set up yet. Please tell Growpefy." }, { status: 503 });
  if (!request.body) return json({ error: "No file received." }, { status: 400 });
  const type = (request.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  const size = Number(request.headers.get("content-length") ?? 0);
  try {
    const r = await uploadMedia(store.id, type, request.body, size);
    console.log(`[media] store=${store.id} ${r.type} ${Math.round(r.bytes / 1024)}KB`);
    return json({ url: r.url, type: r.type });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "Upload failed" }, { status: 400 });
  }
}
