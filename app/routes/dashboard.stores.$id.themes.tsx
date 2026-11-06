// Growpefy Store → Themes & design: the live theme, its unpublished changes, and earlier versions.
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Form, Link, useActionData, useLoaderData } from "@remix-run/react";
import { Notice, SubmitButton } from "~/components/ui";
import { requireStore, requireViewer } from "~/lib/auth.server";
import { catalogAllowed } from "~/lib/catalog.server";
import { discardDraft, editorState, publishDraft, restoreVersion } from "~/lib/themes.server";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const viewer = await requireViewer(request);
  const store = await requireStore(viewer, params.id);
  if (!catalogAllowed(viewer, store)) throw new Response("Not found", { status: 404 });
  const st = await editorState(store.id);
  return json({
    store: { id: store.id, slug: store.slug, name: store.name, domain: store.storefrontDomainStatus === "live" ? store.storefrontDomain : null },
    hasDraft: st.hasDraft, publishedAt: st.publishedAt, updatedAt: st.updatedAt, history: st.history,
  });
}

export async function action({ request, params }: ActionFunctionArgs) {
  const viewer = await requireViewer(request);
  const store = await requireStore(viewer, params.id);
  if (!catalogAllowed(viewer, store)) throw new Response("Not found", { status: 404 });
  const fd = await request.formData();
  try {
    switch (fd.get("intent")) {
      case "publish": await publishDraft(store.id, viewer.name); return json({ ok: "Published. Your website now shows the new design.", error: null });
      case "discard": await discardDraft(store.id); return json({ ok: "Unpublished changes discarded.", error: null });
      case "restore": await restoreVersion(store.id, Number(fd.get("index"))); return json({ ok: "That version is now your draft. Open the editor to check it, then publish.", error: null });
    }
  } catch (e) {
    return json({ ok: null, error: e instanceof Error ? e.message : "Something went wrong" }, { status: 400 });
  }
  return json({ ok: null, error: null });
}

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }) : "—");

export default function Themes() {
  const { store, hasDraft, publishedAt, updatedAt, history } = useLoaderData<typeof loader>();
  const a = useActionData<typeof action>();
  const liveUrl = store.domain ? `https://${store.domain}` : `/s/${store.slug}`;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="flex-1 text-[22px] font-semibold tracking-tight">Themes & design</h1>
        <a href={liveUrl} target="_blank" rel="noreferrer" className="btn-secondary">View website</a>
      </div>
      {a?.ok && <Notice tone="success">{a.ok}</Notice>}
      {a?.error && <Notice tone="error">{a.error}</Notice>}

      <section className="panel overflow-hidden">
        <div className="grid gap-0 md:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
          <div className="relative h-[300px] overflow-hidden border-b border-rule bg-paper-sunk md:border-b-0 md:border-r">
            <iframe title="Your website" src={`/s/${store.slug}`} tabIndex={-1} className="pointer-events-none absolute left-0 top-0 h-[750px] w-[1280px] origin-top-left scale-[0.4] border-0 md:scale-[0.45]" loading="lazy" />
          </div>
          <div className="flex flex-col gap-3 p-5">
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-semibold">Swift</h2>
              <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-good">Live</span>
              {hasDraft && <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700">Unpublished changes</span>}
            </div>
            <p className="text-sm text-ink-soft">Fast, clean theme made for selling on phones: cash on delivery, video on product cards, sticky Buy now.</p>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
              <dt className="text-ink-faint">Published</dt><dd>{publishedAt ? when(publishedAt) : "Theme defaults"}</dd>
              <dt className="text-ink-faint">Last edit</dt><dd>{when(updatedAt)}</dd>
            </dl>
            <div className="mt-auto flex flex-wrap gap-2 pt-2">
              <Link to={`/dashboard/stores/${store.id}/editor`} className="btn-primary">Customize</Link>
              {hasDraft && <a href={`/s/${store.slug}?gp_draft=1`} target="_blank" rel="noreferrer" className="btn-secondary">Preview changes</a>}
              {hasDraft && (
                <Form method="post"><input type="hidden" name="intent" value="publish" /><SubmitButton className="btn-secondary" busyText="Publishing">Publish</SubmitButton></Form>
              )}
              {hasDraft && (
                <Form method="post" onSubmit={(e) => { if (!confirm("Throw away all unpublished changes?")) e.preventDefault(); }}>
                  <input type="hidden" name="intent" value="discard" />
                  <button className="btn-danger">Discard changes</button>
                </Form>
              )}
            </div>
          </div>
        </div>
      </section>

      <section className="panel p-5">
        <h2 className="text-[15px] font-semibold">Earlier versions</h2>
        <p className="mt-1 text-sm text-ink-soft">Each time you publish, the design before it is kept here (last 5). Restore one to bring it back as a draft.</p>
        {history.length === 0 ? (
          <p className="mt-3 text-sm text-ink-faint">Nothing yet. Versions appear after your second publish.</p>
        ) : (
          <ul className="mt-3 divide-y divide-rule">
            {history.map((v) => (
              <li key={v.index} className="flex items-center gap-3 py-2 text-sm">
                <span className="flex-1">{when(v.at)}{v.by ? <span className="text-ink-faint"> · replaced by {v.by}</span> : null}</span>
                <Form method="post"><input type="hidden" name="intent" value="restore" /><input type="hidden" name="index" value={v.index} />
                  <SubmitButton className="btn-secondary h-8" busyText="Restoring">Restore</SubmitButton>
                </Form>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="panel p-5">
        <h2 className="text-[15px] font-semibold">More themes</h2>
        <p className="mt-1 text-sm text-ink-soft">More ready-made themes for fashion, food, beauty and services are on the way. You can switch any time without losing your products.</p>
      </section>
    </div>
  );
}
