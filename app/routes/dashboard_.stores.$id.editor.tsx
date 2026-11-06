// Growpefy Store → Theme editor (full screen): sections of every page, the header and footer, and theme-wide settings,
// with a live preview. Changes autosave as a draft; shoppers see them only after Publish.
import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Link, useLoaderData } from "@remix-run/react";
import { and, asc, eq } from "drizzle-orm";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { catalogCategories, catalogItems, db, storePages, type ThemeData, type ThemeSection, type ThemeTemplate } from "~/db.server";
import { requireStore, requireViewer } from "~/lib/auth.server";
import { catalogAllowed } from "~/lib/catalog.server";
import { themeManifest } from "~/lib/storefront.server";
import { editorState, publishDraft, saveDraft, THEME } from "~/lib/themes.server";

export const meta: MetaFunction<typeof loader> = ({ data }) => [{ title: data ? `Edit theme · ${data.store.name}` : "Edit theme" }, { name: "robots", content: "noindex" }];

export async function loader({ request, params }: LoaderFunctionArgs) {
  const viewer = await requireViewer(request);
  const store = await requireStore(viewer, params.id);
  if (!catalogAllowed(viewer, store)) throw new Response("Not found", { status: 404 });
  const [st, product, categories, page] = await Promise.all([
    editorState(store.id),
    db.select({ handle: catalogItems.handle }).from(catalogItems).where(and(eq(catalogItems.storeId, store.id), eq(catalogItems.status, "active"))).orderBy(asc(catalogItems.id)).limit(1),
    db.select({ title: catalogCategories.title, handle: catalogCategories.handle }).from(catalogCategories).where(eq(catalogCategories.storeId, store.id)).orderBy(asc(catalogCategories.position), asc(catalogCategories.title)),
    db.select({ handle: storePages.handle }).from(storePages).where(and(eq(storePages.storeId, store.id), eq(storePages.published, true))).orderBy(asc(storePages.position)).limit(1),
  ]);
  const m = themeManifest(THEME);
  return json({
    store: { id: store.id, slug: store.slug, name: store.name },
    manifest: { settingsSchema: m.settingsSchema, sections: m.sections, defaults: m.defaults },
    data: st.data, hasDraft: st.hasDraft,
    samples: { product: product[0]?.handle ?? null, collection: categories[0]?.handle ?? "all", page: page[0]?.handle ?? null },
    categories,
  });
}

export async function action({ request, params }: ActionFunctionArgs) {
  const viewer = await requireViewer(request);
  const store = await requireStore(viewer, params.id);
  if (!catalogAllowed(viewer, store)) throw new Response("Not found", { status: 404 });
  let body: { intent?: string; data?: unknown } = {};
  try { body = await request.json(); } catch { return json({ error: "Bad request" }, { status: 400 }); }
  try {
    if (body.intent === "save") { await saveDraft(store.id, body.data); return json({ ok: true }); }
    if (body.intent === "publish") {
      if (body.data) await saveDraft(store.id, body.data);
      await publishDraft(store.id, viewer.name);
      return json({ ok: true });
    }
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "Couldn't save" }, { status: 400 });
  }
  return json({ error: "Unknown action" }, { status: 400 });
}

// ---------- types and helpers ----------

/** Plain fetch to this route's action gets JSON back (not the page) with Remix's _data parameter. */
const DATA_ID = encodeURIComponent("routes/dashboard_.stores.$id.editor");

type Setting = { id: string; type: string; label?: string; default?: unknown; min?: number; max?: number; step?: number; unit?: string; options?: string[]; option_labels?: string[]; fields?: Setting[]; info?: string };
type Kind = { type: string; name: string; settings: Setting[]; where: "template" | "header" | "footer" | "fixed" };
type Group = "header" | "template" | "footer";
type Sel = { group: Group; id: string } | null;

const PAGES = [
  { key: "index", label: "Home page" },
  { key: "product", label: "Product page" },
  { key: "collection", label: "Category page" },
  { key: "cart", label: "Cart" },
  { key: "page", label: "Info pages (policies, about)" },
] as const;
type PageKey = (typeof PAGES)[number]["key"];

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
const newId = (type: string) => `${type.replace(/[^a-z0-9]/gi, "").slice(0, 20)}_${Math.random().toString(36).slice(2, 7)}`;
const listOf = (d: ThemeData, g: Group, page: PageKey): ThemeTemplate => (g === "template" ? d.templates[page] : d.groups[g]);
const strip = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

/** Theme settings that only change CSS variables: applied to the preview instantly, no reload. */
function cssVars(s: Record<string, unknown>): Record<string, string> {
  const px = (v: unknown, d: number) => `${Number(v ?? d) || d}px`;
  const ratio = s.card_ratio === "portrait" ? "4/5" : s.card_ratio === "landscape" ? "4/3" : "1/1";
  const v: Record<string, string> = {
    "--btn-text": String(s.color_button_text || "#ffffff"), "--bg": String(s.color_bg || "#ffffff"), "--ink": String(s.color_text || "#14171a"),
    "--soft": String(s.color_muted || "#5a6169"), "--tint": String(s.color_soft || "#f5f6f7"),
    "--announce-bg": String(s.color_announce_bg || "#14171a"), "--announce-text": String(s.color_announce_text || "#ffffff"),
    "--heading-scale": String((Number(s.heading_scale) || 100) / 100), "--heading-case": s.heading_uppercase ? "uppercase" : "none",
    "--btn-radius": px(s.button_radius, 12), "--btn-height": px(s.button_height, 48), "--card-ratio": ratio, "--radius": px(s.card_radius, 14), "--logo-width": px(s.logo_width, 140),
  };
  if (s.color_brand) v["--brand"] = String(s.color_brand);
  return v;
}
const CSS_ONLY = new Set(["color_brand", "color_button_text", "color_bg", "color_text", "color_muted", "color_soft", "color_announce_bg", "color_announce_text", "heading_scale", "heading_uppercase", "button_radius", "button_height", "card_ratio", "card_radius", "logo_width"]);

// ---------- editor ----------

export default function ThemeEditor() {
  const L = useLoaderData<typeof loader>();
  const kinds = L.manifest.sections as Kind[];
  const kindOf = useCallback((t: string) => kinds.find((k) => k.type === t), [kinds]);

  const [data, setData] = useState<ThemeData>(L.data as ThemeData);
  const [page, setPage] = useState<PageKey>("index");
  const [tab, setTab] = useState<"sections" | "settings">("sections");
  const [sel, setSel] = useState<Sel>(null);
  const [device, setDevice] = useState<"desktop" | "mobile">("desktop");
  const [full, setFull] = useState(false);
  const [status, setStatus] = useState<"saved" | "pending" | "saving" | "error" | "publishing" | "published">(L.hasDraft ? "saved" : "published");
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState<Group | null>(null);
  const [openGroup, setOpenGroup] = useState<string | null>(null);

  const undo = useRef<ThemeData[]>([]);
  const redo = useRef<ThemeData[]>([]);
  const lastKey = useRef<{ key: string; at: number } | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout>>();
  const needsReload = useRef(false);
  const dataRef = useRef(data);
  dataRef.current = data;
  const frame = useRef<HTMLIFrameElement>(null);
  const scrollY = useRef(0);
  const [, force] = useState(0);

  const base = `/s/${L.store.slug}`;
  const path = page === "index" ? "" : page === "product" ? (L.samples.product ? `/products/${L.samples.product}` : null)
    : page === "collection" ? `/collections/${L.samples.collection}` : page === "cart" ? "/cart" : L.samples.page ? `/pages/${L.samples.page}` : null;
  const [nonce, setNonce] = useState(0);
  const src = path == null ? null : `${base}${path}?gp_editor=1&v=${nonce}`;

  const post = useCallback((msg: unknown) => frame.current?.contentWindow?.postMessage(msg, "*"), []);

  // ----- saving -----
  const save = useCallback(async () => {
    clearTimeout(saveTimer.current);
    setStatus("saving");
    try {
      const r = await fetch(`/dashboard/stores/${L.store.id}/editor?_data=${DATA_ID}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ intent: "save", data: dataRef.current }) });
      const j = await r.json().catch(() => ({ error: "Couldn't save" }));
      if (!r.ok || j.error) throw new Error(j.error ?? "Couldn't save");
      setStatus("saved"); setError(null);
      if (needsReload.current) {
        needsReload.current = false;
        try { scrollY.current = frame.current?.contentWindow?.scrollY ?? 0; } catch { /* other origin */ }
        setNonce((n) => n + 1);
      }
    } catch (e) {
      setStatus("error"); setError(e instanceof Error ? e.message : "Couldn't save");
    }
  }, [L.store.id]);

  const change = useCallback((fn: (d: ThemeData) => void, opts: { key?: string; cssOnly?: boolean } = {}) => {
    const prev = dataRef.current;
    const next = clone(prev);
    fn(next);
    const now = Date.now();
    const same = opts.key && lastKey.current?.key === opts.key && now - lastKey.current.at < 1200;
    if (!same) { undo.current.push(prev); if (undo.current.length > 60) undo.current.shift(); redo.current = []; }
    lastKey.current = opts.key ? { key: opts.key, at: now } : null;
    dataRef.current = next;
    setData(next);
    if (opts.cssOnly) post({ gp: "vars", vars: cssVars(next.settings) });
    else needsReload.current = true;
    setStatus("pending");
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(save, opts.cssOnly ? 900 : 600);
  }, [post, save]);

  const step = useCallback((dir: "undo" | "redo") => {
    const from = dir === "undo" ? undo.current : redo.current;
    const to = dir === "undo" ? redo.current : undo.current;
    const d = from.pop();
    if (!d) return;
    to.push(dataRef.current);
    dataRef.current = d; setData(d); lastKey.current = null;
    needsReload.current = true; setStatus("pending");
    clearTimeout(saveTimer.current); saveTimer.current = setTimeout(save, 300);
    force((n) => n + 1);
  }, [save]);

  const publish = async () => {
    clearTimeout(saveTimer.current);
    setStatus("publishing");
    try {
      const r = await fetch(`/dashboard/stores/${L.store.id}/editor?_data=${DATA_ID}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ intent: "publish", data: dataRef.current }) });
      const j = await r.json().catch(() => ({ error: "Couldn't publish" }));
      if (!r.ok || j.error) throw new Error(j.error ?? "Couldn't publish");
      setStatus("published"); setError(null);
    } catch (e) { setStatus("error"); setError(e instanceof Error ? e.message : "Couldn't publish"); }
  };

  // keyboard: undo / redo / save
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      const k = e.key.toLowerCase();
      const typing = (e.target as HTMLElement)?.closest("input,textarea,select");
      if (k === "s") { e.preventDefault(); save(); }
      else if (!typing && k === "z") { e.preventDefault(); step(e.shiftKey ? "redo" : "undo"); }
      else if (!typing && k === "y") { e.preventDefault(); step("redo"); }
    };
    const onLeave = (e: BeforeUnloadEvent) => { if (status === "pending" || status === "saving") { e.preventDefault(); e.returnValue = ""; } };
    window.addEventListener("keydown", onKey);
    window.addEventListener("beforeunload", onLeave);
    return () => { window.removeEventListener("keydown", onKey); window.removeEventListener("beforeunload", onLeave); };
  }, [save, step, status]);

  // messages from the preview: a section was clicked
  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      if (e.source !== frame.current?.contentWindow) return;
      const d = e.data as { gp?: string; id?: string };
      if (d?.gp === "clicked" && d.id) {
        const [g, id] = d.id.split("/") as [Group, string];
        setTab("sections"); setSel({ group: g, id }); setFull(false);
      }
    };
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  }, []);

  useEffect(() => { post({ gp: "select", id: sel ? `${sel.group}/${sel.id}` : null }); }, [sel, post]);
  useEffect(() => { setSel((s) => (s?.group === "template" ? null : s)); }, [page]);

  const onFrameLoad = () => {
    try { frame.current?.contentWindow?.scrollTo(0, scrollY.current); } catch { /* ignore */ }
    scrollY.current = 0;
    post({ gp: "vars", vars: cssVars(dataRef.current.settings) });
    if (sel) post({ gp: "select", id: `${sel.group}/${sel.id}` });
  };

  // ----- section operations -----
  const selected = sel ? listOf(data, sel.group, page).sections[sel.id] : null;
  const selKind = selected ? kindOf(selected.type) : null;

  const move = (g: Group, id: string, by: number) => change((d) => {
    const l = listOf(d, g, page); const i = l.order.indexOf(id); const j = i + by;
    if (i < 0 || j < 0 || j >= l.order.length) return;
    [l.order[i], l.order[j]] = [l.order[j], l.order[i]];
  });
  const toggle = (g: Group, id: string) => change((d) => { const s = listOf(d, g, page).sections[id]; if (s) s.disabled = !s.disabled || undefined; });
  const remove = (g: Group, id: string) => {
    if (!confirm("Remove this section?")) return;
    change((d) => { const l = listOf(d, g, page); delete l.sections[id]; l.order = l.order.filter((o) => o !== id); });
    setSel(null);
  };
  const duplicate = (g: Group, id: string) => {
    const nid = newId(listOf(dataRef.current, g, page).sections[id]?.type ?? "section");
    change((d) => { const l = listOf(d, g, page); const s = l.sections[id]; if (!s) return; l.sections[nid] = clone(s); l.order.splice(l.order.indexOf(id) + 1, 0, nid); });
    setSel({ group: g, id: nid });
  };
  const add = (g: Group, type: string) => {
    const nid = newId(type);
    change((d) => {
      const l = listOf(d, g, page);
      l.sections[nid] = { type, settings: {} };
      const after = sel?.group === g ? l.order.indexOf(sel.id) : -1;
      if (after >= 0) l.order.splice(after + 1, 0, nid); else l.order.push(nid);
    });
    setAdding(null); setSel({ group: g, id: nid });
  };
  const setSectionSetting = (id: string, value: unknown) => {
    if (!sel) return;
    change((d) => { const s = listOf(d, sel.group, page).sections[sel.id]; if (s) s.settings = { ...(s.settings ?? {}), [id]: value }; }, { key: `${sel.group}/${sel.id}/${id}` });
  };
  const resetSection = () => {
    if (!sel || !confirm("Put this section back to its original settings?")) return;
    change((d) => { const s = listOf(d, sel.group, page).sections[sel.id]; if (s) s.settings = {}; });
  };
  const setThemeSetting = (id: string, value: unknown) => change((d) => { d.settings[id] = value; }, { key: `settings/${id}`, cssOnly: CSS_ONLY.has(id) });

  const statusText = { saved: "Draft saved", pending: "Unsaved changes", saving: "Saving…", error: "Not saved", publishing: "Publishing…", published: "Published" }[status];
  const canPublish = status !== "published" && status !== "publishing";

  return (
    <div className="fixed inset-0 flex flex-col bg-paper text-ink">
      {/* top bar */}
      <header className="flex h-14 flex-none items-center gap-2 border-b border-rule bg-paper-raised px-3">
        <Link to={`/dashboard/stores/${L.store.id}/themes`} className="btn-quiet" aria-label="Exit editor">← Exit</Link>
        <div className="hidden min-w-0 sm:block">
          <p className="truncate text-sm font-semibold leading-tight">{L.store.name}</p>
          <p className={`text-xs leading-tight ${status === "error" ? "text-bad" : "text-ink-faint"}`}>Swift · {statusText}</p>
        </div>
        <div className="mx-auto flex items-center gap-2">
          <select value={page} onChange={(e) => setPage(e.target.value as PageKey)} className="input h-9 w-auto py-0 text-sm" aria-label="Page to edit">
            {PAGES.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
          </select>
          <div className="hidden rounded-lg border border-rule-strong p-0.5 md:flex" role="group" aria-label="Preview size">
            {(["desktop", "mobile"] as const).map((d) => (
              <button key={d} type="button" onClick={() => setDevice(d)} className={`rounded-md px-2.5 py-1 text-xs font-medium ${device === d ? "bg-paper-sunk text-ink" : "text-ink-soft"}`} aria-pressed={device === d}>{d === "desktop" ? "Desktop" : "Phone"}</button>
            ))}
          </div>
          <button type="button" onClick={() => setFull((f) => !f)} className="btn-quiet hidden md:inline-flex" aria-pressed={full} title="Hide the side panel">{full ? "Show panel" : "Full view"}</button>
        </div>
        <button type="button" onClick={() => step("undo")} disabled={!undo.current.length} className="btn-quiet" title="Undo (Ctrl+Z)" aria-label="Undo">↶</button>
        <button type="button" onClick={() => step("redo")} disabled={!redo.current.length} className="btn-quiet" title="Redo (Ctrl+Shift+Z)" aria-label="Redo">↷</button>
        <a href={`${base}${path ?? ""}?gp_draft=1`} target="_blank" rel="noreferrer" className="btn-secondary hidden h-9 sm:inline-flex">Preview</a>
        <button type="button" onClick={publish} disabled={!canPublish} className="btn-primary h-9">{status === "publishing" ? "Publishing…" : status === "published" ? "Published" : "Publish"}</button>
      </header>
      {error && <p className="flex-none bg-red-50 px-4 py-2 text-sm text-bad" role="alert">{error} <button type="button" className="underline" onClick={save}>Try again</button></p>}

      <div className="flex min-h-0 flex-1">
        {/* side panel */}
        {!full && (
          <aside className="flex w-full max-w-[340px] flex-none flex-col border-r border-rule bg-paper-raised">
            <div className="flex flex-none border-b border-rule text-sm" role="tablist">
              {(["sections", "settings"] as const).map((t) => (
                <button key={t} type="button" role="tab" aria-selected={tab === t} onClick={() => { setTab(t); setSel(null); }} className={`flex-1 py-2.5 font-medium ${tab === t ? "border-b-2 border-ink text-ink" : "text-ink-soft"}`}>{t === "sections" ? "Sections" : "Theme settings"}</button>
              ))}
            </div>
            <div className="scroll-thin min-h-0 flex-1 overflow-y-auto">
              {tab === "sections" && !selected && (
                <div className="space-y-4 p-3">
                  {(["header", "template", "footer"] as Group[]).map((g) => (
                    <SectionList key={g} title={g === "header" ? "Header" : g === "footer" ? "Footer" : PAGES.find((p) => p.key === page)!.label}
                      list={listOf(data, g, page)} kindOf={kindOf} sel={sel}
                      onSelect={(id) => setSel({ group: g, id })} onToggle={(id) => toggle(g, id)} onMove={(id, by) => move(g, id, by)}
                      onAdd={() => setAdding(adding === g ? null : g)}>
                      {adding === g && (
                        <div className="mt-1 rounded-lg border border-rule bg-paper p-1.5">
                          <p className="px-2 py-1 text-xs font-medium text-ink-faint">Add a section</p>
                          {kinds.filter((k) => (g === "header" ? k.where === "header" : k.where === "template" || (g === "footer" && k.where === "footer"))).map((k) => (
                            <button key={k.type} type="button" onClick={() => add(g, k.type)} className="block w-full rounded-md px-2 py-1.5 text-left text-sm hover:bg-paper-sunk">{k.name}</button>
                          ))}
                        </div>
                      )}
                    </SectionList>
                  ))}
                  {path == null && <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">{page === "product" ? "Add an active product to see this page in the preview." : "Publish one page (Pages menu) to see it in the preview."}</p>}
                  <p className="px-1 text-xs text-ink-faint">Tip: click any part of the preview to edit it. Ctrl+Z undoes.</p>
                </div>
              )}

              {tab === "sections" && selected && sel && (
                <div className="p-3">
                  <button type="button" onClick={() => setSel(null)} className="btn-quiet -ml-2 mb-2">← All sections</button>
                  <h2 className="text-base font-semibold">{selKind?.name ?? selected.type}</h2>
                  {selKind?.where === "fixed" ? (
                    <p className="mt-2 text-sm text-ink-soft">This part fills itself from your {page === "product" ? "products" : page === "collection" ? "categories" : page === "cart" ? "shoppers' carts" : "pages"}. Change its look in Theme settings.</p>
                  ) : (
                    <div className="mt-3 space-y-4">
                      {(selKind?.settings ?? []).map((s) => (
                        <Field key={`${sel.id}/${s.id}`} s={s as Setting} value={(selected.settings ?? {})[s.id] ?? s.default} onChange={(v) => setSectionSetting(s.id, v)} storeId={L.store.id} categories={L.categories} />
                      ))}
                      {(selKind?.settings ?? []).length === 0 && <p className="text-sm text-ink-soft">Nothing to set here.</p>}
                    </div>
                  )}
                  {selKind?.where !== "fixed" && (
                    <div className="mt-6 flex flex-wrap gap-2 border-t border-rule pt-4">
                      <button type="button" onClick={() => toggle(sel.group, sel.id)} className="btn-secondary h-9">{selected.disabled ? "Show section" : "Hide section"}</button>
                      <button type="button" onClick={() => duplicate(sel.group, sel.id)} className="btn-secondary h-9">Duplicate</button>
                      <button type="button" onClick={resetSection} className="btn-quiet h-9">Reset</button>
                      <button type="button" onClick={() => remove(sel.group, sel.id)} className="btn-danger h-9">Remove</button>
                    </div>
                  )}
                </div>
              )}

              {tab === "settings" && (
                <div className="divide-y divide-rule">
                  {(L.manifest.settingsSchema as { name: string; settings: Setting[] }[]).map((g) => (
                    <div key={g.name}>
                      <button type="button" onClick={() => setOpenGroup(openGroup === g.name ? null : g.name)} className="flex w-full items-center justify-between px-4 py-3 text-left text-sm font-medium hover:bg-paper" aria-expanded={openGroup === g.name}>
                        {g.name}<span className="text-ink-faint">{openGroup === g.name ? "−" : "+"}</span>
                      </button>
                      {openGroup === g.name && (
                        <div className="space-y-4 px-4 pb-5">
                          {g.settings.map((s) => <Field key={s.id} s={s} value={data.settings[s.id] ?? s.default} onChange={(v) => setThemeSetting(s.id, v)} storeId={L.store.id} categories={L.categories} />)}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </aside>
        )}

        {/* preview */}
        <main className="flex min-w-0 flex-1 items-stretch justify-center overflow-auto bg-paper-sunk p-3">
          {src ? (
            <div className={`h-full overflow-hidden rounded-xl border border-rule bg-white shadow-sm transition-[width] ${device === "mobile" ? "w-[390px]" : "w-full"}`}>
              <iframe ref={frame} key={page} src={src} onLoad={onFrameLoad} title="Website preview" className="h-full w-full border-0" />
            </div>
          ) : (
            <div className="m-auto max-w-sm text-center text-sm text-ink-soft">Nothing to preview for this page yet.</div>
          )}
        </main>
      </div>
    </div>
  );
}

// ---------- pieces ----------

function SectionList({ title, list, kindOf, sel, onSelect, onToggle, onMove, onAdd, children }: {
  title: string; list: ThemeTemplate; kindOf: (t: string) => Kind | undefined; sel: Sel;
  onSelect: (id: string) => void; onToggle: (id: string) => void; onMove: (id: string, by: number) => void; onAdd: () => void; children?: React.ReactNode;
}) {
  return (
    <section>
      <h3 className="px-1 pb-1 text-xs font-semibold uppercase tracking-wide text-ink-faint">{title}</h3>
      <ul className="space-y-0.5">
        {list.order.map((id, i) => {
          const s = list.sections[id] as ThemeSection | undefined;
          if (!s) return null;
          const k = kindOf(s.type);
          const fixed = k?.where === "fixed";
          const hint = String(s.settings?.heading ?? s.settings?.text ?? "");
          return (
            <li key={id} className={`group flex items-center gap-1 rounded-lg pr-1 ${sel?.id === id ? "bg-paper-sunk" : "hover:bg-paper"}`}>
              <button type="button" onClick={() => onSelect(id)} className={`min-w-0 flex-1 px-2 py-1.5 text-left ${s.disabled ? "opacity-50" : ""}`}>
                <span className="block truncate text-sm">{k?.name ?? s.type}</span>
                {hint && <span className="block truncate text-xs text-ink-faint">{strip(hint).slice(0, 50)}</span>}
              </button>
              {!fixed && (
                <span className="flex flex-none items-center opacity-60 group-hover:opacity-100">
                  <IconBtn label="Move up" onClick={() => onMove(id, -1)} disabled={i === 0}>↑</IconBtn>
                  <IconBtn label="Move down" onClick={() => onMove(id, 1)} disabled={i === list.order.length - 1}>↓</IconBtn>
                  <IconBtn label={s.disabled ? "Show" : "Hide"} onClick={() => onToggle(id)}>{s.disabled ? "◌" : "◉"}</IconBtn>
                </span>
              )}
            </li>
          );
        })}
      </ul>
      <button type="button" onClick={onAdd} className="mt-1 flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-sm font-medium text-brand hover:bg-paper">+ Add section</button>
      {children}
    </section>
  );
}

function IconBtn({ label, onClick, disabled, children }: { label: string; onClick: () => void; disabled?: boolean; children: React.ReactNode }) {
  return <button type="button" onClick={onClick} disabled={disabled} aria-label={label} title={label} className="grid h-7 w-7 place-items-center rounded-md text-sm text-ink-soft hover:bg-paper-sunk hover:text-ink disabled:opacity-30">{children}</button>;
}

function Field({ s, value, onChange, storeId, categories }: { s: Setting; value: unknown; onChange: (v: unknown) => void; storeId: number; categories: { title: string; handle: string }[] }) {
  const id = `f-${s.id}-${useId().replace(/:/g, "")}`;
  const label = <label htmlFor={id} className="label">{s.label ?? s.id}</label>;
  const str = value == null ? "" : String(value);
  switch (s.type) {
    case "checkbox":
      return <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={Boolean(value)} onChange={(e) => onChange(e.target.checked)} className="h-4 w-4" />{s.label}</label>;
    case "textarea":
    case "richtext":
      return <div>{label}<textarea id={id} value={str} onChange={(e) => onChange(e.target.value)} rows={s.type === "richtext" ? 5 : 3} className="input text-sm" />{s.type === "richtext" && <span className="hint">You can use simple HTML like &lt;p&gt;, &lt;b&gt;, &lt;a href&gt;.</span>}</div>;
    case "color":
      return (
        <div>{label}
          <div className="flex items-center gap-2">
            <input type="color" value={/^#[0-9a-f]{6}$/i.test(str) ? str : "#111827"} onChange={(e) => onChange(e.target.value)} className="h-9 w-11 cursor-pointer rounded border border-rule-strong bg-surface p-0.5" aria-label={s.label} />
            <input id={id} value={str} onChange={(e) => onChange(e.target.value)} placeholder="Store default" className="input h-9 py-0 font-mono text-sm" />
          </div>
        </div>
      );
    case "range": {
      const n = Number(value ?? s.default ?? s.min ?? 0);
      return (
        <div><div className="flex items-baseline justify-between">{label}<span className="num text-xs text-ink-soft">{n}{s.unit ?? ""}</span></div>
          <input id={id} type="range" min={s.min ?? 0} max={s.max ?? 100} step={s.step ?? 1} value={n} onChange={(e) => onChange(Number(e.target.value))} className="w-full accent-current" />
        </div>
      );
    }
    case "select":
      return <div>{label}<select id={id} value={str} onChange={(e) => onChange(e.target.value)} className="input h-9 py-0 text-sm">{(s.options ?? []).map((o, i) => <option key={o} value={o}>{s.option_labels?.[i] ?? o[0].toUpperCase() + o.slice(1)}</option>)}</select></div>;
    case "collection":
      return <div>{label}<select id={id} value={str} onChange={(e) => onChange(e.target.value)} className="input h-9 py-0 text-sm"><option value="">All products</option>{categories.map((c) => <option key={c.handle} value={c.handle}>{c.title}</option>)}</select></div>;
    case "image":
    case "video":
      return <MediaField id={id} s={s} value={str} onChange={onChange} storeId={storeId} />;
    case "list":
      return <ListField s={s} value={Array.isArray(value) ? (value as Record<string, unknown>[]) : []} onChange={onChange} storeId={storeId} categories={categories} />;
    case "url":
      return <div>{label}<input id={id} value={str} onChange={(e) => onChange(e.target.value)} placeholder="/collections/all or https://…" className="input h-9 py-0 text-sm" /></div>;
    default:
      return <div>{label}<input id={id} value={str} onChange={(e) => onChange(e.target.value)} className="input h-9 py-0 text-sm" /></div>;
  }
}

function MediaField({ id, s, value, onChange, storeId }: { id: string; s: Setting; value: string; onChange: (v: unknown) => void; storeId: number }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const upload = async (f: File) => {
    setBusy(true); setErr(null);
    try {
      const r = await fetch(`/dashboard/stores/${storeId}/media`, { method: "POST", headers: { "Content-Type": f.type }, body: f });
      const j = await r.json();
      if (!r.ok || !j.url) throw new Error(j.error ?? "Upload failed");
      onChange(j.url);
    } catch (e) { setErr(e instanceof Error ? e.message : "Upload failed"); } finally { setBusy(false); }
  };
  const video = s.type === "video";
  return (
    <div>
      <label htmlFor={id} className="label">{s.label}</label>
      {value ? (
        <div className="relative overflow-hidden rounded-lg border border-rule bg-paper-sunk">
          {video ? <video src={value} muted loop autoPlay playsInline className="h-32 w-full object-cover" /> : <img src={value} alt="" className="h-32 w-full object-contain" />}
        </div>
      ) : (
        <button type="button" onClick={() => input.current?.click()} className="grid h-24 w-full place-items-center rounded-lg border border-dashed border-rule-strong text-sm text-ink-soft hover:bg-paper">{busy ? "Uploading…" : `Upload ${video ? "a video" : "an image"}`}</button>
      )}
      <div className="mt-2 flex gap-2">
        <button type="button" onClick={() => input.current?.click()} disabled={busy} className="btn-secondary h-8 px-3 text-xs">{busy ? "Uploading…" : value ? "Change" : "Upload"}</button>
        {value && <button type="button" onClick={() => onChange("")} className="btn-danger h-8 text-xs">Remove</button>}
      </div>
      <input id={id} ref={input} type="file" accept={video ? "video/mp4,video/webm,video/quicktime" : "image/*"} className="sr-only" onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f); e.target.value = ""; }} />
      {err && <span className="error-text">{err}</span>}
    </div>
  );
}

function ListField({ s, value, onChange, storeId, categories }: { s: Setting; value: Record<string, unknown>[]; onChange: (v: unknown) => void; storeId: number; categories: { title: string; handle: string }[] }) {
  const [open, setOpen] = useState<number | null>(null);
  const fields = s.fields ?? [];
  const set = (i: number, k: string, v: unknown) => onChange(value.map((x, j) => (j === i ? { ...x, [k]: v } : x)));
  const swap = (i: number, j: number) => { if (j < 0 || j >= value.length) return; const n = value.slice(); [n[i], n[j]] = [n[j], n[i]]; onChange(n); setOpen(j); };
  const title = (x: Record<string, unknown>) => String(x[fields[0]?.id ?? ""] ?? "") || "Untitled";
  return (
    <div>
      <p className="label">{s.label}</p>
      <ul className="space-y-1.5">
        {value.map((x, i) => (
          <li key={i} className="rounded-lg border border-rule">
            <div className="flex items-center gap-1 pr-1">
              <button type="button" onClick={() => setOpen(open === i ? null : i)} className="min-w-0 flex-1 truncate px-3 py-2 text-left text-sm" aria-expanded={open === i}>{title(x)}</button>
              <IconBtn label="Move up" onClick={() => swap(i, i - 1)} disabled={i === 0}>↑</IconBtn>
              <IconBtn label="Move down" onClick={() => swap(i, i + 1)} disabled={i === value.length - 1}>↓</IconBtn>
              <IconBtn label="Remove" onClick={() => { onChange(value.filter((_, j) => j !== i)); setOpen(null); }}>✕</IconBtn>
            </div>
            {open === i && (
              <div className="space-y-3 border-t border-rule p-3">
                {fields.map((f) => <Field key={f.id} s={f} value={x[f.id] ?? f.default ?? (f.type === "range" ? f.max : "")} onChange={(v) => set(i, f.id, v)} storeId={storeId} categories={categories} />)}
              </div>
            )}
          </li>
        ))}
      </ul>
      {value.length < 20 && (
        <button type="button" onClick={() => { const blank = Object.fromEntries(fields.map((f) => [f.id, f.type === "range" ? f.max ?? 5 : f.type === "select" ? f.options?.[0] ?? "" : ""])); onChange([...value, blank]); setOpen(value.length); }}
          className="mt-1.5 text-sm font-medium text-brand hover:underline">+ Add</button>
      )}
    </div>
  );
}
