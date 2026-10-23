import type { LoaderFunctionArgs } from "@remix-run/node";
import { eq } from "drizzle-orm";
import { db, storeDocuments } from "~/db.server";
import { requireStore, requireViewer } from "~/lib/auth.server";

/** A store's verification document: the store's owner or the admin. */
export async function loader({ request, params }: LoaderFunctionArgs) {
  const viewer = await requireViewer(request);
  const [d] = await db.select().from(storeDocuments).where(eq(storeDocuments.id, Number(params.id))).limit(1);
  if (!d) throw new Response("Not found", { status: 404 });
  await requireStore(viewer, String(d.storeId)); // 404 for anyone else
  return new Response(new Uint8Array(d.data), {
    headers: {
      "Content-Type": d.mime,
      "Content-Disposition": `inline; filename="${d.filename.replace(/[^\w.\- ]/g, "_")}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
