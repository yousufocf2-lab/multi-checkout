import type { LoaderFunctionArgs } from "@remix-run/node";
import { and, eq } from "drizzle-orm";
import { db, kycDocuments } from "~/db.server";
import { requireViewer } from "~/lib/auth.server";

/** An owner opens their own KYC document. */
export async function loader({ request, params }: LoaderFunctionArgs) {
  const viewer = await requireViewer(request);
  if (viewer.role !== "owner" || viewer.member) throw new Response("Not found", { status: 404 });
  const [d] = await db.select().from(kycDocuments).where(and(eq(kycDocuments.userId, viewer.userId), eq(kycDocuments.kind, String(params.kind)))).limit(1);
  if (!d) throw new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(d.data), {
    headers: {
      "Content-Type": d.mime,
      "Content-Disposition": `inline; filename="${d.filename.replace(/[^\w.\- ]/g, "_")}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
