// Upload one file for a store. Body = the file itself; Content-Type = its type.
// Optional headers: X-File-Name (original name, URI-encoded), X-Width / X-Height (photos), X-Library: 1 (documents allowed).
// Every upload is added to the store's Files library.
import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { requireStore, requireViewer } from "~/lib/auth.server";
import { catalogAllowed } from "~/lib/catalog.server";
import { recordFile } from "~/lib/files.server";
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
  let name = "";
  try { name = decodeURIComponent(request.headers.get("x-file-name") ?? ""); } catch { /* keep empty */ }
  try {
    const r = await uploadMedia(store.id, type, request.body, size, { documents: request.headers.get("x-library") === "1" });
    console.log(`[media] store=${store.id} ${r.kind} ${Math.round(r.bytes / 1024)}KB`);
    const file = await recordFile({
      storeId: store.id, key: r.key, url: r.url, name, mime: type, bytes: r.bytes,
      width: Number(request.headers.get("x-width")) || undefined, height: Number(request.headers.get("x-height")) || undefined,
      by: viewer.role === "owner" ? (viewer.member?.name ?? viewer.name) : (viewer.staff?.name ?? viewer.name),
    }).catch((e) => { console.error("[files] record", e instanceof Error ? e.message : e); return null; });
    return json({ url: r.url, type: r.type, kind: r.kind, id: file?.id ?? null });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "Upload failed" }, { status: 400 });
  }
}
