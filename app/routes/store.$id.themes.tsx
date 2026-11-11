// Online Store: the live theme with real-shopper speed, ready-made themes to switch to, and earlier versions.
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { Form, Link, useActionData, useLoaderData, useNavigation } from "@remix-run/react";
import { useEffect, useRef, useState } from "react";
import { Icon } from "~/components/Icons";
import { LearnMore, Notice } from "~/components/ui";
import { requireStore, requireViewer } from "~/lib/auth.server";
import { catalogAllowed } from "~/lib/catalog.server";
import { storePath } from "~/lib/store-code";
import { applyPreset, PRESETS, presetById } from "~/lib/theme-presets";
import { deleteThemeCopy, discardDraft, editorState, getThemeCopy, listThemeCopies, publishDraft, restoreVersion, saveDraft, saveThemeCopy, themeRow, vitalsSummary } from "~/lib/themes.server";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const viewer = await requireViewer(request);
  const store = await requireStore(viewer, params.id);
  if (!catalogAllowed(viewer, store)) throw new Response("Not found", { status: 404 });
  const [st, row, vitals, copies] = await Promise.all([editorState(store.id), themeRow(store.id), vitalsSummary(store.id).catch(() => null), listThemeCopies(store.id)]);
  const live = (row?.live?.settings?.preset as string | undefined) ?? "swift";
  const livePresetName = presetById(live)?.name ?? "Custom design";
  return json({
    store: { id: store.id, slug: store.slug, name: store.name, domain: store.storefrontDomainStatus === "live" ? store.storefrontDomain : null },
    hasDraft: st.hasDraft, publishedAt: st.publishedAt, updatedAt: st.updatedAt, history: st.history, vitals, livePreset: live, livePresetName,
    presets: PRESETS.map((p) => ({ id: p.id, name: p.name, tagline: p.tagline, best: p.best, swatch: p.swatch })),
    copies: copies.map((c) => ({ id: c.id, name: c.name, updatedAt: c.updatedAt.toISOString(), preset: String(c.data.settings.preset ?? "") })),
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
      case "preset": {
        const p = presetById(String(fd.get("preset")));
        if (!p) break;
        const st = await editorState(store.id);
        await saveDraft(store.id, applyPreset(st.data, p));
        return redirect(`${storePath(store.id)}/editor?preset=${p.id}`);
      }
      case "duplicate-published": {
        const published = (await themeRow(store.id))?.live;
        if (!published) throw new Error("Publish a theme first, then you can duplicate it.");
        const sourceName = presetById(String(published.settings.preset ?? ""))?.name ?? "Published theme";
        await saveThemeCopy(store.id, `${sourceName} copy`, published);
        return json({ ok: `${sourceName} was copied into your theme library.`, error: null });
      }
      case "use-copy": {
        const copy = await getThemeCopy(store.id, Number(fd.get("copyId")));
        if (!copy) throw new Error("That saved theme could not be found.");
        await saveDraft(store.id, copy.data);
        return redirect(`${storePath(store.id)}/editor`);
      }
      case "delete-copy": {
        await deleteThemeCopy(store.id, Number(fd.get("copyId")));
        return json({ ok: "Saved theme removed from your library.", error: null });
      }
      case "import": {
        const file = fd.get("themeFile");
        if (!(file instanceof File) || !file.size) throw new Error("Choose a Growpefy theme JSON file to import.");
        if (file.size > 400_000) throw new Error("This theme file is too large to import.");
        const parsedValue: unknown = JSON.parse(await file.text());
        if (!parsedValue || typeof parsedValue !== "object" || Array.isArray(parsedValue)) throw new Error("This file is not a Growpefy theme export.");
        const parsed = parsedValue as Record<string, unknown>;
        const data = (parsed.format === "growpefy-theme" ? parsed.data : parsed) as Record<string, unknown>;
        if (!data || typeof data !== "object" || !data.settings || !data.templates || !data.groups) throw new Error("This file is not a Growpefy theme export.");
        const baseName = typeof parsed.name === "string" ? parsed.name : file.name.replace(/\.(growpefy-theme\.)?json$/i, "");
        await saveThemeCopy(store.id, baseName || "Imported theme", data);
        return json({ ok: "Theme imported into your library. Preview it, then choose Use theme when you’re ready.", error: null });
      }
    }
  } catch (e) {
    return json({ ok: null, error: e instanceof Error ? e.message : "Something went wrong" }, { status: 400 });
  }
  return json({ ok: null, error: null });
}

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) : "—");
type Grade = "good" | "ok" | "poor";
const grade = (v: number | null, good: number, poor: number): Grade | null => (v == null ? null : v <= good ? "good" : v <= poor ? "ok" : "poor");
const GRADE: Record<Grade, [string, string]> = { good: ["Good", "bg-[#cdfee1] text-[#0c5132]"], ok: ["Needs work", "bg-[#fff1e3] text-[#5e4200]"], poor: ["Poor", "bg-[#fee9e8] text-[#8e1f0b]"] };

export default function OnlineStore() {
  const { store, hasDraft, publishedAt, updatedAt, history, vitals, presets, copies, livePreset, livePresetName } = useLoaderData<typeof loader>();
  const a = useActionData<typeof action>();
  const nav = useNavigation();
  const [preview, setPreview] = useState<{ name: string; src: string } | null>(null);
  const liveUrl = store.domain ? `https://${store.domain}` : `/s/${store.slug}`;
  const shown = store.domain ?? `growpefy.com/s/${store.slug}`;
  const editor = `${storePath(store.id)}/editor`;
  const currentName = presets.find((p) => p.id === livePreset)?.name ?? livePresetName;
  const v = vitals?.now;
  const pv = vitals?.before;
  const views = (v?.mobile ?? 0) + (v?.desktop ?? 0);

  return (
    <div className="space-y-4">
      <div className="flex min-h-[32px] flex-wrap items-center gap-2">
        <Icon name="stores" className="h-4 w-4" strokeWidth={1.9} />
        <h1 className="flex-1 text-[15px] font-semibold">Online Store</h1>
        <LearnMore topic="themes" />
        <a href={liveUrl} target="_blank" rel="noreferrer" className="btn-secondary">View store</a>
        <Menu items={[
          ...(hasDraft ? [{ label: "Preview unpublished changes", href: `/s/${store.slug}?gp_draft=1` }] : []),
          { label: "Pages", to: `${storePath(store.id)}/pages` },
          { label: "Domains", to: `${storePath(store.id)}/website` },
        ]} />
      </div>
      {a?.ok && <Notice tone="success">{a.ok}</Notice>}
      {a?.error && <Notice tone="error">{a.error}</Notice>}

      <section className="panel grid grid-cols-2 overflow-hidden md:grid-cols-[150px_repeat(4,minmax(0,1fr))] md:divide-x md:divide-rule">
        <div className="col-span-2 flex items-center gap-2 border-b border-rule px-4 py-3 text-[13px] font-medium md:col-span-1 md:border-b-0"><Icon name="calendar" className="h-4 w-4 text-ink-soft" />30 days</div>
        <Vital label="Loading speed (LCP)" tip="How long until the main content shows, for 3 out of 4 shoppers." value={v?.lcp != null ? `${(v.lcp / 1000).toFixed(2)} s` : "—"} g={grade(v?.lcp ?? null, 2500, 4000)} trend={trend(v?.lcp, pv?.lcp)} />
        <Vital label="Response to taps (INP)" tip="How fast the page reacts to taps and clicks." value={v?.inp != null ? `${v.inp} ms` : "—"} g={grade(v?.inp ?? null, 200, 500)} trend={trend(v?.inp, pv?.inp)} />
        <Vital label="Layout shift (CLS)" tip="How much the page jumps while loading. Lower is better." value={v?.cls != null ? String(v.cls) : "—"} g={grade(v?.cls ?? null, 0.1, 0.25)} />
        <div className="px-4 py-3">
          <p className="text-[12px] font-medium text-ink-soft underline decoration-dotted decoration-ink-faint underline-offset-4" title="Page views measured on your website">Page views by device</p>
          {views ? (
            <>
              <p className="num mt-1 text-[13px]"><b className="text-[15px]">{(v?.mobile ?? 0).toLocaleString("en-IN")}</b> Mobile <b className="ml-2 text-[15px]">{(v?.desktop ?? 0).toLocaleString("en-IN")}</b> Desktop</p>
              <div className="mt-1.5 flex h-1.5 overflow-hidden rounded-full bg-paper-sunk"><span className="bg-[#005bd3]" style={{ width: `${((v?.mobile ?? 0) / views) * 100}%` }} /><span className="bg-[#8a5cf6]" style={{ width: `${((v?.desktop ?? 0) / views) * 100}%` }} /></div>
            </>
          ) : <p className="mt-1 text-[12.5px] text-ink-faint">Collecting from real visitors</p>}
        </div>
      </section>

      <section className="relative overflow-hidden rounded-2xl bg-[#111] shadow-[0_0_0_1px_rgba(0,0,0,.08)]">
        <ScaledFrame src={`/s/${store.slug}`} height={500} title="Your live website" />
        <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_top,rgba(10,10,10,.96)_0%,rgba(10,10,10,.88)_18%,rgba(10,10,10,.25)_45%,transparent_65%)]" />
        <div className="absolute inset-x-0 bottom-0 flex flex-wrap items-end gap-3 p-5 text-white">
          <div className="min-w-0 flex-1">
            <p className="truncate text-[20px] font-semibold tracking-tight">{shown}</p>
            <p className="mt-0.5 text-[12.5px] text-white/75">{currentName} · {publishedAt ? `Last published ${when(publishedAt)}` : "Theme defaults"}{hasDraft ? ` · Unpublished changes saved ${when(updatedAt)}` : ""}</p>
          </div>
          {hasDraft && (
            <Form method="post"><input type="hidden" name="intent" value="publish" />
              <button className="h-8 rounded-lg bg-[#5ce1a8] px-3 text-[12.5px] font-semibold text-[#0b1513] hover:bg-[#73e9b6]" disabled={nav.state !== "idle"}>Publish changes</button>
            </Form>
          )}
          <Link to={editor} className="flex h-8 items-center rounded-lg bg-white px-3 text-[12.5px] font-semibold text-[#303030] hover:bg-[#f1f1f1]">Edit theme</Link>
          <Menu dark items={[
            { label: "View", href: liveUrl },
            ...(publishedAt ? [{ label: "Duplicate published theme", form: "duplicate-published" }, { label: "Download theme", href: `${storePath(store.id)}/themes/export?published=1` }] : []),
            ...(hasDraft ? [{ label: "Preview changes", href: `/s/${store.slug}?gp_draft=1` }, { label: "Discard unpublished changes", form: "discard", danger: true }] : []),
          ]} />
        </div>
      </section>

      <section>
        <div className="mb-2 flex flex-wrap items-end justify-between gap-2">
          <div><h2 className="text-[14px] font-semibold">Theme library</h2><p className="text-[12.5px] text-ink-soft">Ready-made designs. Pick one, it fills in with your products, then change anything and publish.</p></div>
          <div className="flex flex-wrap items-center gap-2">
            <Form method="post" encType="multipart/form-data">
              <input type="hidden" name="intent" value="import" />
              <label className="btn-secondary cursor-pointer rounded-full px-4">Import<input name="themeFile" type="file" accept=".json,application/json" className="sr-only" onChange={(e) => e.currentTarget.form?.requestSubmit()} /></label>
            </Form>
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {presets.map((p) => (
            <article key={p.id} className="panel overflow-hidden rounded-2xl border border-rule bg-white shadow-sm transition duration-200 hover:-translate-y-0.5 hover:shadow-lg">
              <div className="group relative h-[250px] overflow-hidden border-b border-rule bg-paper-sunk sm:h-[280px]">
                <ScaledFrame src={`/s/${store.slug}?gp_preset=${p.id}`} height={280} title={`${p.name} preview`} lazy />
                {p.id === livePreset && <span className="absolute left-2 top-2 rounded-md bg-[#cdfee1] px-1.5 py-0.5 text-[11.5px] font-semibold text-[#0c5132]">Current theme</span>}
                <button type="button" onClick={() => setPreview({ name: p.name, src: `/s/${store.slug}?gp_preset=${p.id}` })} className="absolute inset-0 flex items-center justify-center bg-black/20 text-[14px] font-semibold text-white opacity-0 backdrop-blur-[2px] transition duration-200 group-hover:opacity-100 group-focus-within:opacity-100">Preview</button>
              </div>
              <div className="flex items-start gap-3 p-3.5">
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-2 text-[13.5px] font-semibold">{p.name}<span className="flex -space-x-1">{p.swatch.map((c) => <span key={c} className="h-3.5 w-3.5 rounded-full shadow-[0_0_0_1.5px_#fff,0_0_0_2.5px_rgba(0,0,0,.12)]" style={{ background: c }} />)}</span></p>
                  <p className="mt-0.5 text-[12.5px] text-ink-soft">{p.tagline}</p>
                  <p className="mt-1 text-[11.5px] text-ink-faint">Best for: {p.best}</p>
                </div>
              </div>
              <div className="flex items-center justify-end gap-2 border-t border-rule bg-paper px-3.5 py-2.5">
                <Form method="post" onSubmit={(e) => { if (!confirm(`Add ${p.name} to your draft? Your live storefront stays the same until you publish.`)) e.preventDefault(); }}>
                  <input type="hidden" name="intent" value="preset" /><input type="hidden" name="preset" value={p.id} />
                  <button className="btn-secondary h-7 rounded-full px-4" disabled={nav.state !== "idle"}>Add</button>
                </Form>
              </div>
            </article>
          ))}
        </div>
      </section>

      {copies.length > 0 && <section>
        <div className="mb-2"><h2 className="text-[14px] font-semibold">Your theme copies</h2><p className="text-[12.5px] text-ink-soft">Copies and imported themes stay here until you choose to use one.</p></div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {copies.map((copy) => <article key={copy.id} className="panel overflow-hidden">
            <div className="group relative h-[190px] overflow-hidden border-b border-rule bg-paper-sunk">
              <ScaledFrame src={`/s/${store.slug}?gp_library=${copy.id}`} height={190} title={`${copy.name} preview`} lazy />
              <button type="button" onClick={() => setPreview({ name: copy.name, src: `/s/${store.slug}?gp_library=${copy.id}` })} className="absolute inset-0 flex items-center justify-center bg-black/20 text-[14px] font-semibold text-white opacity-0 backdrop-blur-[2px] transition duration-200 group-hover:opacity-100 group-focus-within:opacity-100">Preview</button>
            </div>
            <div className="flex items-start gap-3 p-3.5"><div className="min-w-0 flex-1"><p className="text-[13.5px] font-semibold">{copy.name}</p><p className="mt-0.5 text-[11.5px] text-ink-faint">Saved {when(copy.updatedAt)}</p></div>
            </div>
            <div className="flex flex-wrap gap-2 border-t border-rule bg-paper px-3.5 py-2.5">
              <Form method="post" className="flex-1" onSubmit={(e) => { if (hasDraft && !confirm(`Use ${copy.name}? This replaces your current unpublished draft; the live site stays unchanged until you publish.`)) e.preventDefault(); }}><input type="hidden" name="intent" value="use-copy" /><input type="hidden" name="copyId" value={copy.id} /><button className="btn-primary h-7 w-full justify-center" disabled={nav.state !== "idle"}>Use theme</button></Form>
              <Form method="post" onSubmit={(e) => { if (!confirm(`Remove ${copy.name} from your theme library?`)) e.preventDefault(); }}><input type="hidden" name="intent" value="delete-copy" /><input type="hidden" name="copyId" value={copy.id} /><button className="btn-secondary h-7 text-[#8e1f0b]">Remove</button></Form>
            </div>
          </article>)}
        </div>
      </section>}

      <section className="panel p-4">
        <h2 className="text-[13.5px] font-semibold">Earlier versions</h2>
        <p className="mt-0.5 text-[12.5px] text-ink-soft">Every publish keeps the design before it (last 5). Restore one to bring it back as a draft.</p>
        {history.length === 0 ? <p className="mt-3 text-[12.5px] text-ink-faint">Nothing yet. Versions appear after your second publish.</p> : (
          <ul className="mt-2 divide-y divide-rule">
            {history.map((h) => (
              <li key={h.index} className="flex items-center gap-3 py-2 text-[13px]">
                <span className="flex-1">{when(h.at)}{h.by ? <span className="text-ink-faint"> · replaced by {h.by}</span> : null}</span>
                <Form method="post"><input type="hidden" name="intent" value="restore" /><input type="hidden" name="index" value={h.index} /><button className="btn-secondary h-7">Restore</button></Form>
              </li>
            ))}
          </ul>
        )}
      </section>
      {preview && <ThemePreviewModal name={preview.name} src={preview.src} onClose={() => setPreview(null)} />}
    </div>
  );
}

function ThemePreviewModal({ name, src, onClose }: { name: string; src: string; onClose: () => void }) {
  const [device, setDevice] = useState<"desktop" | "mobile">("desktop");
  const stage = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  useEffect(() => {
    const el = stage.current;
    if (!el) return;
    const resize = () => setScale(Math.min(1, el.clientWidth / 390));
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return (
    <div className="fixed inset-0 z-[100] bg-black/65 p-2 md:p-5" role="dialog" aria-modal="true" aria-label="Theme preview">
      <div className="mx-auto flex h-full max-w-[1500px] flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
        <header className="flex flex-wrap items-center gap-2 border-b border-rule px-3 py-2.5 md:px-4">
          <div className="mr-auto min-w-[120px]"><p className="text-[13px] font-semibold">{name} theme preview</p><p className="text-[11px] text-ink-soft">Open a product to view its page. Scroll down for the footer links.</p></div>
          <div className="flex items-center rounded-lg bg-paper p-0.5">
            {(["desktop", "mobile"] as const).map((size) => <button key={size} type="button" onClick={() => setDevice(size)} className={`rounded-md px-2.5 py-1.5 text-[12px] capitalize ${device === size ? "bg-white font-semibold shadow-sm" : "text-ink-soft"}`}>{size}</button>)}
          </div>
          <button type="button" onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded-lg text-xl text-ink-soft hover:bg-paper" aria-label="Close preview">×</button>
        </header>
        <div ref={stage} className="flex flex-1 justify-center overflow-auto bg-[#ece9e6] p-3 md:p-5">
          {device === "desktop" ? (
            <div className="h-full min-h-[720px] w-full max-w-[1280px] overflow-hidden rounded-xl bg-white shadow-lg">
              <iframe key={`${src}-${device}`} src={src} title="Storefront desktop preview" className="h-full min-h-[720px] w-full border-0" />
            </div>
          ) : (
            <div className="relative shrink-0 overflow-hidden rounded-[30px] border-[6px] border-[#262626] bg-white shadow-xl" style={{ width: 390 * scale, height: 844 * scale }}>
              <iframe key={`${src}-${device}`} src={src} title="Storefront mobile preview" className="absolute left-0 top-0 border-0 bg-white" style={{ width: 390, height: 844, transform: `scale(${scale})`, transformOrigin: "top left" }} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

const trend = (now: number | null | undefined, before: number | null | undefined) => (now != null && before ? Math.round(((now - before) / before) * 100) : null);

function Vital({ label, tip, value, g, trend: t }: { label: string; tip: string; value: string; g: Grade | null; trend?: number | null }) {
  return (
    <div className="px-4 py-3">
      <p className="text-[12px] font-medium text-ink-soft underline decoration-dotted decoration-ink-faint underline-offset-4" title={tip}>{label}</p>
      <p className="mt-1 flex flex-wrap items-center gap-2">
        <span className="num text-[15px] font-semibold">{value}</span>
        {t != null && t !== 0 && <span className={`text-[11.5px] ${t < 0 ? "text-[#0c5132]" : "text-[#8e1f0b]"}`}>{t < 0 ? "↓" : "↑"} {Math.abs(t)}%</span>}
        {g && <span className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium ${GRADE[g][1]}`}><span className="h-1.5 w-1.5 rounded-full bg-current" />{GRADE[g][0]}</span>}
      </p>
    </div>
  );
}

/** A desktop-width (1280 px) page shrunk to fit its box. */
function ScaledFrame({ src, height, title, lazy }: { src: string; height: number; title: string; lazy?: boolean }) {
  const box = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.5);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setScale(el.clientWidth / 1280));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return (
    <div ref={box} className="relative w-full overflow-hidden" style={{ height }}>
      <iframe src={src} title={title} tabIndex={-1} loading={lazy ? "lazy" : undefined} className="pointer-events-none absolute left-0 top-0 origin-top-left border-0 bg-white"
        style={{ width: 1280, height: height / scale, transform: `scale(${scale})` }} />
    </div>
  );
}

function Menu({ items, dark }: { items: { label: string; to?: string; href?: string; form?: string; danger?: boolean }[]; dark?: boolean }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);
  if (!items.length) return null;
  return (
    <div className="relative" ref={ref}>
      <button type="button" onClick={() => setOpen(!open)} aria-label="More actions" aria-expanded={open}
        className={dark ? "flex h-8 w-8 items-center justify-center rounded-lg bg-white/15 text-white hover:bg-white/25" : "btn-secondary w-[30px] justify-center px-0"}>•••</button>
      {open && (
        <div className={`absolute right-0 z-30 w-60 overflow-hidden rounded-xl bg-white p-1 text-[13px] text-[#303030] shadow-[0_0_0_1px_rgba(0,0,0,.08),0_12px_32px_-8px_rgba(0,0,0,.3)] ${dark ? "bottom-full mb-1" : "top-full mt-1"}`}>
          {items.map((it) => it.to ? <Link key={it.label} to={it.to} className="block rounded-lg px-3 py-2 hover:bg-paper">{it.label}</Link>
            : it.href ? <a key={it.label} href={it.href} target="_blank" rel="noreferrer" className="block rounded-lg px-3 py-2 hover:bg-paper">{it.label}</a>
            : <Form key={it.label} method="post" onSubmit={(e) => { if (it.danger && !confirm(`${it.label}?`)) e.preventDefault(); }}><input type="hidden" name="intent" value={it.form} /><button className={`block w-full rounded-lg px-3 py-2 text-left hover:bg-paper ${it.danger ? "text-[#8e1f0b]" : ""}`}>{it.label}</button></Form>)}
        </div>
      )}
    </div>
  );
}
