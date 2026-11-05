// Growpefy Store → Products (Menu / Courses / Rooms ... by business type): the store's own catalog.
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Form, Link, useActionData, useLoaderData, useSearchParams, useSubmit } from "@remix-run/react";
import { Notice, SubmitButton } from "~/components/ui";
import { requireStore, requireViewer } from "~/lib/auth.server";
import { packOf } from "~/lib/business-types";
import { catalogAllowed, countByStatus, createCategory, deleteCategory, importFromShopify, listCategories, listItems, type ItemStatus } from "~/lib/catalog.server";
import { formatINR } from "~/lib/pricing";

const STATUSES = ["all", "active", "draft", "archived"] as const;
const imports = new Map<number, { startedAt: number; done?: { items: number; variants: number; categories: number }; error?: string }>();

export async function loader({ request, params }: LoaderFunctionArgs) {
  const viewer = await requireViewer(request);
  const store = await requireStore(viewer, params.id);
  if (!catalogAllowed(viewer, store)) throw new Response("Not found", { status: 404 });
  const sp = new URL(request.url).searchParams;
  const status = (STATUSES as readonly string[]).includes(sp.get("status") ?? "") ? (sp.get("status") as ItemStatus | "all") : "all";
  const q = sp.get("q") ?? "";
  const [items, counts, categories] = await Promise.all([listItems(store.id, { q, status }), countByStatus(store.id), listCategories(store.id)]);
  const imp = imports.get(store.id);
  return json({
    store: { id: store.id, slug: store.slug, name: store.name, platform: store.platform, shopify: store.platform === "shopify" && Boolean(store.adminToken || store.clientId) },
    pack: packOf(store.businessType), status, q, counts, categories,
    items: items.map((i) => ({ ...i, updatedAt: i.updatedAt.toISOString() })),
    importing: imp && !imp.done && !imp.error ? Math.round((Date.now() - imp.startedAt) / 1000) : null,
    lastImport: imp?.done ?? null, importError: imp?.error ?? null,
  });
}

export async function action({ request, params }: ActionFunctionArgs) {
  const viewer = await requireViewer(request);
  const store = await requireStore(viewer, params.id);
  if (!catalogAllowed(viewer, store)) throw new Response("Not found", { status: 404 });
  const fd = await request.formData();
  try {
    switch (fd.get("intent")) {
      case "import": {
        const running = imports.get(store.id);
        if (running && !running.done && !running.error) return json({ ok: "Import is already running.", error: null });
        const job: { startedAt: number; done?: { items: number; variants: number; categories: number }; error?: string } = { startedAt: Date.now() };
        imports.set(store.id, job);
        importFromShopify(store).then((r) => { job.done = r; }).catch((e) => { job.error = e instanceof Error ? e.message : "Import failed"; console.error("[catalog-import]", store.id, e); });
        return json({ ok: "Import started. Products appear here as they come in. Refresh in a minute.", error: null });
      }
      case "addCategory":
        await createCategory(store.id, String(fd.get("title") ?? ""));
        return json({ ok: "Category added.", error: null });
      case "deleteCategory":
        await deleteCategory(store.id, Number(fd.get("id")));
        return json({ ok: "Category deleted. Its products are not touched.", error: null });
    }
  } catch (e) {
    return json({ ok: null, error: e instanceof Error ? e.message : "Something went wrong" }, { status: 400 });
  }
  return json({ ok: null, error: null });
}

const price = (min: number | null, max: number | null) => (min == null ? "—" : min === max ? formatINR(min) : `${formatINR(min)} – ${formatINR(max ?? min)}`);
const STATUS_STYLE: Record<string, string> = { active: "bg-emerald-50 text-good", draft: "bg-paper-sunk text-ink-soft", archived: "bg-paper-sunk text-ink-faint" };

export default function Catalog() {
  const { store, pack, status, q, counts, categories, items, importing, lastImport, importError } = useLoaderData<typeof loader>();
  const a = useActionData<typeof action>();
  const [sp] = useSearchParams();
  const submit = useSubmit();
  const tab = (s: string) => { const p = new URLSearchParams(sp); if (s === "all") p.delete("status"); else p.set("status", s); return `?${p}`; };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="flex-1 text-[22px] font-semibold tracking-tight">{pack.items}</h1>
        {store.shopify && (
          <Form method="post"><input type="hidden" name="intent" value="import" />
            <SubmitButton className="btn-secondary" busyText="Starting">Import from Shopify</SubmitButton>
          </Form>
        )}
        <a href={`/s/${store.slug}`} target="_blank" rel="noreferrer" className="btn-secondary">View website</a>
        <Link to="new" className="btn-primary">Add {pack.item}</Link>
      </div>

      {a?.ok && <Notice tone="success">{a.ok}</Notice>}
      {a?.error && <Notice tone="error">{a.error}</Notice>}
      {importing != null && <Notice tone="info">Importing from Shopify… ({importing}s). Refresh to see new {pack.items.toLowerCase()}.</Notice>}
      {importError && <Notice tone="error">Shopify import stopped: {importError}</Notice>}
      {lastImport && importing == null && <Notice tone="success">Imported {lastImport.items} {pack.items.toLowerCase()}, {lastImport.variants} variants and {lastImport.categories} categories from Shopify.</Notice>}

      <div className="flex flex-wrap items-start gap-5">
        <section className="panel min-w-0 flex-[3_1_560px] overflow-hidden">
          <div className="flex flex-wrap items-center gap-1 border-b border-rule px-3 py-2">
            {STATUSES.map((s) => (
              <Link key={s} to={tab(s)} replace className={`rounded-lg px-3 py-1.5 text-sm ${status === s ? "bg-paper-sunk font-semibold text-ink" : "text-ink-soft hover:text-ink"}`}>
                {s[0].toUpperCase() + s.slice(1)} <span className="text-ink-faint">{counts[s]}</span>
              </Link>
            ))}
            <Form method="get" className="ml-auto" onChange={(e) => submit(e.currentTarget, { replace: true })}>
              {status !== "all" && <input type="hidden" name="status" value={status} />}
              <input type="search" name="q" defaultValue={q} placeholder={`Search ${pack.items.toLowerCase()}`} className="input h-9 w-56" aria-label={`Search ${pack.items.toLowerCase()}`} />
            </Form>
          </div>

          {items.length === 0 ? (
            <div className="px-6 py-14 text-center">
              <p className="font-medium">{q ? "Nothing matches that search." : `No ${pack.items.toLowerCase()} yet`}</p>
              {!q && <p className="mt-1 text-sm text-ink-soft">{store.shopify ? "Import them from Shopify in one click, or add one by hand." : `Add your first ${pack.item}.`}</p>}
            </div>
          ) : (
            <div className="scroll-thin overflow-x-auto">
              <table className="table min-w-[720px]">
                <thead><tr><th className="w-14"></th><th>{pack.item[0].toUpperCase() + pack.item.slice(1)}</th><th>Status</th><th>Stock</th><th className="text-right">Price</th></tr></thead>
                <tbody>
                  {items.map((i) => (
                    <tr key={i.id}>
                      <td>{i.image ? <img src={`${i.image}${i.image.includes("?") ? "&" : "?"}width=96`} alt="" className="h-10 w-10 rounded-lg object-cover" loading="lazy" /> : <span className="block h-10 w-10 rounded-lg bg-paper-sunk" />}</td>
                      <td>
                        <Link to={String(i.id)} className="font-medium text-ink hover:underline">{i.title}</Link>
                        <p className="text-xs text-ink-faint">{i.variants > 1 ? `${i.variants} variants` : "1 variant"}{i.productType ? ` · ${i.productType}` : ""}{i.source === "shopify" ? " · from Shopify" : ""}</p>
                      </td>
                      <td><span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[i.status]}`}>{i.status[0].toUpperCase() + i.status.slice(1)}</span></td>
                      <td className={`text-sm ${i.tracked && (i.stock ?? 0) <= 0 ? "font-medium text-bad" : "text-ink-soft"}`}>{!i.tracked ? "Not tracked" : (i.stock ?? 0) <= 0 ? "Out of stock" : `${i.stock} in stock`}</td>
                      <td className="num text-right">{price(i.minPrice, i.maxPrice)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <aside className="panel min-w-0 flex-[1_1_240px] p-4">
          <h2 className="text-[15px] font-semibold">{pack.categories}</h2>
          <ul className="mt-3 space-y-1">
            {categories.map((c) => (
              <li key={c.id} className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-paper">
                <span className="flex-1 truncate">{c.title}</span>
                <span className="num text-xs text-ink-faint">{c.items}</span>
                <Form method="post" onSubmit={(e) => { if (!confirm(`Delete “${c.title}”? Its ${pack.items.toLowerCase()} stay.`)) e.preventDefault(); }}>
                  <input type="hidden" name="intent" value="deleteCategory" /><input type="hidden" name="id" value={c.id} />
                  <button className="text-xs text-ink-faint hover:text-bad" aria-label={`Delete ${c.title}`}>✕</button>
                </Form>
              </li>
            ))}
            {categories.length === 0 && <li className="text-sm text-ink-faint">None yet.</li>}
          </ul>
          <Form method="post" className="mt-3 flex gap-2" key={categories.length}>
            <input type="hidden" name="intent" value="addCategory" />
            <input name="title" required placeholder="New category" className="input h-9 min-w-0 flex-1" aria-label="New category name" />
            <SubmitButton className="btn-secondary h-9" busyText="Adding">Add</SubmitButton>
          </Form>
        </aside>
      </div>
    </div>
  );
}
