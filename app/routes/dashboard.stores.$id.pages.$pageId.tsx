// Growpefy Store → add / edit one website page.
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { Form, Link, useActionData, useLoaderData } from "@remix-run/react";
import { Notice, SubmitButton } from "~/components/ui";
import { requireStore, requireViewer } from "~/lib/auth.server";
import { catalogAllowed } from "~/lib/catalog.server";
import { deletePage, getPage, savePage } from "~/lib/store-pages.server";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const viewer = await requireViewer(request);
  const store = await requireStore(viewer, params.id);
  if (!catalogAllowed(viewer, store)) throw new Response("Not found", { status: 404 });
  if (params.pageId === "new") return json({ page: null });
  const page = await getPage(store.id, Number(params.pageId));
  if (!page) throw new Response("Not found", { status: 404 });
  return json({ page: { id: page.id, title: page.title, handle: page.handle, bodyHtml: page.bodyHtml, published: page.published, inFooter: page.inFooter } });
}

export async function action({ request, params }: ActionFunctionArgs) {
  const viewer = await requireViewer(request);
  const store = await requireStore(viewer, params.id);
  if (!catalogAllowed(viewer, store)) throw new Response("Not found", { status: 404 });
  const fd = await request.formData();
  const id = params.pageId === "new" ? undefined : Number(params.pageId);
  if (fd.get("intent") === "delete" && id) {
    await deletePage(store.id, id);
    return redirect(`/dashboard/stores/${store.id}/pages`);
  }
  const body = String(fd.get("body") ?? "");
  const publish = fd.get("published") === "on";
  if (publish && /\[[A-Z0-9 ,'–-]{3,}\]/.test(body)) {
    return json({ ok: null, error: "Fill in the parts in [CAPITAL BRACKETS] before publishing." }, { status: 400 });
  }
  try {
    const newId = await savePage(store.id, { title: String(fd.get("title") ?? ""), handle: String(fd.get("handle") ?? ""), bodyHtml: body, published: publish, inFooter: fd.get("inFooter") === "on" }, id);
    if (!id) return redirect(`/dashboard/stores/${store.id}/pages/${newId}`);
    return json({ ok: "Saved.", error: null });
  } catch (e) {
    return json({ ok: null, error: e instanceof Error ? e.message : "Couldn't save" }, { status: 400 });
  }
}

export default function EditPage() {
  const { page } = useLoaderData<typeof loader>();
  const a = useActionData<typeof action>();
  return (
    <Form method="post" className="max-w-4xl space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <Link to=".." relative="path" className="btn-quiet" aria-label="Back to pages">←</Link>
        <h1 className="flex-1 text-[22px] font-semibold tracking-tight">{page?.title ?? "Add page"}</h1>
        <SubmitButton className="btn-primary" busyText="Saving">Save</SubmitButton>
      </div>
      {a?.ok && <Notice tone="success">{a.ok}</Notice>}
      {a?.error && <Notice tone="error">{a.error}</Notice>}
      <section className="panel space-y-4 p-5">
        <label className="block text-sm font-medium">Title<input name="title" required defaultValue={page?.title ?? ""} className="input mt-1.5 w-full" /></label>
        <label className="block text-sm font-medium">Content
          <textarea name="body" rows={18} defaultValue={page?.bodyHtml ?? ""} className="input mt-1.5 w-full py-2 font-mono text-[13px] font-normal" />
          <span className="mt-1 block text-xs font-normal text-ink-faint">Simple HTML works: &lt;p&gt;, &lt;b&gt;, &lt;ul&gt;&lt;li&gt;. Replace everything in [CAPITAL BRACKETS] with your details.</span>
        </label>
        <label className="block text-sm font-medium">URL handle<input name="handle" defaultValue={page?.handle ?? ""} className="input mt-1.5 w-full" placeholder="made from the title" /></label>
        <div className="flex flex-wrap gap-6 text-sm">
          <label className="flex items-center gap-2"><input type="checkbox" name="published" defaultChecked={page?.published ?? false} />Published on the website</label>
          <label className="flex items-center gap-2"><input type="checkbox" name="inFooter" defaultChecked={page?.inFooter ?? true} />Show in the footer</label>
        </div>
      </section>
      {page && (
        <button type="submit" name="intent" value="delete" formNoValidate className="btn-danger" onClick={(e) => { if (!confirm(`Delete “${page.title}”?`)) e.preventDefault(); }}>Delete page</button>
      )}
    </Form>
  );
}
