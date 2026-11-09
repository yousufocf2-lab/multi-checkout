// Growpefy Storefront Studio (full screen): sections of every page, the header and footer, and theme-wide settings,
// with a live preview. Changes autosave as a draft; shoppers see them only after Publish.
import type { ActionFunctionArgs, LinksFunction, LoaderFunctionArgs, MetaFunction } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Link, useLoaderData } from "@remix-run/react";
import { and, asc, eq } from "drizzle-orm";
import { createContext, useCallback, useContext, useEffect, useId, useRef, useState } from "react";
import { catalogCategories, catalogItems, db, storePages, type ThemeData, type ThemeSection, type ThemeTemplate } from "~/db.server";
import { requireStore, requireViewer } from "~/lib/auth.server";
import { catalogAllowed } from "~/lib/catalog.server";
import { themeManifest } from "~/lib/storefront.server";
import { listMenus } from "~/lib/menus.server";
import { editorState, publishDraft, saveDraft, THEME } from "~/lib/themes.server";
import { storePath } from "~/lib/store-code";

export const meta: MetaFunction<typeof loader> = ({ data }) => [{ title: data ? `Storefront Studio · ${data.store.name}` : "Storefront Studio" }, { name: "robots", content: "noindex" }];

export const links: LinksFunction = () => [
  { rel: "preconnect", href: "https://fonts.googleapis.com" },
  { rel: "stylesheet", href: "https://fonts.googleapis.com/css2?family=Inter:wght@400;450;500;550;600;650&display=swap" },
];

export async function loader({ request, params }: LoaderFunctionArgs) {
  const viewer = await requireViewer(request);
  const store = await requireStore(viewer, params.id);
  if (!catalogAllowed(viewer, store)) throw new Response("Not found", { status: 404 });
  const [st, product, categories, page, menus] = await Promise.all([
    editorState(store.id),
    db.select({ handle: catalogItems.handle }).from(catalogItems).where(and(eq(catalogItems.storeId, store.id), eq(catalogItems.status, "active"))).orderBy(asc(catalogItems.id)).limit(1),
    db.select({ title: catalogCategories.title, handle: catalogCategories.handle }).from(catalogCategories).where(eq(catalogCategories.storeId, store.id)).orderBy(asc(catalogCategories.position), asc(catalogCategories.title)),
    db.select({ handle: storePages.handle }).from(storePages).where(and(eq(storePages.storeId, store.id), eq(storePages.published, true))).orderBy(asc(storePages.position)).limit(1),
    listMenus(store.id),
  ]);
  const m = themeManifest(THEME);
  return json({
    store: { id: store.id, slug: store.slug, name: store.name },
    manifest: { settingsSchema: m.settingsSchema, sections: m.sections, defaults: m.defaults },
    data: st.data, hasDraft: st.hasDraft,
    samples: { product: product[0]?.handle ?? null, collection: categories[0]?.handle ?? "all", page: page[0]?.handle ?? null },
    categories,
    menus: menus.map((m) => ({ title: m.title, handle: m.handle, where: m.inHeader ? "Header" : m.inFooter ? "Footer" : "" })),
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
const DATA_ID = encodeURIComponent("routes/store_.$id.editor");

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
  const path = page === "index" ? "" : page === "product" ? `/product/${L.samples.product ?? "__sample"}`
    : page === "collection" ? (L.samples.collection === "all" || !L.samples.collection ? "/products/all" : `/category/${L.samples.collection}`) : page === "cart" ? "/cart" : `/pages/${L.samples.page ?? "__sample"}`;
  const [nonce, setNonce] = useState(0);
  const src = path == null ? null : `${base}${path}?gp_editor=1&v=${nonce}`;

  const post = useCallback((msg: unknown) => frame.current?.contentWindow?.postMessage(msg, "*"), []);

  // ----- saving -----
  const save = useCallback(async () => {
    clearTimeout(saveTimer.current);
    setStatus("saving");
    try {
      const r = await fetch(`${storePath(L.store.id)}/editor?_data=${DATA_ID}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ intent: "save", data: dataRef.current }) });
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
      const r = await fetch(`${storePath(L.store.id)}/editor?_data=${DATA_ID}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ intent: "publish", data: dataRef.current }) });
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

  const reorder = (g: Group, id: string, to: number) => change((d) => {
    const l = listOf(d, g, page); const i = l.order.indexOf(id);
    if (i < 0) return;
    l.order.splice(i, 1); l.order.splice(Math.max(0, Math.min(to > i ? to - 1 : to, l.order.length)), 0, id);
  });

  const statusText = { saved: "Saved", pending: "Unsaved", saving: "Saving…", error: "Not saved", publishing: "Publishing…", published: "Live" }[status];
  const canPublish = status !== "published" && status !== "publishing";
  const pageLabel = PAGES.find((p) => p.key === page)!.label;
  const settingsGroups = L.manifest.settingsSchema as { name: string; settings: Setting[] }[];

  return (
    <MenusCtx.Provider value={L.menus}>
    <div className="ed">
      <style dangerouslySetInnerHTML={{ __html: ED_CSS }} />
      {/* top bar */}
      <header className="ed-top">
        <div className="ed-top__l">
          <Link to={`${storePath(L.store.id)}/themes`} className="ed-ib" aria-label="Exit editor" title="Exit"><I n="exit" /></Link>
          <span className="ed-sep" />
          <span className="ed-store">{L.store.name} · Storefront Studio</span>
          <span className={`ed-pill ed-pill--${status === "published" ? "live" : status === "error" ? "err" : "draft"}`}>{statusText}</span>
        </div>
        <div className="ed-top__c">
          <label className="ed-pagepick">
            <I n="page" />
            <select value={page} onChange={(e) => setPage(e.target.value as PageKey)} aria-label="Page to edit">
              {PAGES.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
            </select>
            <I n="chev" />
          </label>
        </div>
        <div className="ed-top__r">
          <div className="ed-seg" role="group" aria-label="Preview size">
            <button type="button" className={device === "desktop" ? "on" : ""} onClick={() => setDevice("desktop")} aria-pressed={device === "desktop"} title="Desktop"><I n="desktop" /></button>
            <button type="button" className={device === "mobile" ? "on" : ""} onClick={() => setDevice("mobile")} aria-pressed={device === "mobile"} title="Phone"><I n="phone" /></button>
            <button type="button" className={full ? "on" : ""} onClick={() => setFull((f) => !f)} aria-pressed={full} title="Full view"><I n="expand" /></button>
          </div>
          <span className="ed-sep" />
          <button type="button" className="ed-ib" onClick={() => step("undo")} disabled={!undo.current.length} title="Undo (Ctrl+Z)" aria-label="Undo"><I n="undo" /></button>
          <button type="button" className="ed-ib" onClick={() => step("redo")} disabled={!redo.current.length} title="Redo (Ctrl+Shift+Z)" aria-label="Redo"><I n="redo" /></button>
          <a href={`${base}${path ?? ""}?gp_draft=1`} target="_blank" rel="noreferrer" className="ed-ib" title="Preview in a new tab" aria-label="Preview in a new tab"><I n="eye" /></a>
          <button type="button" onClick={publish} disabled={!canPublish} className="ed-btn ed-btn--primary">{status === "publishing" ? "Publishing…" : status === "published" ? "Published" : "Publish"}</button>
        </div>
      </header>
      {error && <div className="ed-err" role="alert">{error} <button type="button" onClick={save}>Try again</button></div>}

      <div className="ed-body">
        {!full && (
          <>
            {/* icon rail */}
            <nav className="ed-rail" aria-label="Editor tools">
              <button type="button" className={tab === "sections" ? "on" : ""} onClick={() => { setTab("sections"); setSel(null); }} title="Sections" aria-label="Sections"><I n="sections" /></button>
              <button type="button" className={tab === "settings" ? "on" : ""} onClick={() => { setTab("settings"); setSel(null); }} title="Theme settings" aria-label="Theme settings"><I n="brush" /></button>
            </nav>

            <aside className="ed-panel">
              {tab === "sections" && !selected && (
                <>
                  <div className="ed-panel__head"><h2>{pageLabel}</h2></div>
                  <div className="ed-scroll">
                    {(["header", "template", "footer"] as Group[]).map((g) => (
                      <SectionList key={g} group={g} title={g === "header" ? "Header" : g === "footer" ? "Footer" : "Template"}
                        list={listOf(data, g, page)} kindOf={kindOf} sel={sel}
                        onSelect={(id) => setSel({ group: g, id })} onToggle={(id) => toggle(g, id)} onReorder={(id, to) => reorder(g, id, to)}
                        onAdd={() => setAdding(adding === g ? null : g)} adding={adding === g}>
                        {adding === g && (
                          <SectionPicker kinds={kinds.filter((k) => (g === "header" ? k.where === "header" : k.where === "template" || (g === "footer" && k.where === "footer")))}
                            onPick={(t) => add(g, t)} onClose={() => setAdding(null)} />
                        )}
                      </SectionList>
                    ))}
                    {((page === "product" && !L.samples.product) || (page === "page" && !L.samples.page)) && <p className="ed-note">The preview shows a sample {page === "product" ? "product" : "page"}. Your real {page === "product" ? "products" : "pages"} use the same design.</p>}
                  </div>
                </>
              )}

              {tab === "sections" && selected && sel && (
                <>
                  <div className="ed-panel__head">
                    <button type="button" className="ed-ib" onClick={() => setSel(null)} aria-label="Back to sections"><I n="back" /></button>
                    <h2>{selKind?.name ?? selected.type}</h2>
                    {selKind?.where !== "fixed" && (
                      <button type="button" className="ed-ib" onClick={() => toggle(sel.group, sel.id)} title={selected.disabled ? "Show section" : "Hide section"} aria-label={selected.disabled ? "Show section" : "Hide section"}><I n={selected.disabled ? "eyeOff" : "eye"} /></button>
                    )}
                  </div>
                  <div className="ed-scroll ed-form">
                    {selKind?.where === "fixed" && !(selKind?.settings ?? []).length ? (
                      <p className="ed-muted">This part fills itself from your {page === "collection" ? "categories" : page === "cart" ? "shoppers' carts" : "pages"}. Change its look in Theme settings.</p>
                    ) : (
                      <>
                        {(selKind?.settings ?? []).map((s) => (
                          <Field key={`${sel.id}/${s.id}`} s={s as Setting} value={(selected.settings ?? {})[s.id] ?? s.default} onChange={(v) => setSectionSetting(s.id, v)} storeId={L.store.id} categories={L.categories} />
                        ))}
                        {(selKind?.settings ?? []).length === 0 && <p className="ed-muted">Nothing to set here.</p>}
                      </>
                    )}
                  </div>
                  {selKind?.where !== "fixed" && (
                    <div className="ed-panel__foot">
                      <button type="button" className="ed-link ed-link--bad" onClick={() => remove(sel.group, sel.id)}><I n="trash" />Remove section</button>
                      <span className="ed-grow" />
                      <button type="button" className="ed-ib" onClick={() => duplicate(sel.group, sel.id)} title="Duplicate" aria-label="Duplicate"><I n="copy" /></button>
                      <button type="button" className="ed-ib" onClick={resetSection} title="Reset to original" aria-label="Reset to original"><I n="reset" /></button>
                    </div>
                  )}
                </>
              )}

              {tab === "settings" && (
                <>
                  <div className="ed-panel__head"><h2>Theme settings</h2></div>
                  <div className="ed-scroll">
                    {settingsGroups.map((g) => (
                      <div key={g.name} className="ed-acc">
                        <button type="button" onClick={() => setOpenGroup(openGroup === g.name ? null : g.name)} aria-expanded={openGroup === g.name}>
                          {g.name}<I n={openGroup === g.name ? "chevUp" : "chev"} />
                        </button>
                        {openGroup === g.name && (
                          <div className="ed-form ed-acc__body">
                            {g.settings.map((s) => <Field key={s.id} s={s} value={data.settings[s.id] ?? s.default} onChange={(v) => setThemeSetting(s.id, v)} storeId={L.store.id} categories={L.categories} />)}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </>
              )}
            </aside>
          </>
        )}

        {/* preview */}
        <main className="ed-canvas">
          {src ? (
            <div className={`ed-frame ${device === "mobile" ? "ed-frame--phone" : ""}`}>
              <iframe ref={frame} key={page} src={src} onLoad={onFrameLoad} title="Website preview" />
            </div>
          ) : (
            <div className="ed-muted" style={{ margin: "auto" }}>Nothing to preview for this page yet.</div>
          )}
        </main>
      </div>
    </div>
    </MenusCtx.Provider>
  );
}

// ---------- pieces ----------

const ICONS: Record<string, string> = {
  exit: "M9 4H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h4M13 14l4-4-4-4M17 10H8",
  back: "M12 15l-5-5 5-5",
  chev: "M6 8l4 4 4-4",
  chevUp: "M6 12l4-4 4 4",
  page: "M6 3h6l3 3v11H6zM12 3v3h3",
  desktop: "M3 4h14v9H3zM7 16h6M10 13v3",
  phone: "M7 2.5h6a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1v-13a1 1 0 0 1 1-1zM9.5 15h1",
  expand: "M4 8V4h4M16 8V4h-4M4 12v4h4M16 12v4h-4",
  undo: "M7 8H13a3.5 3.5 0 0 1 0 7H9M7 8l3-3M7 8l3 3",
  redo: "M13 8H7a3.5 3.5 0 0 0 0 7h4M13 8l-3-3M13 8l-3 3",
  eye: "M2.5 10s2.7-5 7.5-5 7.5 5 7.5 5-2.7 5-7.5 5-7.5-5-7.5-5zM10 12.2a2.2 2.2 0 1 0 0-4.4 2.2 2.2 0 0 0 0 4.4z",
  eyeOff: "M3 3l14 14M8.3 5.3A7.6 7.6 0 0 1 10 5c4.8 0 7.5 5 7.5 5a12 12 0 0 1-2 2.6M5.4 6.7C3.6 8 2.5 10 2.5 10s2.7 5 7.5 5c1.2 0 2.3-.3 3.2-.8M8.4 8.5a2.2 2.2 0 0 0 3.1 3.1",
  sections: "M3.5 3.5h13v4h-13zM3.5 10h13v6.5h-13z",
  brush: "M13.5 3.5l3 3-7 7-3-3zM6.5 10.5c-2 0-3 1.5-3 3s-.5 2.5-1 3c2.5 0 6-.5 6-3.5",
  plus: "M10 5v10M5 10h10",
  grip: "M7.5 5h.01M12.5 5h.01M7.5 10h.01M12.5 10h.01M7.5 15h.01M12.5 15h.01",
  trash: "M4 6h12M8 6V4h4v2M6 6l1 10h6l1-10",
  copy: "M7 7h9v9H7zM4 13V4h9",
  reset: "M4 10a6 6 0 1 0 2-4.5M4 4v3.5h3.5",
  up: "M10 15V5M6 9l4-4 4 4",
  down: "M10 5v10M6 11l4 4 4-4",
  x: "M5 5l10 10M15 5L5 15",
  upload: "M10 13V4M6 8l4-4 4 4M4 13v3h12v-3",
  header: "M3.5 4h13v4h-13z M3.5 11h13M3.5 14h9",
  footer: "M3.5 12h13v4h-13z M3.5 5h13M3.5 8h9",
  text: "M4 5h12M10 5v10M7 15h6",
  image: "M3.5 4.5h13v11h-13zM3.5 13l4-4 4 4 2-2 3 3M13 8h.01",
  video: "M3 5h10v10H3zM13 9l4-2.5v7L13 11",
  grid: "M4 4h5v5H4zM11 4h5v5h-5zM4 11h5v5H4zM11 11h5v5h-5z",
  star: "M10 3l2 4.4 4.7.5-3.5 3.2 1 4.6L10 13.3 5.8 15.7l1-4.6L3.3 7.9 8 7.4z",
  help: "M7.8 7.5a2.3 2.3 0 0 1 4.4.8c0 1.6-2.2 2-2.2 3.2M10 14.5h.01M10 17.5a7.5 7.5 0 1 0 0-15 7.5 7.5 0 0 0 0 15z",
  badge: "M10 2.5l2 2h3v3l2 2.5-2 2.5v3h-3l-2 2-2-2H5v-3L3 10l2-2.5v-3h3z",
  bag: "M5 7h10l-1 10H6zM7.5 7V6a2.5 2.5 0 0 1 5 0v1",
  layers: "M10 3l7 4-7 4-7-4zM3 11l7 4 7-4",
  announce: "M4 8v4h2l5 3V5L6 8zM14 8.5a2 2 0 0 1 0 3",
  code: "M7 6l-4 4 4 4M13 6l4 4-4 4M11 4l-2 12",
  columns: "M3.5 4.5h3.5v11H3.5zM8.25 4.5h3.5v11h-3.5zM13 4.5h3.5v11H13z",
  logos: "M3 7h4v6H3zM8 7h4v6H8zM13 7h4v6h-4z",
  spacer: "M3 6h14M3 14h14M10 8v4M8.5 9.5L10 8l1.5 1.5M8.5 10.5L10 12l1.5-1.5",
  search: "M9 15a6 6 0 1 0 0-12 6 6 0 0 0 0 12zM17 17l-3.5-3.5",
};
function I({ n }: { n: string }) {
  return <svg className="ed-i" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d={ICONS[n] ?? ICONS.sections} /></svg>;
}
const iconOf = (type: string) => ({
  header: "header", footer: "footer", announcement: "announce", hero: "image", "image-with-text": "image", "video-banner": "video",
  "product-grid": "grid", "collection-list": "grid", testimonials: "star", faq: "help", "trust-badges": "badge", "rich-text": "text",
  "custom-liquid": "code", multicolumn: "columns", "logo-list": "logos", spacer: "spacer",
} as Record<string, string>)[type] ?? (type.startsWith("main-") ? "bag" : "layers");

function SectionList({ group, title, list, kindOf, sel, onSelect, onToggle, onReorder, onAdd, adding, children }: {
  group: Group; title: string; list: ThemeTemplate; kindOf: (t: string) => Kind | undefined; sel: Sel; adding: boolean;
  onSelect: (id: string) => void; onToggle: (id: string) => void; onReorder: (id: string, to: number) => void; onAdd: () => void; children?: React.ReactNode;
}) {
  const [drag, setDrag] = useState<string | null>(null);
  const [over, setOver] = useState<number | null>(null);
  return (
    <section className="ed-group">
      <h3>{title}</h3>
      <ul onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setOver(null); }}>
        {list.order.map((id, i) => {
          const s = list.sections[id] as ThemeSection | undefined;
          if (!s) return null;
          const k = kindOf(s.type);
          const fixed = k?.where === "fixed";
          const hint = strip(String(s.settings?.heading ?? ""));
          return (
            <li key={id}
              className={`ed-row ${sel?.group === group && sel.id === id ? "on" : ""} ${s.disabled ? "off" : ""} ${over === i && drag && drag !== id ? "drop" : ""}`}
              draggable={!fixed}
              onDragStart={(e) => { setDrag(id); e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", id); }}
              onDragEnd={() => { setDrag(null); setOver(null); }}
              onDragOver={(e) => { if (drag) { e.preventDefault(); setOver(i); } }}
              onDrop={(e) => { e.preventDefault(); if (drag && drag !== id) onReorder(drag, i); setDrag(null); setOver(null); }}>
              <span className="ed-row__grip" aria-hidden>{!fixed && <I n="grip" />}</span>
              <button type="button" className="ed-row__main" onClick={() => onSelect(id)}>
                <I n={iconOf(s.type)} />
                <span className="ed-row__name">{k?.name ?? s.type}{hint && <em> · {hint}</em>}</span>
              </button>
              {!fixed && (
                <button type="button" className="ed-row__eye" onClick={() => onToggle(id)} aria-label={s.disabled ? "Show section" : "Hide section"} title={s.disabled ? "Show" : "Hide"}><I n={s.disabled ? "eyeOff" : "eye"} /></button>
              )}
            </li>
          );
        })}
      </ul>
      <button type="button" className={`ed-add ${adding ? "on" : ""}`} onClick={onAdd}><I n="plus" />Add section</button>
      {children}
    </section>
  );
}

/** The store's menus (Storefront → Menus), for "menu" settings. */
const MenusCtx = createContext<{ title: string; handle: string; where: string }[]>([]);

function Field({ s, value, onChange, storeId, categories }: { s: Setting; value: unknown; onChange: (v: unknown) => void; storeId: number; categories: { title: string; handle: string }[] }) {
  const id = `f-${s.id}-${useId().replace(/:/g, "")}`;
  const menus = useContext(MenusCtx);
  const label = <label htmlFor={id} className="ed-label">{s.label ?? s.id}</label>;
  const str = value == null ? "" : String(value);
  switch (s.type) {
    case "checkbox":
      return (
        <label className="ed-check">
          <input type="checkbox" checked={Boolean(value)} onChange={(e) => onChange(e.target.checked)} />
          <span className="ed-check__box" aria-hidden><svg viewBox="0 0 12 12"><path d="M2.5 6.2l2.2 2.2 4.8-4.8" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg></span>
          {s.label}
        </label>
      );
    case "textarea":
    case "richtext":
      return <div className="ed-f">{label}<textarea id={id} value={str} onChange={(e) => onChange(e.target.value)} rows={s.type === "richtext" ? 5 : 3} className="ed-input ed-input--area" />{s.type === "richtext" && <span className="ed-hint">Simple HTML works: &lt;p&gt;, &lt;b&gt;, &lt;a href&gt;</span>}</div>;
    case "color":
      return (
        <div className="ed-f ed-color">
          <label className="ed-swatch" style={{ background: /^#[0-9a-f]{3,8}$/i.test(str) ? str : "repeating-conic-gradient(#ddd 0 25%, #fff 0 50%) 0 0/10px 10px" }}>
            <input type="color" value={/^#[0-9a-f]{6}$/i.test(str) ? str : "#111827"} onChange={(e) => onChange(e.target.value)} aria-label={s.label} />
          </label>
          <span className="ed-color__text">
            <label htmlFor={id} className="ed-label ed-label--inline">{s.label}</label>
            <input id={id} value={str} onChange={(e) => onChange(e.target.value)} placeholder="Default" className="ed-plain" spellCheck={false} />
          </span>
        </div>
      );
    case "range": {
      const n = Number(value ?? s.default ?? s.min ?? 0);
      return (
        <div className="ed-f">{label}
          <div className="ed-range">
            <input id={id} type="range" min={s.min ?? 0} max={s.max ?? 100} step={s.step ?? 1} value={n} onChange={(e) => onChange(Number(e.target.value))} />
            <span className="ed-range__val">{n}<small>{s.unit ?? ""}</small></span>
          </div>
        </div>
      );
    }
    case "select":
      return <div className="ed-f">{label}<div className="ed-select"><select id={id} value={str} onChange={(e) => onChange(e.target.value)}>{(s.options ?? []).map((o, i) => <option key={o} value={o}>{s.option_labels?.[i] ?? o[0].toUpperCase() + o.slice(1)}</option>)}</select><I n="chev" /></div></div>;
    case "menu":
      return (
        <div className="ed-f">{label}
          <div className="ed-select"><select id={id} value={str} onChange={(e) => onChange(e.target.value)}>
            <option value="">{menus.find((m) => s.id === "menu" && m.where) ? "Default (set in Menus)" : "Default"}</option>
            {menus.map((m) => <option key={m.handle} value={m.handle}>{m.title}{m.where ? ` · ${m.where}` : ""}</option>)}
          </select><I n="chev" /></div>
          <span className="ed-hint">Make and edit menus in Storefront → <a href={`${storePath(storeId)}/menus`} target="_blank" rel="noreferrer" style={{ textDecoration: "underline" }}>Menus</a>.</span>
        </div>
      );
    case "liquid":
      return <CodeField id={id} label={s.label ?? "Code"} value={str} onChange={onChange} />;
    case "collection_optional":
      return <div className="ed-f">{label}<div className="ed-select"><select id={id} value={str} onChange={(e) => onChange(e.target.value)}><option value="">None</option><option value="all">All products</option>{categories.map((c) => <option key={c.handle} value={c.handle}>{c.title}</option>)}</select><I n="chev" /></div><span className="ed-hint">Loop over them with {"{% for p in products %}"}.</span></div>;
    case "collection":
      return <div className="ed-f">{label}<div className="ed-select"><select id={id} value={str} onChange={(e) => onChange(e.target.value)}><option value="">All products</option>{categories.map((c) => <option key={c.handle} value={c.handle}>{c.title}</option>)}</select><I n="chev" /></div></div>;
    case "image":
    case "video":
      return <MediaField id={id} s={s} value={str} onChange={onChange} storeId={storeId} />;
    case "list":
      return <ListField s={s} value={Array.isArray(value) ? (value as Record<string, unknown>[]) : []} onChange={onChange} storeId={storeId} categories={categories} />;
    case "url":
      return <div className="ed-f">{label}<input id={id} value={str} onChange={(e) => onChange(e.target.value)} placeholder="Paste a link or /products/all" className="ed-input" /></div>;
    default:
      return <div className="ed-f">{label}<input id={id} value={str} onChange={(e) => onChange(e.target.value)} className="ed-input" /></div>;
  }
}

/** What each section is for, so people can pick the right one. */
const SECTION_INFO: Record<string, { cat: "Content" | "Products" | "Media" | "Trust" | "Layout" | "Advanced"; text: string }> = {
  hero: { cat: "Media", text: "Big banner or slider with a heading and button" },
  "image-with-text": { cat: "Media", text: "An image next to a heading, text and button" },
  "video-banner": { cat: "Media", text: "Full-width video with text on top" },
  "logo-list": { cat: "Media", text: "Brand, press or partner logos in a row" },
  "product-grid": { cat: "Products", text: "Products from a category in a grid" },
  "collection-list": { cat: "Products", text: "Your categories as image tiles" },
  "rich-text": { cat: "Content", text: "A heading and a paragraph" },
  multicolumn: { cat: "Content", text: "2 to 4 columns with image, title and text" },
  faq: { cat: "Content", text: "Questions and answers that open and close" },
  testimonials: { cat: "Trust", text: "Customer reviews with stars" },
  "trust-badges": { cat: "Trust", text: "Delivery, COD, returns and secure payment icons" },
  spacer: { cat: "Layout", text: "Empty space or a line between sections" },
  "custom-liquid": { cat: "Advanced", text: "Your own Liquid, HTML, CSS or JavaScript" },
  announcement: { cat: "Content", text: "Thin bar with an offer or message" },
};
const CATS = ["Media", "Products", "Content", "Trust", "Layout", "Advanced"] as const;

function SectionPicker({ kinds, onPick, onClose }: { kinds: Kind[]; onPick: (type: string) => void; onClose: () => void }) {
  const [q, setQ] = useState("");
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    box.current?.querySelector("input")?.focus();
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [onClose]);
  const match = (k: Kind) => !q || `${k.name} ${SECTION_INFO[k.type]?.text ?? ""}`.toLowerCase().includes(q.toLowerCase());
  const list = kinds.filter(match);
  const groups = CATS.map((c) => ({ c, items: list.filter((k) => (SECTION_INFO[k.type]?.cat ?? "Content") === c) })).filter((g) => g.items.length);
  return (
    <div className="ed-pick" ref={box} role="dialog" aria-label="Add section">
      {kinds.length > 5 && (
        <label className="ed-pick__search"><I n="search" /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search sections" aria-label="Search sections" /></label>
      )}
      <div className="ed-pick__list">
        {groups.map((g) => (
          <div key={g.c}>
            {groups.length > 1 && <p className="ed-pick__cat">{g.c}</p>}
            {g.items.map((k) => (
              <button key={k.type} type="button" className="ed-pick__item" onClick={() => onPick(k.type)}>
                <span className="ed-pick__ic"><I n={iconOf(k.type)} /></span>
                <span><b>{k.name}</b>{SECTION_INFO[k.type] && <small>{SECTION_INFO[k.type].text}</small>}</span>
              </button>
            ))}
          </div>
        ))}
        {!list.length && <p className="ed-muted" style={{ padding: "10px 8px" }}>No section matches “{q}”.</p>}
      </div>
    </div>
  );
}

/** Ready-made code people can start from. Scripts run in a safe, separate frame automatically. */
const SNIPPETS: { name: string; code: string }[] = [
  { name: "WhatsApp chat button", code: `<a href="https://wa.me/91{{ shop.phone | remove: '+91' | remove: ' ' }}?text=Hi%20{{ shop.name | url_encode }}" target="_blank" class="btn btn--primary">
  Chat with us on WhatsApp
</a>` },
  { name: "Products from a category", code: `<h2>Bestsellers</h2>
<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:16px">
  {% for p in products %}
    <a href="{{ p.url }}" style="text-decoration:none;color:inherit">
      <img src="{{ p.featured_image | img_url: 400 }}" alt="{{ p.title | escape }}" style="width:100%;border-radius:12px">
      <p style="margin:8px 0 2px;font-weight:600">{{ p.title }}</p>
      <p style="margin:0">{{ p.price | money }}</p>
    </a>
  {% endfor %}
</div>` },
  { name: "Offer countdown (script)", code: `<div style="text-align:center;padding:16px;border-radius:12px;background:#111;color:#fff">
  <b>Sale ends in</b> <span id="t" style="font-variant-numeric:tabular-nums"></span>
</div>
<script>
  const end = new Date(Date.now() + 6 * 3600 * 1000);
  setInterval(() => {
    const s = Math.max(0, Math.floor((end - Date.now()) / 1000));
    document.getElementById("t").textContent =
      [s / 3600, (s % 3600) / 60, s % 60].map((n) => String(Math.floor(n)).padStart(2, "0")).join(":");
  }, 1000);
</script>` },
  { name: "YouTube video", code: `<div style="aspect-ratio:16/9;border-radius:12px;overflow:hidden">
  <iframe src="https://www.youtube.com/embed/VIDEO_ID" style="width:100%;height:100%;border:0" allowfullscreen></iframe>
</div>` },
  { name: "Google Map", code: `<iframe src="https://www.google.com/maps?q=Connaught+Place+New+Delhi&output=embed" style="width:100%;height:360px;border:0;border-radius:12px" loading="lazy"></iframe>` },
  { name: "Two buttons", code: `<div style="display:flex;gap:12px;justify-content:center;flex-wrap:wrap">
  <a href="{{ routes.all }}" class="btn btn--primary">Shop all</a>
  <a href="{{ routes.root }}" class="btn btn--ghost">Learn more</a>
</div>` },
];

function CodeField({ id, label, value, onChange }: { id: string; label: string; value: string; onChange: (v: unknown) => void }) {
  const [help, setHelp] = useState(false);
  const area = useRef<HTMLTextAreaElement>(null);
  const lines = Math.max(1, value.split("\n").length);
  const insert = (code: string) => {
    if (value.trim() && !confirm("Replace your code with this example?")) return;
    onChange(code);
  };
  const onKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key !== "Tab") return;
    e.preventDefault();
    const t = e.currentTarget, a = t.selectionStart, b = t.selectionEnd;
    const next = value.slice(0, a) + "  " + value.slice(b);
    onChange(next);
    requestAnimationFrame(() => { t.selectionStart = t.selectionEnd = a + 2; });
  };
  const usesScript = /<script\b|\son[a-z]+\s*=/i.test(value);
  const count = (re: RegExp) => (value.match(re) ?? []).length;
  const unclosed = count(/<script\b/gi) > count(/<\/script\s*>/gi) ? "<script>" : count(/<style\b/gi) > count(/<\/style\s*>/gi) ? "<style>" : "";
  return (
    <div className="ed-f">
      <span className="ed-code__head">
        <label htmlFor={id} className="ed-label">{label}</label>
        <span className="ed-code__tools">
        <button type="button" className="ed-link" onClick={(e) => (e.currentTarget.closest(".ed-panel") as HTMLElement | null)?.classList.toggle("ed-panel--wide")}>Wider</button>
        <span className="ed-select ed-select--sm">
          <select value="" onChange={(e) => { const sn = SNIPPETS.find((x) => x.name === e.target.value); if (sn) insert(sn.code); }} aria-label="Insert an example">
            <option value="">Examples</option>{SNIPPETS.map((x) => <option key={x.name}>{x.name}</option>)}
          </select><I n="chev" />
        </span>
        </span>
      </span>
      <div className="ed-code">
        <div className="ed-code__nums" aria-hidden>{Array.from({ length: lines }, (_, i) => <span key={i}>{i + 1}</span>)}</div>
        <textarea id={id} ref={area} value={value} onChange={(e) => onChange(e.target.value)} onKeyDown={onKey} spellCheck={false} autoCapitalize="off" autoComplete="off"
          wrap="off" rows={Math.min(24, Math.max(10, lines + 1))} placeholder={"<h2>{{ shop.name }}</h2>\n<p>Your own HTML, CSS and Liquid…</p>"} maxLength={50000} />
      </div>
      <span className="ed-hint">
        {unclosed && <b style={{ color: "#b42318", display: "block", marginBottom: 4 }}>A {unclosed} tag isn't closed. The code may have been cut off while pasting; paste it again in full.</b>}
        {value.length.toLocaleString("en-IN")} / 50,000 · {usesScript ? "Has a script: runs in a secure frame." : "HTML and CSS show directly on the page."}
        {" "}<button type="button" className="ed-link" onClick={() => setHelp((h) => !h)}>{help ? "Hide help" : "What can I use?"}</button>
      </span>
      {help && (
        <div className="ed-code__help">
          <p><b>Objects</b></p>
          <ul>
            <li><code>{"{{ shop.name }}"}</code>, <code>shop.phone</code>, <code>shop.logo</code>, <code>shop.brand_color</code></li>
            <li><code>{"{% for p in products %}"}</code>: pick a category below. Each has <code>p.title</code>, <code>p.url</code>, <code>p.price | money</code>, <code>p.featured_image</code></li>
            <li><code>product</code> on product pages, <code>collection</code> on category pages</li>
            <li><code>collections</code> (your categories), <code>pages</code>, <code>routes.all</code>, <code>routes.cart</code>, <code>settings</code></li>
          </ul>
          <p><b>Filters</b>: <code>money</code>, <code>img_url: 600</code>, <code>escape</code>, <code>upcase</code>, <code>date</code>, <code>truncate</code> and the usual Liquid ones.</p>
          <p><b>Safety</b>: plain HTML and CSS go straight into the page (unsafe bits removed). Code with <code>&lt;script&gt;</code> or <code>onclick</code> runs in its own secure frame that can't touch your store's data or cookies, and resizes itself. <code>include</code> and <code>render</code> aren't available.</p>
        </div>
      )}
    </div>
  );
}

function MediaField({ id, s, value, onChange, storeId }: { id: string; s: Setting; value: string; onChange: (v: unknown) => void; storeId: number }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const upload = async (f: File) => {
    setBusy(true); setErr(null);
    try {
      const r = await fetch(`${storePath(storeId)}/media`, { method: "POST", headers: { "Content-Type": f.type, "X-File-Name": encodeURIComponent(f.name) }, body: f });
      const j = await r.json();
      if (!r.ok || !j.url) throw new Error(j.error ?? "Upload failed");
      onChange(j.url);
    } catch (e) { setErr(e instanceof Error ? e.message : "Upload failed"); } finally { setBusy(false); }
  };
  const video = s.type === "video";
  return (
    <div className="ed-f">
      <span className="ed-label">{s.label}</span>
      {value ? (
        <div className="ed-media">
          {video ? <video src={value} muted loop autoPlay playsInline /> : <img src={value} alt="" />}
          <div className="ed-media__bar">
            <button type="button" onClick={() => input.current?.click()} disabled={busy}>{busy ? "Uploading…" : "Change"}</button>
            <button type="button" onClick={() => onChange("")}>Remove</button>
          </div>
        </div>
      ) : (
        <button type="button" className="ed-drop" onClick={() => input.current?.click()} disabled={busy}>
          <I n="upload" /><span>{busy ? "Uploading…" : `Select ${video ? "video" : "image"}`}</span>
        </button>
      )}
      <input id={id} ref={input} type="file" accept={video ? "video/mp4,video/webm,video/quicktime" : "image/*"} className="sr-only" onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f); e.target.value = ""; }} />
      {err && <span className="ed-hint ed-hint--bad">{err}</span>}
    </div>
  );
}

function ListField({ s, value, onChange, storeId, categories }: { s: Setting; value: Record<string, unknown>[]; onChange: (v: unknown) => void; storeId: number; categories: { title: string; handle: string }[] }) {
  const [open, setOpen] = useState<number | null>(null);
  const fields = s.fields ?? [];
  const set = (i: number, k: string, v: unknown) => onChange(value.map((x, j) => (j === i ? { ...x, [k]: v } : x)));
  const swap = (i: number, j: number) => { if (j < 0 || j >= value.length) return; const n = value.slice(); [n[i], n[j]] = [n[j], n[i]]; onChange(n); setOpen(j); };
  const title = (x: Record<string, unknown>) => {
    const f = fields[0];
    const v = String(x[f?.id ?? ""] ?? "");
    const i = f?.options?.indexOf(v) ?? -1;
    const name = i >= 0 && f?.option_labels?.[i] ? f.option_labels[i] : v;
    const extra = f?.type === "select" && fields[1] ? strip(String(x[fields[1].id] ?? "")).slice(0, 28) : "";
    return name ? <>{name}{extra && <em> · {extra}</em>}</> : "Untitled";
  };
  return (
    <div className="ed-f">
      <span className="ed-label">{(s.label ?? "").replace(/\s*\(.*\)$/, "")}</span>
      <ul className="ed-list">
        {value.map((x, i) => (
          <li key={i} className={open === i ? "open" : ""}>
            <div className="ed-list__row">
              <button type="button" className="ed-list__title" onClick={() => setOpen(open === i ? null : i)} aria-expanded={open === i}><I n={open === i ? "chevUp" : "chev"} /><span>{title(x)}</span></button>
              <span className="ed-list__acts">
                <button type="button" className="ed-ib ed-ib--sm" onClick={() => swap(i, i - 1)} disabled={i === 0} aria-label="Move up"><I n="up" /></button>
                <button type="button" className="ed-ib ed-ib--sm" onClick={() => swap(i, i + 1)} disabled={i === value.length - 1} aria-label="Move down"><I n="down" /></button>
                <button type="button" className="ed-ib ed-ib--sm" onClick={() => { onChange(value.filter((_, j) => j !== i)); setOpen(null); }} aria-label="Remove"><I n="x" /></button>
              </span>
            </div>
            {open === i && (
              <div className="ed-list__body">
                {fields.map((f) => <Field key={f.id} s={f} value={x[f.id] ?? f.default ?? (f.type === "range" ? f.max : "")} onChange={(v) => set(i, f.id, v)} storeId={storeId} categories={categories} />)}
              </div>
            )}
          </li>
        ))}
      </ul>
      {value.length < 20 && (
        <button type="button" className="ed-add" onClick={() => { const blank = Object.fromEntries(fields.map((f) => [f.id, f.type === "range" ? f.max ?? 5 : f.type === "select" ? f.options?.[0] ?? "" : ""])); onChange([...value, blank]); setOpen(value.length); }}>
          <I n="plus" />Add {String((s as { item_label?: string }).item_label ?? "item")}
        </button>
      )}
    </div>
  );
}

// Scoped styles: small, quiet, precise (13px UI, 30px controls, hairline borders).
const ED_CSS = `
.ed{position:fixed;inset:0;display:flex;flex-direction:column;background:#f1f1f1;color:#303030;font:13px/1.4 "Inter",ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;-webkit-font-smoothing:antialiased;letter-spacing:-.003em}
.ed *{box-sizing:border-box}
.ed button{font:inherit;color:inherit;background:none;border:0;cursor:pointer;padding:0}
.ed button:disabled{cursor:default;opacity:.35}
.ed .ed-btn--primary:disabled{opacity:1;background:#e3e3e3 !important;color:#8a8a8a !important;box-shadow:none}
.ed-i{width:16px;height:16px;flex:none}
.ed-top{height:48px;flex:none;display:flex;align-items:center;gap:8px;padding:0 12px 0 8px;background:#fff;border-bottom:1px solid #e3e3e3}
.ed-top__l,.ed-top__r{flex:1;display:flex;align-items:center;gap:4px;min-width:0}
.ed-top__r{justify-content:flex-end}
.ed-top__c{flex:none}
.ed-sep{width:1px;height:20px;background:#e3e3e3;margin:0 6px}
.ed-store{font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:200px}
.ed-pill{margin-left:6px;font-size:11.5px;font-weight:500;padding:1px 8px;border-radius:999px;white-space:nowrap}
.ed-pill--live{background:#cdfee1;color:#0c5132}
.ed-pill--draft{background:#ebebeb;color:#4a4a4a}
.ed-pill--err{background:#fee9e8;color:#8e1f0b}
.ed-ib{width:28px;height:28px;display:inline-flex;align-items:center;justify-content:center;border-radius:8px;color:#4a4a4a;flex:none}
.ed-ib:hover:not(:disabled){background:#f1f1f1;color:#303030}
.ed-ib--sm{width:24px;height:24px;border-radius:6px}
.ed-ib--sm .ed-i{width:14px;height:14px}
.ed-btn{height:28px;padding:0 12px;border-radius:8px;font-weight:600 !important;font-size:12.5px !important;display:inline-flex;align-items:center;gap:6px;margin-left:4px}
.ed-btn--primary{background:#303030 !important;color:#fff !important;box-shadow:inset 0 -1px 0 #000,inset 0 1px 0 rgba(255,255,255,.18)}
.ed-btn--primary:hover:not(:disabled){background:#1a1a1a !important}
.ed-pagepick{position:relative;display:flex;align-items:center;gap:6px;height:30px;padding:0 8px;border-radius:8px;color:#303030}
.ed-pagepick:hover{background:#f1f1f1}
.ed-pagepick select{appearance:none;border:0;background:transparent;font:inherit;font-weight:600;color:inherit;padding-right:2px;cursor:pointer;outline:0}
.ed-pagepick .ed-i:last-child{width:14px;height:14px;color:#8a8a8a}
.ed-seg{display:flex;gap:2px}
.ed-seg button{width:28px;height:28px;border-radius:8px;display:inline-flex;align-items:center;justify-content:center;color:#616161}
.ed-seg button:hover{background:#f1f1f1}
.ed-seg button.on{background:#ebebeb;color:#303030}
.ed-err{flex:none;padding:8px 14px;background:#fee9e8;color:#8e1f0b;font-size:12.5px}
.ed-err button{text-decoration:underline;margin-left:6px}
.ed-body{flex:1;min-height:0;display:flex}
.ed-rail{width:52px;flex:none;background:#fff;border-right:1px solid #ebebeb;display:flex;flex-direction:column;align-items:center;gap:4px;padding-top:8px}
.ed-rail button{width:36px;height:36px;border-radius:8px;display:flex;align-items:center;justify-content:center;color:#616161}
.ed-rail button:hover{background:#f1f1f1}
.ed-rail button.on{background:#ebebeb;color:#303030}
.ed-rail .ed-i{width:18px;height:18px}
.ed-panel{width:300px;flex:none;background:#fff;border-right:1px solid #e3e3e3;display:flex;flex-direction:column;min-height:0}
.ed-panel__head{height:48px;flex:none;display:flex;align-items:center;gap:4px;padding:0 8px 0 16px;border-bottom:1px solid #ebebeb}
.ed-panel__head .ed-ib:first-child{margin-left:-8px}
.ed-panel__head h2{flex:1;margin:0;font-size:13px;font-weight:650;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ed-panel__foot{flex:none;display:flex;align-items:center;gap:2px;padding:8px 8px 8px 12px;border-top:1px solid #ebebeb}
.ed-grow{flex:1}
.ed-scroll{flex:1;min-height:0;overflow-y:auto;padding:8px 8px 24px;scrollbar-width:thin}
.ed-group{padding:6px 0 10px;border-bottom:1px solid #f1f1f1}
.ed-group:last-of-type{border-bottom:0}
.ed-group h3{margin:4px 8px 4px;font-size:12px;font-weight:600;color:#303030}
.ed-group ul,.ed-list{list-style:none;margin:0;padding:0}
.ed-row{position:relative;display:flex;align-items:center;height:32px;border-radius:8px}
.ed-row:hover{background:#f6f6f6}
.ed-row.on{background:#ebebeb}
.ed-row.off .ed-row__main{color:#a0a0a0}
.ed-row.drop{box-shadow:inset 0 2px 0 #005bd3}
.ed-row__grip{width:16px;display:flex;justify-content:center;color:#b5b5b5;cursor:grab;opacity:0}
.ed-row:hover .ed-row__grip{opacity:1}
.ed-row__grip .ed-i{width:14px;height:14px;stroke-width:2.6}
.ed-row__main{flex:1;min-width:0;height:100%;display:flex;align-items:center;gap:8px;padding:0 4px;text-align:left;color:#303030}
.ed-row__main .ed-i{color:#8a8a8a}
.ed-row__name{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ed-row__name em,.ed-list__title em{font-style:normal;color:#8a8a8a}
.ed-row__eye{width:28px;height:28px;display:flex;align-items:center;justify-content:center;border-radius:6px;color:#8a8a8a;opacity:0}
.ed-row:hover .ed-row__eye,.ed-row.off .ed-row__eye{opacity:1}
.ed-row__eye:hover{background:#e3e3e3;color:#303030}
.ed-add{display:flex;align-items:center;gap:8px;height:32px;width:100%;padding:0 8px 0 20px;border-radius:8px;color:#005bd3 !important;font-weight:500}
.ed-add:hover,.ed-add.on{background:#f6f6f6}
.ed-pick{margin:6px 4px 0;border-radius:12px;background:#fff;box-shadow:0 0 0 1px rgba(0,0,0,.08),0 12px 28px -8px rgba(0,0,0,.25);overflow:hidden}
.ed-pick__search{display:flex;align-items:center;gap:6px;margin:6px;padding:0 8px;height:30px;border-radius:8px;box-shadow:inset 0 0 0 1px #e3e3e3;color:#8a8a8a}
.ed-pick__search:focus-within{box-shadow:inset 0 0 0 1.5px #005bd3}
.ed-pick__search input{flex:1;min-width:0;border:0;outline:0;background:none;font:inherit;color:#303030}
.ed-pick__list{max-height:min(60vh,460px);overflow-y:auto;padding:0 4px 4px}
.ed-pick__cat{margin:8px 8px 2px;font-size:11px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;color:#8a8a8a}
.ed-pick__item{display:flex !important;align-items:flex-start;gap:9px;width:100%;padding:6px 8px !important;border-radius:8px;text-align:left}
.ed-pick__item:hover,.ed-pick__item:focus-visible{background:#f1f1f1;outline:0}
.ed-pick__item b{display:block;font-weight:550}
.ed-pick__item small{display:block;color:#8a8a8a;font-size:12px;line-height:1.35}
.ed-pick__ic{flex:none;display:flex;align-items:center;justify-content:center;width:28px;height:28px;border-radius:7px;background:#f1f1f1;color:#4a4a4a}
.ed-panel.ed-panel--wide{width:min(620px,60vw)}
.ed-code__tools{display:flex;align-items:center;gap:10px}
.ed-code__head{display:flex;align-items:center;justify-content:space-between;gap:8px}
.ed-select--sm select{height:26px !important;font-size:12px !important}
.ed-code{display:flex;margin-top:4px;border-radius:8px;background:#1e1f22;box-shadow:inset 0 0 0 1px #2b2d31;overflow:hidden}
.ed-code:focus-within{box-shadow:0 0 0 2px #005bd3}
.ed-code__nums{flex:none;padding:8px 6px 8px 8px;text-align:right;color:#5c6370;font:12px/18px ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;user-select:none;background:#191a1d}
.ed-code__nums span{display:block}
.ed-code textarea{flex:1;min-width:0;padding:8px 10px;border:0;outline:0;resize:vertical;background:transparent;color:#e6e6e6;font:12px/18px ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;tab-size:2;white-space:pre;overflow:auto}
.ed-code textarea::placeholder{color:#5c6370}
.ed-code__help{margin-top:6px;padding:8px 10px;border-radius:8px;background:#f7f7f7;font-size:12px;line-height:1.5;color:#4a4a4a}
.ed-code__help p{margin:4px 0}
.ed-code__help ul{margin:2px 0 6px;padding-left:16px}
.ed-code__help code{padding:0 3px;border-radius:4px;background:#ebebeb;font:11.5px ui-monospace,SFMono-Regular,Menlo,monospace}
.ed-pop{margin:4px 4px 0;padding:4px;border-radius:10px;background:#fff;box-shadow:0 0 0 1px rgba(0,0,0,.08),0 8px 20px -6px rgba(0,0,0,.18)}
.ed-pop button{display:flex;align-items:center;gap:8px;width:100%;height:30px;padding:0 8px;border-radius:6px;text-align:left}
.ed-pop button:hover{background:#f1f1f1}
.ed-pop .ed-i{color:#8a8a8a}
.ed-note{margin:10px 8px 0;padding:8px 10px;border-radius:8px;background:#f6f6f6;color:#616161;font-size:12px}
.ed-muted{color:#616161;font-size:12.5px;margin:4px 8px}
.ed-form{display:flex;flex-direction:column;gap:14px;padding:16px}
.ed-scroll.ed-form{padding:16px 16px 32px}
.ed-f{display:flex;flex-direction:column;gap:4px;min-width:0}
.ed-label{font-size:12.5px;color:#303030;font-weight:450}
.ed-label--inline{display:block;line-height:1.2}
.ed-hint{font-size:11.5px;color:#8a8a8a}
.ed-hint--bad{color:#8e1f0b}
.ed-input{height:30px;width:100%;padding:0 10px;border:1px solid #d4d4d4;border-radius:8px;background:#fdfdfd;font:inherit;color:#303030;outline:0;transition:border-color .12s,box-shadow .12s}
.ed-input:hover{border-color:#b5b5b5}
.ed-input:focus,.ed-select select:focus{border-color:#005bd3;box-shadow:0 0 0 1px #005bd3;background:#fff}
.ed-input--area{height:auto;min-height:64px;padding:6px 10px;resize:vertical;line-height:1.45}
.ed-select{position:relative}
.ed-select select{appearance:none;height:30px;width:100%;padding:0 30px 0 10px;border:1px solid #d4d4d4;border-radius:8px;background:#fdfdfd;font:inherit;color:#303030;outline:0;cursor:pointer}
.ed-select .ed-i{position:absolute;right:8px;top:7px;width:14px;height:14px;color:#8a8a8a;pointer-events:none}
.ed-check{display:flex;align-items:center;gap:8px;cursor:pointer;font-size:12.5px;user-select:none}
.ed-check input{position:absolute;opacity:0;pointer-events:none}
.ed-check__box{width:16px;height:16px;flex:none;border-radius:4px;border:1px solid #8a8a8a;background:#fff;color:transparent;display:flex;align-items:center;justify-content:center}
.ed-check__box svg{width:12px;height:12px}
.ed-check input:checked+.ed-check__box{background:#303030;border-color:#303030;color:#fff}
.ed-check input:focus-visible+.ed-check__box{box-shadow:0 0 0 2px #fff,0 0 0 4px #005bd3}
.ed-color{flex-direction:row;align-items:center;gap:10px}
.ed-swatch{position:relative;width:30px;height:30px;flex:none;border-radius:8px;box-shadow:inset 0 0 0 1px rgba(0,0,0,.14);cursor:pointer;overflow:hidden}
.ed-swatch input{position:absolute;inset:0;opacity:0;cursor:pointer;width:100%;height:100%}
.ed-color__text{min-width:0;flex:1}
.ed-plain{border:0;padding:0;background:transparent;font:inherit;font-size:12px;color:#616161;width:100%;outline:0;font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
.ed-plain:focus{color:#303030}
.ed-range{display:flex;align-items:center;gap:10px}
.ed-range input{flex:1;accent-color:#303030;height:4px}
.ed-range__val{min-width:52px;height:28px;display:inline-flex;align-items:center;justify-content:flex-end;gap:1px;padding:0 8px;border:1px solid #d4d4d4;border-radius:8px;font-variant-numeric:tabular-nums;font-size:12.5px}
.ed-range__val small{color:#8a8a8a;font-size:11px}
.ed-drop{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;height:88px;width:100%;border:1px dashed #b5b5b5 !important;border-radius:8px;color:#616161 !important;background:#fafafa !important}
.ed-drop:hover{background:#f3f3f3 !important;border-color:#8a8a8a !important}
.ed-drop span{font-weight:500;font-size:12.5px;color:#303030}
.ed-media{border-radius:8px;overflow:hidden;box-shadow:inset 0 0 0 1px rgba(0,0,0,.1);background:repeating-conic-gradient(#f1f1f1 0 25%,#fafafa 0 50%) 0 0/14px 14px}
.ed-media img,.ed-media video{display:block;width:100%;height:120px;object-fit:contain}
.ed-media__bar{display:flex;border-top:1px solid #ebebeb;background:#fff}
.ed-media__bar button{flex:1;height:30px;font-size:12px;font-weight:500}
.ed-media__bar button+button{border-left:1px solid #ebebeb;color:#8e1f0b}
.ed-media__bar button:hover{background:#f6f6f6}
.ed-list{display:flex;flex-direction:column;border:1px solid #e3e3e3;border-radius:8px;overflow:hidden}
.ed-list li+li{border-top:1px solid #ebebeb}
.ed-list__row{display:flex;align-items:center;height:34px;padding-right:4px}
.ed-list__row:hover{background:#fafafa}
.ed-list__title{flex:1;min-width:0;height:100%;display:flex;align-items:center;gap:6px;padding:0 8px;text-align:left}
.ed-list__title span{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ed-list__title .ed-i{width:14px;height:14px;color:#8a8a8a}
.ed-list__acts{display:flex;opacity:0}
.ed-list__row:hover .ed-list__acts,.ed-list li.open .ed-list__acts{opacity:1}
.ed-list__body{display:flex;flex-direction:column;gap:12px;padding:10px 12px 14px;background:#fafafa;border-top:1px solid #ebebeb}
.ed-f .ed-add{padding-left:8px;margin-top:2px}
.ed-acc{border-bottom:1px solid #f1f1f1}
.ed-acc>button{display:flex;align-items:center;justify-content:space-between;width:100%;height:40px;padding:0 10px 0 8px;border-radius:8px;font-weight:550}
.ed-acc>button:hover{background:#f6f6f6}
.ed-acc>button .ed-i{width:14px;height:14px;color:#8a8a8a}
.ed-acc__body{padding:4px 8px 18px}
.ed-link{display:inline-flex;align-items:center;gap:6px;height:28px;padding:0 6px;border-radius:6px;font-size:12.5px;font-weight:500}
.ed-link--bad{color:#8e1f0b !important}
.ed-link--bad:hover{background:#fee9e8}
.ed-canvas{flex:1;min-width:0;display:flex;justify-content:center;padding:12px;overflow:auto}
.ed-frame{width:100%;height:100%;background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 0 0 1px rgba(0,0,0,.06),0 1px 2px rgba(0,0,0,.06),0 6px 16px -8px rgba(0,0,0,.12);transition:width .25s ease}
.ed-frame--phone{width:375px;border-radius:14px}
.ed-frame iframe{display:block;width:100%;height:100%;border:0}
@media (max-width:900px){.ed-panel{width:260px}.ed-store{max-width:110px}}
`;
