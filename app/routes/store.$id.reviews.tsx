import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { Form, Link, useLoaderData } from "@remix-run/react";
import { and, asc, eq } from "drizzle-orm";
import { db, catalogItems, productReviews } from "~/db.server";
import { Icon } from "~/components/Icons";
import { requireStore, requireViewer } from "~/lib/auth.server";
import { catalogAllowed } from "~/lib/catalog.server";
import { storePath } from "~/lib/store-code";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const viewer = await requireViewer(request);
  const store = await requireStore(viewer, params.id);
  if (!catalogAllowed(viewer, store)) throw new Response("Not found", { status: 404 });
  const reviews = await db.select({ id: productReviews.id, authorName: productReviews.authorName, email: productReviews.email, rating: productReviews.rating, body: productReviews.body, createdAt: productReviews.createdAt, status: productReviews.status, productTitle: catalogItems.title })
    .from(productReviews).innerJoin(catalogItems, eq(catalogItems.id, productReviews.productId))
    .where(eq(productReviews.storeId, store.id)).orderBy(asc(productReviews.status), asc(productReviews.createdAt)).limit(500);
  return json({ store: { id: store.id }, reviews });
}

export async function action({ request, params }: ActionFunctionArgs) {
  const viewer = await requireViewer(request);
  const store = await requireStore(viewer, params.id);
  if (!catalogAllowed(viewer, store)) throw new Response("Not found", { status: 404 });
  const fd = await request.formData();
  const id = Number(fd.get("id"));
  const intent = String(fd.get("intent"));
  if (!Number.isInteger(id) || id < 1 || !["approve", "reject"].includes(intent)) throw new Response("Invalid review action", { status: 400 });
  await db.update(productReviews).set({ status: intent === "approve" ? "approved" : "rejected" })
    .where(and(eq(productReviews.storeId, store.id), eq(productReviews.id, id)));
  return redirect(`${storePath(store.id)}/reviews`);
}

export default function StoreReviews() {
  const { store, reviews } = useLoaderData<typeof loader>();
  return <div className="space-y-3">
    <div className="flex items-center justify-between"><div><h2 className="text-sm font-semibold">Product reviews</h2><p className="text-xs text-ink-soft">New reviews stay private until approved.</p></div><Link className="btn-secondary" to={`${storePath(store.id)}/catalog`}>Products</Link></div>
    {!reviews.length ? <div className="panel p-6 text-sm text-ink-soft">No reviews yet.</div> : reviews.map((r) => <article key={r.id} className="panel flex flex-wrap items-start gap-4 p-4">
      <div className="min-w-0 flex-1"><div className="flex flex-wrap gap-2 text-xs"><b>{r.productTitle}</b><span>{"★".repeat(r.rating)}{"☆".repeat(5-r.rating)}</span><span>{r.authorName}{r.email ? ` · ${r.email}` : ""}</span><span>{new Date(r.createdAt).toLocaleDateString()}</span><span className="capitalize">{r.status}</span></div><p className="mt-2 whitespace-pre-wrap text-sm">{r.body}</p></div>
      {r.status !== "approved" && <div className="flex gap-2"><Form method="post"><input type="hidden" name="id" value={r.id}/><input type="hidden" name="intent" value="approve"/><button className="btn-primary" aria-label="Approve review"><Icon name="check" className="h-4 w-4"/>Approve</button></Form><Form method="post"><input type="hidden" name="id" value={r.id}/><input type="hidden" name="intent" value="reject"/><button className="btn-secondary">Reject</button></Form></div>}
    </article>)}
  </div>;
}
