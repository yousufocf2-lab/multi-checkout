// Storefront → Menus: build the website's menus (Home, About, a category…) and choose which shows in the header and footer.
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { Form, Link, useActionData, useLoaderData, useNavigation, useSearchParams } from "@remix-run/react";
import { useEffect, useMemo, useState } from "react";
import { and, asc, eq } from "drizzle-orm";
import { Icon } from "~/components/Icons";
import { Notice } from "~/components/ui";
import { catalogCategories, catalogItems, db, storePages, type MenuItem } from "~/db.server";
import { requireStore, requireViewer } from "~/lib/auth.server";
import { catalogAllowed } from "~/lib/catalog.server";
import { deleteMenu, listMenus, saveMenu } from "~/lib/menus.server";
import { storePath } from "~/lib/store-code";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const viewer = await requireViewer(request);
  const store = await requireStore(viewer, params.id);
  if (!catalogAllowed(viewer, store)) throw redirect(storePath(store.id));
  const [menus, categories, pages, products] = await Promise.all([
    listMenus(store.id),
    db.select({ title: catalogCategories.title, handle: catalogCategories.handle }).from(catalogCategories).where(eq(catalogCategories.storeId, store.id)).orderBy(asc(catalogCategories.title)),
    db.select({ title: storePages.title, handle: storePages.handle }).from(storePages).where(eq(storePages.storeId, store.id)).orderBy(asc(storePages.title)),
    db.select({ title: catalogItems.title, handle: catalogItems.handle }).from(catalogItems).where(and(eq(catalogItems.storeId, store.id), eq(catalogItems.status, "active"))).orderBy(asc(catalogItems.title)).limit(1000),
  ]);
  return json({
    base: storePath(store.id),
    menus: menus.map((m) => ({ id: m.id, title: m.title, handle: m.handle, items: m.items, inHeader: m.inHeader, inFooter: m.inFooter, updatedAt: m.updatedAt.toISOString() })),
    categories, pages, products,
  });
}

export async function action({ request, params }: ActionFunctionArgs) {
  const viewer = await requireViewer(request);
  const store = await requireStore(viewer, params.id);
  if (!catalogAllowed(viewer, store)) return json({ ok: null, error: "Not allowed" }, { status: 403 });
  const fd = await request.formData();
  const intent = String(fd.get("intent"));
  if (intent === "delete") {
    await deleteMenu(store.id, Number(fd.get("id")));
    return redirect(`${storePath(store.id)}/menus`);
  }
  if (intent === "save") {
    let items: unknown = [];
    try { items = JSON.parse(String(fd.get("items") ?? "[]")); } catch { /* keep empty */ }
    const r = await saveMenu(store.id, { id: Number(fd.get("id")) || undefined, title: String(fd.get("title") ?? ""), items, inHeader: fd.get("inHeader") === "on", inFooter: fd.get("inFooter") === "on" });
    if ("error" in r) return json({ ok: null, error: r.error });
    return redirect(`${storePath(store.id)}/menus?menu=${r.id}&saved=1`);
  }
  return json({ ok: null, error: "Unknown action" }, { status: 400 });
}

type D = ReturnType<typeof useLoaderData<typeof loader>>;
type Row = { id: string; title: string; kind: MenuItem["kind"]; ref: string; url: string; depth: 0 | 1 };
const KIND_LABEL: Record<MenuItem["kind"], string> = { home: "Home page", all: "All products", category: "Category", product: "Product", page: "Site page", url: "Custom link" };

const flatten = (items: MenuItem[]): Row[] => items.flatMap((i) => [
  { id: i.id, title: i.title, kind: i.kind, ref: i.ref ?? "", url: i.url ?? "", depth: 0 as const },
  ...(i.children ?? []).map((c) => ({ id: c.id, title: c.title, kind: c.kind, ref: c.ref ?? "", url: c.url ?? "", depth: 1 as const })),
]);
function nest(rows: Row[]): MenuItem[] {
  const out: MenuItem[] = [];
  for (const r of rows) {
    const item: MenuItem = { id: r.id, title: r.title.trim(), kind: r.kind, ...(r.ref ? { ref: r.ref } : {}), ...(r.kind === "url" ? { url: r.url } : {}) };
    if (r.depth === 1 && out.length) (out[out.length - 1].children ??= []).push(item);
    else out.push(item);
  }
  return out;
}
const rid = () => Math.random().toString(36).slice(2, 10);

export default function Menus() {
  const d = useLoaderData<typeof loader>();
  const [params] = useSearchParams();
  const sel = params.get("menu");
  const menu = sel === "new" ? null : d.menus.find((m) => String(m.id) === sel);
  if (sel === "new" || menu) return <MenuEditor key={sel} d={d} menu={menu ?? null} />;
  return (
    <div className="mx-auto max-w-3xl space-y-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-[13px] text-ink-soft">Menus are the links in your website's header and footer. Choose where each one shows; change their look in the theme editor (Header / Footer).</p>
        <Link to="?menu=new" className="btn-primary btn h-8 shrink-0"><Icon name="plus" className="h-3.5 w-3.5" />Create menu</Link>
      </div>
      <ul className="panel divide-y divide-rule overflow-hidden p-0">
        {d.menus.map((m) => (
          <li key={m.id}>
            <Link to={`?menu=${m.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-black/[.02]">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-pine-tint text-pine"><Icon name="menu" className="h-4 w-4" /></span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2"><b className="text-[13.5px] font-semibold">{m.title}</b>
                  {m.inHeader && <span className="rounded-md bg-[#e3f1ea] px-1.5 py-px text-[11px] font-medium text-[#1f6f4a]">Header</span>}
                  {m.inFooter && <span className="rounded-md bg-[#eef0fe] px-1.5 py-px text-[11px] font-medium text-[#3442b8]">Footer</span>}
                </span>
                <span className="block truncate text-[12px] text-ink-faint">{m.items.length ? m.items.map((i) => i.title).join(" · ") : "No links yet"}</span>
              </span>
              <Icon name="chevron" className="h-4 w-4 shrink-0 -rotate-90 text-ink-faint" />
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

function MenuEditor({ d, menu }: { d: D; menu: D["menus"][number] | null }) {
  const nav = useNavigation();
  const res = useActionData<typeof action>();
  const [params] = useSearchParams();
  const [title, setTitle] = useState(menu?.title ?? "");
  const [rows, setRows] = useState<Row[]>(() => flatten((menu?.items ?? []) as MenuItem[]));
  const [inHeader, setInHeader] = useState(menu?.inHeader ?? false);
  const [inFooter, setInFooter] = useState(menu?.inFooter ?? false);
  const [confirmDel, setConfirmDel] = useState(false);
  const busy = nav.state !== "idle";
  const json = useMemo(() => JSON.stringify(nest(rows.filter((r) => r.title.trim()))), [rows]);
  const set = (i: number, patch: Partial<Row>) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const move = (i: number, step: -1 | 1) => setRows((rs) => {
    const j = i + step; if (j < 0 || j >= rs.length) return rs;
    const n = rs.slice(); [n[i], n[j]] = [n[j], n[i]];
    if (n[0].depth === 1) n[0] = { ...n[0], depth: 0 };
    return n;
  });
  const add = () => setRows((rs) => [...rs, { id: rid(), title: "", kind: "category", ref: d.categories[0]?.handle ?? "", url: "", depth: 0 }]);
  useEffect(() => { if (!menu && !rows.length) add(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const other = (where: "inHeader" | "inFooter") => d.menus.find((m) => m[where] && m.id !== menu?.id);

  return (
    <div className="mx-auto max-w-3xl space-y-3">
      <Link to="?" className="inline-flex items-center gap-1 text-[13px] font-medium text-ink-soft hover:text-ink"><Icon name="chevron" className="h-4 w-4 rotate-90" />All menus</Link>
      {params.get("saved") && !res && <Notice tone="success">Menu saved. It shows on your website right away.</Notice>}
      {res?.error && <Notice tone="error">{res.error}</Notice>}
      <Form method="post" className="space-y-3">
        <input type="hidden" name="intent" value="save" />
        {menu && <input type="hidden" name="id" value={menu.id} />}
        <input type="hidden" name="items" value={json} />
        <section className="panel space-y-3 p-4">
          <label className="block"><span className="label">Menu name</span><input name="title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Main menu" maxLength={60} className="input mt-1" required /></label>
          <div>
            <span className="label">Show on the website</span>
            <div className="mt-1.5 flex flex-wrap gap-2">
              {([["inHeader", "Header", inHeader, setInHeader], ["inFooter", "Footer", inFooter, setInFooter]] as const).map(([name, label, on, setOn]) => (
                <label key={name} className={`flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-[13px] font-medium transition ${on ? "bg-pine-tint/60 shadow-[inset_0_0_0_1.5px_#0B5D4B]" : "shadow-[inset_0_0_0_1px_#e3e3e3]"}`}>
                  <input type="checkbox" name={name} checked={on} onChange={(e) => setOn(e.target.checked)} className="h-4 w-4 accent-[#0B5D4B]" />{label}
                  {!on && other(name) && <span className="text-[11.5px] font-normal text-ink-faint">(now: {other(name)!.title})</span>}
                </label>
              ))}
            </div>
          </div>
        </section>

        <section className="panel overflow-hidden p-0">
          <div className="flex items-center justify-between border-b border-rule px-4 py-2.5">
            <h2 className="text-[14px] font-semibold">Menu items</h2>
            <span className="text-[11.5px] text-ink-faint">Use → to put an item under the one above it (a dropdown in the header)</span>
          </div>
          <ul className="divide-y divide-rule">
            {rows.map((r, i) => (
              <li key={r.id} className={`flex flex-wrap items-center gap-2 px-3 py-2.5 sm:flex-nowrap ${r.depth ? "bg-[#fafafa] pl-8 sm:pl-10" : ""}`}>
                {r.depth === 1 && <span className="hidden text-ink-faint sm:inline">↳</span>}
                <input value={r.title} onChange={(e) => set(i, { title: e.target.value })} placeholder="Label, e.g. About us" maxLength={60} aria-label="Label" className="input h-8 min-w-0 flex-1 text-[13px] sm:max-w-[200px]" />
                <select value={r.kind} onChange={(e) => {
                  const kind = e.target.value as Row["kind"];
                  const first = kind === "category" ? d.categories[0]?.handle : kind === "page" ? d.pages[0]?.handle : kind === "product" ? d.products[0]?.handle : "";
                  const auto = !r.title.trim() ? (kind === "home" ? "Home" : kind === "all" ? "Shop all" : "") : r.title;
                  set(i, { kind, ref: first ?? "", title: auto });
                }} aria-label="Link to" className="input h-8 w-[130px] text-[13px]">
                  {(Object.keys(KIND_LABEL) as Row["kind"][]).map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
                </select>
                {r.kind === "url" ? <input value={r.url} onChange={(e) => set(i, { url: e.target.value })} placeholder="https://… or /pages/about" aria-label="Link" className="input h-8 min-w-0 flex-1 text-[13px]" />
                  : ["category", "page", "product"].includes(r.kind) ? (
                    <select value={r.ref} onChange={(e) => { const list = r.kind === "category" ? d.categories : r.kind === "page" ? d.pages : d.products; const t = list.find((x) => x.handle === e.target.value)?.title ?? ""; set(i, { ref: e.target.value, title: r.title.trim() ? r.title : t.slice(0, 60) }); }}
                      aria-label={KIND_LABEL[r.kind]} className="input h-8 min-w-0 flex-1 text-[13px]">
                      {(r.kind === "category" ? d.categories : r.kind === "page" ? d.pages : d.products).map((x) => <option key={x.handle} value={x.handle}>{x.title}</option>)}
                      {!(r.kind === "category" ? d.categories : r.kind === "page" ? d.pages : d.products).length && <option value="">None yet</option>}
                    </select>
                  ) : <span className="min-w-0 flex-1 text-[12.5px] text-ink-faint">{r.kind === "home" ? "Opens your home page" : "Opens all products"}</span>}
                <span className="flex shrink-0 items-center">
                  <button type="button" onClick={() => set(i, { depth: r.depth ? 0 : 1 })} disabled={i === 0 && !r.depth} title={r.depth ? "Move out (top level)" : "Put under the item above"} className="flex h-7 w-7 items-center justify-center rounded-md text-ink-soft hover:bg-black/5 disabled:opacity-30">{r.depth ? "←" : "→"}</button>
                  <button type="button" onClick={() => move(i, -1)} disabled={i === 0} aria-label="Move up" className="flex h-7 w-7 items-center justify-center rounded-md text-ink-soft hover:bg-black/5 disabled:opacity-30"><Icon name="chevron" className="h-3.5 w-3.5 rotate-180" /></button>
                  <button type="button" onClick={() => move(i, 1)} disabled={i === rows.length - 1} aria-label="Move down" className="flex h-7 w-7 items-center justify-center rounded-md text-ink-soft hover:bg-black/5 disabled:opacity-30"><Icon name="chevron" className="h-3.5 w-3.5" /></button>
                  <button type="button" onClick={() => setRows((rs) => rs.filter((_, j) => j !== i).map((x, j) => (j === 0 ? { ...x, depth: 0 } : x)))} aria-label="Remove" className="flex h-7 w-7 items-center justify-center rounded-md text-bad hover:bg-red-50"><Icon name="close" className="h-3.5 w-3.5" /></button>
                </span>
              </li>
            ))}
          </ul>
          {rows.length < 40 && <button type="button" onClick={add} className="flex w-full items-center gap-1.5 border-t border-rule px-4 py-2.5 text-[13px] font-medium text-[#005bd3] hover:bg-black/[.02]"><Icon name="plus" className="h-3.5 w-3.5" />Add menu item</button>}
        </section>

        <div className="flex items-center justify-between gap-2">
          {menu ? <button type="button" onClick={() => setConfirmDel(true)} className="btn h-8 text-bad hover:bg-red-50"><Icon name="trash" className="h-3.5 w-3.5" />Delete menu</button> : <span />}
          <button type="submit" className="btn-primary btn h-9 px-5" disabled={busy || !title.trim()}>{busy ? "Saving…" : "Save menu"}</button>
        </div>
      </Form>
      {confirmDel && menu && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/30 p-4" onClick={() => setConfirmDel(false)}>
          <Form method="post" className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <input type="hidden" name="intent" value="delete" /><input type="hidden" name="id" value={menu.id} />
            <h3 className="text-[15px] font-semibold">Delete “{menu.title}”?</h3>
            <p className="mt-1 text-[13px] text-ink-soft">{menu.inHeader || menu.inFooter ? "Your website then shows its default links there." : "This can't be undone."}</p>
            <div className="mt-4 flex justify-end gap-2"><button type="button" className="btn-secondary btn" onClick={() => setConfirmDel(false)}>Cancel</button><button type="submit" className="btn btn-primary !bg-[#c5280c]">Delete</button></div>
          </Form>
        </div>
      )}
    </div>
  );
}
