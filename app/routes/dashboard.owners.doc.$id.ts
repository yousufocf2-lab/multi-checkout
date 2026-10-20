import type { LoaderFunctionArgs } from "@remix-run/node";
import { eq } from "drizzle-orm";
import { db, kycDocuments } from "~/db.server";
import { requireAdmin } from "~/lib/auth.server";

/** Admin opens an owner's KYC document. */
export async function loader({ request, params }: LoaderFunctionArgs) {
  await requireAdmin(request);
  const [d] = await db.select().from(kycDocuments).where(eq(kycDocuments.id, Number(params.id))).limit(1);
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
