// Website newsletter signups as a CSV file (Online Store → Email signups).
import type { LoaderFunctionArgs } from "@remix-run/node";
import { desc, eq } from "drizzle-orm";
import { db, storeSubscribers } from "~/db.server";
import { requireStore, requireViewer } from "~/lib/auth.server";
import { catalogAllowed } from "~/lib/catalog.server";

const quote = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;

export async function loader({ request, params }: LoaderFunctionArgs) {
  const viewer = await requireViewer(request);
  const store = await requireStore(viewer, params.id);
  if (!catalogAllowed(viewer, store)) throw new Response("Not found", { status: 404 });
  const rows = await db.select().from(storeSubscribers).where(eq(storeSubscribers.storeId, store.id)).orderBy(desc(storeSubscribers.createdAt));
  const lines = [["Email", "Signed up", "Page"].map(quote).join(","), ...rows.map((r) => [r.email, r.createdAt.toISOString(), r.source ?? ""].map(quote).join(","))];
  return new Response(lines.join("\n"), { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="email-signups-${store.slug}.csv"` } });
}
