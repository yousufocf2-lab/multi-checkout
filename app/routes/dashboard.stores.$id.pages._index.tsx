// Growpefy Store → Pages: shipping, returns, privacy, terms, contact, about.
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Form, Link, useActionData, useLoaderData } from "@remix-run/react";
import { eq } from "drizzle-orm";
import { Notice, SubmitButton, LearnMore } from "~/components/ui";
import { db, users } from "~/db.server";
import { requireStore, requireViewer } from "~/lib/auth.server";
import { catalogAllowed } from "~/lib/catalog.server";
import { addStarterPages, listPages } from "~/lib/store-pages.server";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const viewer = await requireViewer(request);
  const store = await requireStore(viewer, params.id);
  if (!catalogAllowed(viewer, store)) throw new Response("Not found", { status: 404 });
  const pages = await listPages(store.id);
  return json({ slug: store.slug, pages: pages.map((p) => ({ id: p.id, title: p.title, handle: p.handle, published: p.published, updatedAt: p.updatedAt.toISOString() })) });
}

export async function action({ request, params }: ActionFunctionArgs) {
  const viewer = await requireViewer(request);
  const store = await requireStore(viewer, params.id);
  if (!catalogAllowed(viewer, store)) throw new Response("Not found", { status: 404 });
  const [owner] = store.ownerId ? await db.select({ email: users.email }).from(users).where(eq(users.id, store.ownerId)).limit(1) : [];
  const n = await addStarterPages(store, owner?.email ?? null);
  return json({ ok: n ? `Added ${n} pages as drafts. Fill in the parts in [BRACKETS], then publish each one.` : "You already have all the standard pages." });
}

export default function Pages() {
  const { slug, pages } = useLoaderData<typeof loader>();
  const a = useActionData<typeof action>();
  return (
    <div className="max-w-4xl space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="flex-1 text-[22px] font-semibold tracking-tight">Pages</h1>
        <LearnMore topic="pages" />
        <Form method="post"><SubmitButton className="btn-secondary" busyText="Adding">Add standard policies</SubmitButton></Form>
        <Link to="new" className="btn-primary">Add page</Link>
      </div>
      {a?.ok && <Notice tone="success">{a.ok}</Notice>}
      <section className="panel overflow-hidden">
        {pages.length === 0 ? (
          <div className="px-6 py-12 text-center">
            <p className="font-medium">No pages yet</p>
            <p className="mt-1 text-sm text-ink-soft">Payment gateways and Meta ads need shipping, returns, privacy and terms pages. Add them in one click.</p>
          </div>
        ) : (
          <table className="table">
            <thead><tr><th>Page</th><th>Status</th><th>Link</th></tr></thead>
            <tbody>
              {pages.map((p) => (
                <tr key={p.id}>
                  <td><Link to={String(p.id)} className="font-medium text-ink hover:underline">{p.title}</Link></td>
                  <td><span className={`rounded-full px-2 py-0.5 text-xs font-medium ${p.published ? "bg-emerald-50 text-good" : "bg-paper-sunk text-ink-soft"}`}>{p.published ? "Published" : "Draft"}</span></td>
                  <td className="text-xs">{p.published ? <a href={`/s/${slug}/pages/${p.handle}`} target="_blank" rel="noreferrer" className="text-pine underline">/pages/{p.handle}</a> : <span className="text-ink-faint">/pages/{p.handle}</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
