// Growpefy Store → Products (Menu / Courses / Rooms … by business type): list with views, search, filters, sorting and bulk actions.
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Form, Link, useActionData, useLoaderData, useNavigation, useSearchParams, useSubmit } from "@remix-run/react";
import { useEffect, useMemo, useState } from "react";
import { Icon } from "~/components/Icons";
import { LearnMore, Notice } from "~/components/ui";
import { requireStore, requireViewer } from "~/lib/auth.server";
import { packOf } from "~/lib/business-types";
import {
  catalogAllowed, catalogFacets, catalogStats, countByStatus, deleteItems, importFromShopify, listCategories, listItems, setItemsStatus,
  type ItemSort, type ItemStatus, type StockFilter,
} from "~/lib/catalog.server";
import { importShopifyProductsCsv } from "~/lib/catalog-csv.server";
import { formatINR } from "~/lib/pricing";
import { storePath } from "~/lib/store-code";

const STATUSES = ["all", "active", "draft", "archived"] as const;
const SORTS: { v: ItemSort; label: string }[] = [
  { v: "newest", label: "Newest first" }, { v: "oldest", label: "Oldest first" }, { v: "updated", label: "Recently updated" },
  { v: "title", label: "Title A–Z" }, { v: "price_asc", label: "Price: low to high" }, { v: "price_desc", label: "Price: high to low" }, { v: "stock_asc", label: "Lowest stock" },
];
const STOCKS: { v: StockFilter; label: string }[] = [{ v: "in", label: "In stock" }, { v: "low", label: "Low stock (1–5)" }, { v: "out", label: "Out of stock" }, { v: "untracked", label: "Not tracked" }];
const imports = new Map<number, { startedAt: number; done?: { items: number; variants: number; categories: number }; error?: string }>();

export async function loader({ request, params }: LoaderFunctionArgs) {
  const viewer = await requireViewer(request);
  const store = await requireStore(viewer, params.id);
  if (!catalogAllowed(viewer, store)) throw new Response("Not found", { status: 404 });
  const sp = new URL(request.url).searchParams;
  const pick = <T extends string>(k: string, list: readonly T[]) => ((list as readonly string[]).includes(sp.get(k) ?? "") ? (sp.get(k) as T) : null);
  const status = pick("status", STATUSES) ?? "all";
  const sort = pick("sort", SORTS.map((s) => s.v)) ?? "newest";
  const stock = pick("stock", STOCKS.map((s) => s.v));
  const opts = { q: sp.get("q") ?? "", status: status as ItemStatus | "all", category: Number(sp.get("cat")) || null, type: sp.get("type") || null, vendor: sp.get("vendor") || null, stock, sort };
  const [items, counts, categories, stats, facets] = await Promise.all([
    listItems(store.id, opts), countByStatus(store.id), listCategories(store.id), catalogStats(store.id), catalogFacets(store.id),
  ]);
  const imp = imports.get(store.id);
  return json({
    store: { id: store.id, slug: store.slug, shopify: store.platform === "shopify" && Boolean(store.adminToken || store.clientId) },
    pack: packOf(store.businessType), counts, categories, stats, facets,
    items: items.map((i) => ({ ...i, createdAt: i.createdAt.toISOString(), updatedAt: i.updatedAt.toISOString() })),
    importing: imp && !imp.done && !imp.error ? Math.round((Date.now() - imp.startedAt) / 1000) : null,
    lastImport: imp?.done ?? null, importError: imp?.error ?? null,
  });
}

export async function action({ request, params }: ActionFunctionArgs) {
  const viewer = await requireViewer(request);
  const store = await requireStore(viewer, params.id);
  if (!catalogAllowed(viewer, store)) throw new Response("Not found", { status: 404 });
  const fd = await request.formData();
  const ids = String(fd.get("ids") ?? "").split(",").map(Number).filter(Boolean);
  try {
    switch (fd.get("intent")) {
      case "import": {
        const running = imports.get(store.id);
        if (running && !running.done && !running.error) return json({ ok: "Import is already running.", error: null });
        const job: { startedAt: number; done?: { items: number; variants: number; categories: number }; error?: string } = { startedAt: Date.now() };
        imports.set(store.id, job);
        importFromShopify(store).then((r) => { job.done = r; }).catch((e) => { job.error = e instanceof Error ? e.message : "Import failed"; console.error("[catalog-import]", store.id, e); });
        return json({ ok: "Import started. Products appear here as they come in.", error: null });
      }
      case "import_csv": {
        const file = fd.get("file");
        if (!(file instanceof File) || !file.size) return json({ ok: null, error: "Choose a Shopify products CSV file first." }, { status: 400 });
        if (file.size > 15 * 1024 * 1024) return json({ ok: null, error: "CSV file must be smaller than 15 MB." }, { status: 400 });
        const result = await importShopifyProductsCsv(store, await file.text());
        return json({ ok: `Imported ${result.created} new products and updated ${result.updated} existing Shopify products (${result.variants} variants).`, error: null });
      }
      case "status": {
        const to = String(fd.get("to")) as ItemStatus;
        if (!["active", "draft", "archived"].includes(to)) break;
        await setItemsStatus(store.id, ids, to);
        return json({ ok: `${ids.length} updated.`, error: null });
      }
      case "delete":
        await deleteItems(store.id, ids);
        return json({ ok: `${ids.length} deleted.`, error: null });
    }
  } catch (e) {
    return json({ ok: null, error: e instanceof Error ? e.message : "Something went wrong" }, { status: 400 });
  }
  return json({ ok: null, error: null });
}

const price = (min: number | null, max: number | null) => (min == null ? "—" : min === max ? formatINR(min) : `${formatINR(min)} – ${formatINR(max ?? min)}`);
const PILL: Record<string, string> = { active: "bg-[#cdfee1] text-[#0c5132]", draft: "bg-[#e0f0ff] text-[#00527c]", archived: "bg-paper-sunk text-ink-soft" };

export default function Catalog() {
  const { store, pack, counts, categories, stats, facets, items, importing, lastImport, importError } = useLoaderData<typeof loader>();
  const a = useActionData<typeof action>();
  const [sp, setSp] = useSearchParams();
  const submit = useSubmit();
  const busy = useNavigation().state !== "idle";
  const [sel, setSel] = useState<number[]>([]);
  const [q, setQ] = useState(sp.get("q") ?? "");
  const status = sp.get("status") ?? "all";
  const colWord = pack.categories === "Categories" ? "Collection" : pack.categories.replace(/s$/, "");
  const colsWord = pack.categories === "Categories" ? "Collections" : pack.categories;
  const base = storePath(store.id);

  useEffect(() => setSel([]), [sp]);
  useEffect(() => {
    const t = setTimeout(() => { if ((sp.get("q") ?? "") !== q) set("q", q); }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);
  function set(k: string, v: string | null) {
    const n = new URLSearchParams(sp);
    if (v) n.set(k, v); else n.delete(k);
    setSp(n, { replace: true, preventScrollReset: true });
  }
  const bulk = (intent: string, extra: Record<string, string> = {}) => submit({ intent, ids: sel.join(","), ...extra }, { method: "post", preventScrollReset: true });
  const allOn = items.length > 0 && sel.length === items.length;
  const filters = [
    sp.get("cat") && { k: "cat", label: `${colWord}: ${categories.find((c) => String(c.id) === sp.get("cat"))?.title ?? "?"}` },
    sp.get("type") && { k: "type", label: `Type: ${sp.get("type")}` },
    sp.get("vendor") && { k: "vendor", label: `Brand: ${sp.get("vendor")}` },
    sp.get("stock") && { k: "stock", label: STOCKS.find((s) => s.v === sp.get("stock"))?.label ?? "" },
  ].filter(Boolean) as { k: string; label: string }[];

  const empty = counts.all === 0;

  return (
    <div className="space-y-4">
      <div className="flex min-h-[32px] flex-wrap items-center gap-2">
        <Icon name="tag" className="h-4 w-4" strokeWidth={1.9} />
        <h1 className="flex-1 text-[15px] font-semibold">{pack.items}</h1>
        <LearnMore topic="catalog" />
        <details className="group relative">
          <summary className="btn-secondary cursor-pointer list-none select-none hover:bg-paper-sunk [&::-webkit-details-marker]:hidden">Product tools <span aria-hidden="true">⌄</span></summary>
          <div className="absolute right-0 z-30 mt-1.5 min-w-[210px] rounded-xl border border-rule bg-paper p-1.5 shadow-xl">
            <Link to={`${base}/reviews`} className="block rounded-lg px-3 py-2 text-left text-[12.5px] hover:bg-paper-sunk">Manage reviews</Link>
            {!empty && <a href={`${base}/catalog/export.csv`} className="block rounded-lg px-3 py-2 text-left text-[12.5px] hover:bg-paper-sunk">Export products CSV</a>}
            <Form method="post" encType="multipart/form-data" onSubmit={(e) => { if (!confirm("Matching Shopify-imported products will be updated. Continue?")) e.preventDefault(); }}>
              <input type="hidden" name="intent" value="import_csv" />
              <label className="block cursor-pointer rounded-lg px-3 py-2 text-[12.5px] hover:bg-paper-sunk">Import products CSV<input type="file" name="file" accept=".csv,text/csv" required className="sr-only" aria-label="Choose Shopify products CSV" onChange={(e) => { if (e.currentTarget.files?.length) e.currentTarget.form?.requestSubmit(); }} /></label>
            </Form>
            {store.shopify && <Form method="post"><input type="hidden" name="intent" value="import" /><button className="block w-full rounded-lg px-3 py-2 text-left text-[12.5px] hover:bg-paper-sunk" disabled={busy}>Import from Shopify</button></Form>}
          </div>
        </details>
        <a href={`/s/${store.slug}`} target="_blank" rel="noreferrer" className="btn-secondary"><Icon name="eye" className="h-4 w-4" />View store</a>
        <Link to="new" className="btn-primary">Add {pack.item}</Link>
      </div>

      {sp.get("welcome") === "1" && <Notice tone="success">Your store is ready. Add your first {pack.item}, then set up payments and connect your domain.</Notice>}
      {a?.ok && <Notice tone="success">{a.ok}</Notice>}
      {a?.error && <Notice tone="error">{a.error}</Notice>}
      {importing != null && <Notice tone="info">Importing from Shopify… ({importing}s). Refresh to see new {pack.items.toLowerCase()}.</Notice>}
      {importError && <Notice tone="error">Shopify import stopped: {importError}</Notice>}
      {lastImport && importing == null && <Notice tone="success">Imported {lastImport.items} {pack.items.toLowerCase()}, {lastImport.variants} variants and {lastImport.categories} categories.</Notice>}

      {empty ? (
        <section className="panel flex flex-col items-center px-6 py-14 text-center">
          <span className="flex h-20 w-20 items-center justify-center rounded-full bg-paper-sunk"><Icon name="tag" className="h-9 w-9 text-ink-soft" strokeWidth={1.4} /></span>
          <h2 className="mt-5 text-[15px] font-semibold">Add your {pack.items.toLowerCase()}</h2>
          <p className="mt-1 max-w-md text-[13px] text-ink-soft">Start stocking your store with {pack.items.toLowerCase()} your customers will love.</p>
          <div className="mt-5 flex gap-2"><Link to="new" className="btn-primary"><Icon name="plus" className="h-4 w-4" />Add {pack.item}</Link>{store.shopify && <Form method="post"><input type="hidden" name="intent" value="import" /><button className="btn-secondary">Import from Shopify</button></Form>}</div>
        </section>
      ) : (
        <>
          <section className="panel grid grid-cols-2 divide-rule overflow-hidden sm:grid-cols-4 sm:divide-x">
            {[
              { label: "Active", value: String(stats.active), hint: `of ${counts.all}`, to: "active", k: "status" },
              { label: "Low stock", value: String(stats.low), hint: "1–5 left", to: "low", k: "stock", warn: stats.low > 0 },
              { label: "Out of stock", value: String(stats.out), hint: "need restock", to: "out", k: "stock", bad: stats.out > 0 },
              { label: "Inventory value", value: formatINR(stats.value), hint: "at selling price" },
            ].map((s) => {
              const inner = (
                <>
                  <p className="text-[12px] font-medium text-ink-soft underline decoration-dotted decoration-ink-faint underline-offset-4">{s.label}</p>
                  <p className={`num mt-1 text-[17px] font-semibold ${s.bad ? "text-[#8e1f0b]" : s.warn ? "text-[#8a6100]" : ""}`}>{s.value} <span className="text-[11.5px] font-normal text-ink-faint">{s.hint}</span></p>
                </>
              );
              return s.k
                ? <button key={s.label} type="button" onClick={() => set(s.k!, sp.get(s.k!) === s.to ? null : s.to!)} className="px-4 py-3 text-left hover:bg-paper">{inner}</button>
                : <div key={s.label} className="px-4 py-3">{inner}</div>;
            })}
          </section>

          <section className="panel overflow-hidden">
            <div className="flex flex-wrap items-center gap-1 border-b border-rule px-2 py-1.5">
              {STATUSES.map((s) => (
                <button key={s} type="button" onClick={() => set("status", s === "all" ? null : s)}
                  className={`h-7 rounded-lg px-2.5 text-[12.5px] font-medium ${status === s ? "bg-paper-sunk text-ink" : "text-ink-soft hover:bg-paper"}`}>
                  {s[0].toUpperCase() + s.slice(1)} <span className="text-ink-faint">{counts[s]}</span>
                </button>
              ))}
              <span className="ml-auto flex items-center gap-1">
                <Chip label="Sort" value={sp.get("sort") ?? "newest"} options={SORTS.map((s) => ({ v: s.v, label: s.label }))} onChange={(v) => set("sort", v === "newest" ? null : v)} keep />
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-1.5 border-b border-rule px-2 py-1.5">
              <label className="flex h-8 min-w-[220px] flex-1 items-center gap-2 rounded-lg px-2 text-ink-faint shadow-[inset_0_0_0_1px_rgb(var(--rule))] focus-within:shadow-[inset_0_0_0_2px_#005bd3]">
                <Icon name="search" className="h-4 w-4" />
                <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by title, SKU, tag or brand" className="min-w-0 flex-1 border-0 bg-transparent text-[13px] text-ink outline-none" aria-label="Search products" />
                {q && <button type="button" onClick={() => setQ("")} aria-label="Clear search"><Icon name="close" className="h-3.5 w-3.5" /></button>}
              </label>
              {categories.length > 0 && <Chip label={colWord} value={sp.get("cat") ?? ""} options={categories.map((c) => ({ v: String(c.id), label: `${c.title} (${c.items})` }))} onChange={(v) => set("cat", v)} />}
              {facets.types.length > 0 && <Chip label="Type" value={sp.get("type") ?? ""} options={facets.types.map((t) => ({ v: t, label: t }))} onChange={(v) => set("type", v)} />}
              {facets.vendors.length > 0 && <Chip label="Brand" value={sp.get("vendor") ?? ""} options={facets.vendors.map((t) => ({ v: t, label: t }))} onChange={(v) => set("vendor", v)} />}
              <Chip label="Stock" value={sp.get("stock") ?? ""} options={STOCKS.map((s) => ({ v: s.v, label: s.label }))} onChange={(v) => set("stock", v)} />
            </div>
            {filters.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5 border-b border-rule px-3 py-2">
                {filters.map((f) => (
                  <span key={f.k} className="inline-flex h-6 items-center gap-1 rounded-md bg-paper-sunk pl-2 pr-1 text-[12px] font-medium">
                    {f.label}<button type="button" onClick={() => set(f.k, null)} className="rounded p-0.5 hover:bg-black/10" aria-label={`Remove ${f.label}`}><Icon name="close" className="h-3 w-3" /></button>
                  </span>
                ))}
                <button type="button" className="text-[12px] font-medium text-[#005bd3] hover:underline" onClick={() => { const n = new URLSearchParams(sp); ["cat", "type", "vendor", "stock"].forEach((k) => n.delete(k)); setSp(n, { replace: true }); }}>Clear all</button>
              </div>
            )}

            {items.length === 0 ? (
              <div className="px-6 py-14 text-center">
                <Icon name="search" className="mx-auto h-6 w-6 text-ink-faint" />
                <p className="mt-2 font-semibold">No {pack.items.toLowerCase()} found</p>
                <p className="mt-0.5 text-[12.5px] text-ink-soft">Try changing the filters or search term.</p>
              </div>
            ) : (
              <div className={`scroll-thin overflow-x-auto ${busy ? "opacity-60" : ""}`}>
                <table className="table min-w-[860px]">
                  <thead>
                    {sel.length > 0 ? (
                      <tr>
                        <th className="w-10"><input type="checkbox" checked={allOn} onChange={() => setSel(allOn ? [] : items.map((i) => i.id))} aria-label="Select all" /></th>
                        <th colSpan={6} className="normal-case">
                          <span className="mr-3 font-semibold text-ink">{sel.length} selected</span>
                          <span className="inline-flex flex-wrap gap-1.5">
                            <button type="button" className="btn-secondary h-7" onClick={() => bulk("status", { to: "active" })}>Set as active</button>
                            <button type="button" className="btn-secondary h-7" onClick={() => bulk("status", { to: "draft" })}>Set as draft</button>
                            <button type="button" className="btn-secondary h-7" onClick={() => bulk("status", { to: "archived" })}>Archive</button>
                            <button type="button" className="btn-secondary h-7 text-[#8e1f0b]" onClick={() => { if (confirm(`Delete ${sel.length} ${pack.items.toLowerCase()}? This can't be undone.`)) bulk("delete"); }}>Delete</button>
                          </span>
                        </th>
                      </tr>
                    ) : (
                      <tr>
                        <th className="w-10"><input type="checkbox" checked={false} onChange={() => setSel(items.map((i) => i.id))} aria-label="Select all" /></th>
                        <th>{pack.item[0].toUpperCase() + pack.item.slice(1)}</th><th>Status</th><th>Inventory</th><th>{colWord}</th><th>Type</th><th className="text-right">Price</th>
                      </tr>
                    )}
                  </thead>
                  <tbody>
                    {items.map((i) => {
                      const on = sel.includes(i.id);
                      const out = i.tracked && (i.stock ?? 0) <= 0;
                      return (
                        <tr key={i.id} className={on ? "[&>td]:bg-[#f2f7fe]" : ""}>
                          <td><input type="checkbox" checked={on} onChange={() => setSel(on ? sel.filter((x) => x !== i.id) : [...sel, i.id])} aria-label={`Select ${i.title}`} /></td>
                          <td>
                            <Link to={String(i.id)} className="flex items-center gap-3">
                              {i.image ? <img src={`${i.image}${i.image.includes("?") ? "&" : "?"}width=96`} alt="" className="h-10 w-10 shrink-0 rounded-lg object-cover shadow-[0_0_0_1px_rgba(0,0,0,.06)]" loading="lazy" />
                                : <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-paper-sunk"><Icon name="tag" className="h-4 w-4 text-ink-faint" /></span>}
                              <span className="min-w-0"><span className="line-clamp-2 font-semibold text-ink hover:underline">{i.title}</span>{i.source === "shopify" && <span className="text-[11.5px] text-ink-faint">From Shopify</span>}</span>
                            </Link>
                          </td>
                          <td><span className={`inline-flex rounded-md px-1.5 py-0.5 text-[11.5px] font-medium ${PILL[i.status]}`}>{i.status[0].toUpperCase() + i.status.slice(1)}</span></td>
                          <td className={out ? "font-medium text-[#8e1f0b]" : "text-ink-soft"}>
                            {!i.tracked ? "Not tracked" : out ? "Out of stock" : `${(i.stock ?? 0).toLocaleString("en-IN")} in stock`}
                            {i.variants > 1 && <span className="text-ink-faint"> for {i.variants} variants</span>}
                          </td>
                          <td className="max-w-[180px] truncate text-ink-soft">{(i.categories ?? []).join(", ") || "—"}</td>
                          <td className="text-ink-soft">{i.productType ?? "—"}</td>
                          <td className="num text-right">{price(i.minPrice, i.maxPrice)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
          <p className="text-center text-[12.5px] text-ink-soft">Organise them in <Link to={`${base}/collections`} className="font-medium text-ink underline underline-offset-2">{colsWord}</Link> · update stock in <Link to={`${base}/inventory`} className="font-medium text-ink underline underline-offset-2">Inventory</Link></p>
        </>
      )}
    </div>
  );
}

/** A compact filter button with a dropdown list (Shopify-style chip). */
function Chip({ label, value, options, onChange, keep }: { label: string; value: string; options: { v: string; label: string }[]; onChange: (v: string | null) => void; keep?: boolean }) {
  const current = useMemo(() => options.find((o) => o.v === value), [options, value]);
  const on = Boolean(current) && !keep;
  return (
    <label className={`relative inline-flex h-8 cursor-pointer items-center gap-1 rounded-lg px-2.5 text-[12.5px] font-medium ${on ? "bg-paper-sunk text-ink shadow-[inset_0_0_0_1px_rgb(var(--rule-strong))]" : "text-ink-soft shadow-[inset_0_0_0_1px_rgb(var(--rule))] hover:bg-paper"}`}>
      {keep ? <Icon name="layers" className="h-3.5 w-3.5" /> : null}
      <span>{keep ? current?.label ?? label : current ? `${label}: ${current.label}` : label}</span>
      <Icon name="chevron" className="h-3.5 w-3.5 text-ink-faint" />
      <select value={value} onChange={(e) => onChange(e.target.value || null)} className="absolute inset-0 cursor-pointer opacity-0" aria-label={label}>
        {!keep && <option value="">Any {label.toLowerCase()}</option>}
        {options.map((o) => <option key={o.v} value={o.v}>{o.label}</option>)}
      </select>
    </label>
  );
}
