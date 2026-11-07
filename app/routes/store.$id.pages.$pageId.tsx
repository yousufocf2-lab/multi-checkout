// Growpefy Store → add / edit one website page: visual editor with blocks and HTML mode, visibility, layout and search listing.
import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { Form, Link, useActionData, useLoaderData, useNavigation } from "@remix-run/react";
import { useState } from "react";
import { Notice, SubmitButton } from "~/components/ui";
import { Card } from "~/components/settings-ui";
import { Icon } from "~/components/Icons";
import { PageEditor } from "~/components/PageEditor";
import { requireStore, requireViewer } from "~/lib/auth.server";
import { catalogAllowed } from "~/lib/catalog.server";
import { deletePage, getPage, savePage } from "~/lib/store-pages.server";
import { storePath } from "~/lib/store-code";

export const meta: MetaFunction<typeof loader> = ({ data }) => [{ title: `${data?.page?.title ?? "Add page"} · Pages` }];

export async function loader({ request, params }: LoaderFunctionArgs) {
  const viewer = await requireViewer(request);
  const store = await requireStore(viewer, params.id);
  if (!catalogAllowed(viewer, store)) throw new Response("Not found", { status: 404 });
  const origin = new URL(request.url).origin;
  const site = {
    name: store.name,
    host: store.storefrontDomain && store.storefrontDomainStatus === "live" ? `https://${store.storefrontDomain}` : `${origin}/s/${store.slug}`,
    preview: `${origin}/s/${store.slug}`,
  };
  const mediaUrl = `${storePath(store.id)}/media`;
  if (params.pageId === "new") return json({ page: null, site, mediaUrl });
  const page = await getPage(store.id, Number(params.pageId));
  if (!page) throw new Response("Not found", { status: 404 });
  return json({
    site, mediaUrl,
    page: {
      id: page.id, title: page.title, handle: page.handle, bodyHtml: page.bodyHtml, published: page.published, inFooter: page.inFooter,
      seoTitle: page.seoTitle ?? "", seoDescription: page.seoDescription ?? "", layout: page.layout, hideTitle: page.hideTitle,
    },
  });
}

export async function action({ request, params }: ActionFunctionArgs) {
  const viewer = await requireViewer(request);
  const store = await requireStore(viewer, params.id);
  if (!catalogAllowed(viewer, store)) throw new Response("Not found", { status: 404 });
  const fd = await request.formData();
  const id = params.pageId === "new" ? undefined : Number(params.pageId);
  if (fd.get("intent") === "delete" && id) {
    await deletePage(store.id, id);
    return redirect(`${storePath(store.id)}/pages`);
  }
  const body = String(fd.get("body") ?? "");
  const publish = fd.get("published") === "on";
  if (publish && /\[[A-Z0-9 ,'–-]{3,}\]/.test(body)) {
    return json({ ok: null, error: "Fill in the parts in [CAPITAL BRACKETS] before publishing." }, { status: 400 });
  }
  try {
    const newId = await savePage(store.id, {
      title: String(fd.get("title") ?? ""), handle: String(fd.get("handle") ?? ""), bodyHtml: body, published: publish, inFooter: fd.get("inFooter") === "on",
      seoTitle: String(fd.get("seoTitle") ?? ""), seoDescription: String(fd.get("seoDescription") ?? ""),
      layout: String(fd.get("layout") ?? "narrow"), hideTitle: fd.get("hideTitle") === "on",
    }, id);
    if (!id) return redirect(`${storePath(store.id)}/pages/${newId}`);
    return json({ ok: "Saved.", error: null });
  } catch (e) {
    return json({ ok: null, error: e instanceof Error ? e.message : "Couldn't save" }, { status: 400 });
  }
}

const toHandle = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^\w\s-]/g, "").trim().replace(/[\s_]+/g, "-").replace(/-+/g, "-").slice(0, 80);

export default function EditPage() {
  const { page, site, mediaUrl } = useLoaderData<typeof loader>();
  const a = useActionData<typeof action>();
  const nav = useNavigation();
  const [title, setTitle] = useState(page?.title ?? "");
  const [handle, setHandle] = useState(page?.handle ?? "");
  const [seoTitle, setSeoTitle] = useState(page?.seoTitle ?? "");
  const [seoDesc, setSeoDesc] = useState(page?.seoDescription ?? "");
  const [published, setPublished] = useState(page?.published ?? false);
  const shownHandle = handle || toHandle(title) || "page";
  const liveUrl = `${site.host}/pages/${page?.handle ?? shownHandle}`;
  const viewUrl = page ? (page.published ? liveUrl : `${site.preview}/pages/${page.handle}?gp_draft=1`) : null;
  const saving = nav.state !== "idle" && nav.formMethod === "POST";

  return (
    <Form method="post" className="mx-auto max-w-[1100px] space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Link to=".." relative="path" className="btn-quiet !px-2" aria-label="Back to pages"><Icon name="chevron" className="h-4 w-4 rotate-90" /></Link>
        <h1 className="min-w-0 flex-1 truncate text-[15px] font-semibold">{page?.title || "Add page"}</h1>
        {page && <span className={`rounded-full px-2 py-0.5 text-[11.5px] font-medium ${page.published ? "bg-[#cdfee1] text-[#0c5132]" : "bg-[#e3e3e3] text-[#4a4a4a]"}`}>{page.published ? "Visible" : "Hidden"}</span>}
        {viewUrl && <a href={viewUrl} target="_blank" rel="noreferrer" className="btn-secondary"><Icon name="eye" className="h-4 w-4" />{page?.published ? "View" : "Preview"}</a>}
        <SubmitButton className="btn-primary" busyText="Saving">Save</SubmitButton>
      </div>
      {a?.ok && !saving && <Notice tone="success">{a.ok}</Notice>}
      {a?.error && !saving && <Notice tone="error">{a.error}</Notice>}

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="min-w-0 space-y-4">
          <Card>
            <div className="space-y-3 pt-4">
              <label className="block text-[13px] font-medium">Title
                <input name="title" required value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. About us, Contact, Shipping policy" className="input mt-1.5 w-full" />
              </label>
              <div>
                <p className="mb-1.5 text-[13px] font-medium">Content</p>
                <PageEditor name="body" initial={page?.bodyHtml ?? ""} mediaUrl={mediaUrl} />
              </div>
            </div>
          </Card>

          <Card title="Search engine listing" description="How this page can look on Google.">
            <div className="mb-3 rounded-[10px] px-3 py-2.5 shadow-[0_0_0_1px_rgba(0,0,0,.08)]">
              <p className="truncate text-[12px] text-ink-soft">{site.name} › pages › {page?.handle ?? shownHandle}</p>
              <p className="truncate text-[15px] text-[#1a0dab]">{seoTitle || title || "Page title"}</p>
              <p className="line-clamp-2 text-[12.5px] text-ink-soft">{seoDesc || "Google shows the first lines of the page when this is empty."}</p>
            </div>
            <label className="block text-[13px] font-medium">Page title for search
              <input name="seoTitle" value={seoTitle} onChange={(e) => setSeoTitle(e.target.value)} maxLength={120} placeholder={title || "Same as the page title"} className="input mt-1.5 w-full" />
              <span className="mt-1 block text-[11.5px] font-normal text-ink-faint">{seoTitle.length} of 70 characters used</span>
            </label>
            <label className="mt-3 block text-[13px] font-medium">Description
              <textarea name="seoDescription" value={seoDesc} onChange={(e) => setSeoDesc(e.target.value)} maxLength={320} rows={3} placeholder="A short summary shown under the title on Google" className="input mt-1.5 w-full py-2" />
              <span className="mt-1 block text-[11.5px] font-normal text-ink-faint">{seoDesc.length} of 160 characters used</span>
            </label>
          </Card>
        </div>

        <div className="space-y-4 lg:sticky lg:top-4">
          <Card title="Visibility">
            <label className="flex items-start gap-2 text-[13px]"><input type="checkbox" name="published" checked={published} onChange={(e) => setPublished(e.target.checked)} className="mt-0.5" />
              <span><span className="block font-medium">Published on the website</span><span className="block text-[12px] text-ink-soft">{published ? "Shoppers can open this page." : "Hidden. Only you can preview it."}</span></span>
            </label>
            <label className="mt-3 flex items-start gap-2 text-[13px]"><input type="checkbox" name="inFooter" defaultChecked={page?.inFooter ?? true} className="mt-0.5" />
              <span><span className="block font-medium">Show in the footer</span><span className="block text-[12px] text-ink-soft">Adds a link in the footer menu.</span></span>
            </label>
          </Card>

          <Card title="Page link">
            <div className="flex items-center rounded-lg shadow-[inset_0_0_0_1px_#d4d4d4]">
              <span className="pl-2.5 text-[12.5px] text-ink-faint">/pages/</span>
              <input name="handle" value={handle} onChange={(e) => setHandle(toHandle(e.target.value))} placeholder={toHandle(title) || "about-us"} className="min-w-0 flex-1 border-0 bg-transparent px-1 py-1.5 text-[13px] outline-none" aria-label="Page link" />
            </div>
            <p className="mt-1.5 break-all text-[11.5px] text-ink-faint">{liveUrl}</p>
          </Card>

          <Card title="Layout">
            <div className="grid grid-cols-2 gap-2">
              {[{ v: "narrow", t: "Reading width", d: "Best for text" }, { v: "wide", t: "Full width", d: "Best for designs" }].map((o) => (
                <label key={o.v} className="cursor-pointer rounded-[10px] px-3 py-2 text-[12.5px] shadow-[0_0_0_1px_rgba(0,0,0,.1)] has-[:checked]:shadow-[0_0_0_2px_#303030]">
                  <input type="radio" name="layout" value={o.v} defaultChecked={(page?.layout ?? "narrow") === o.v} className="sr-only" />
                  <span className="block font-medium">{o.t}</span><span className="block text-[11.5px] text-ink-soft">{o.d}</span>
                </label>
              ))}
            </div>
            <label className="mt-3 flex items-center gap-2 text-[13px]"><input type="checkbox" name="hideTitle" defaultChecked={page?.hideTitle ?? false} />Hide the page title (your design has its own heading)</label>
          </Card>

          <Card title="More design">
            <p className="text-[12.5px] text-ink-soft">Sections like banners, product grids and testimonials can be added to every page from <b>Online store → Edit theme → Page</b>.</p>
          </Card>

          {page && (
            <button type="submit" name="intent" value="delete" formNoValidate className="btn-danger w-full" onClick={(e) => { if (!confirm(`Delete “${page.title}”?`)) e.preventDefault(); }}>Delete page</button>
          )}
        </div>
      </div>
    </Form>
  );
}
