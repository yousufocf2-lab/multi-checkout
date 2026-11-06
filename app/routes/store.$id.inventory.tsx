// Growpefy Store → Inventory: stock of every variant in one table; change quantities in place.
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Link, useFetcher, useLoaderData, useSearchParams } from "@remix-run/react";
import { useEffect, useState } from "react";
import { Icon } from "~/components/Icons";
import { requireStore, requireViewer } from "~/lib/auth.server";
import { catalogAllowed, listInventory, setStock } from "~/lib/catalog.server";
import { formatINR } from "~/lib/pricing";
import { storePath } from "~/lib/store-code";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const viewer = await requireViewer(request);
  const store = await requireStore(viewer, params.id);
  if (!catalogAllowed(viewer, store)) throw new Response("Not found", { status: 404 });
  const q = new URL(request.url).searchParams.get("q") ?? "";
  return json({ storeId: store.id, rows: await listInventory(store.id, q) });
}

export async function action({ request, params }: ActionFunctionArgs) {
  const viewer = await requireViewer(request);
  const store = await requireStore(viewer, params.id);
  if (!catalogAllowed(viewer, store)) throw new Response("Not found", { status: 404 });
  const fd = await request.formData();
  const raw = String(fd.get("stock") ?? "").trim();
  await setStock(store.id, Number(fd.get("id")), raw === "" ? null : Number(raw));
  return json({ ok: true });
}

export default function Inventory() {
  const { storeId, rows } = useLoaderData<typeof loader>();
  const [sp, setSp] = useSearchParams();
  const [q, setQ] = useState(sp.get("q") ?? "");
  const [view, setView] = useState<"all" | "low" | "out">("all");
  useEffect(() => {
    const t = setTimeout(() => { if ((sp.get("q") ?? "") !== q) setSp(q ? { q } : {}, { replace: true, preventScrollReset: true }); }, 300);
    return () => clearTimeout(t);
  }, [q, sp, setSp]);
  const shown = rows.filter((r) => view === "all" || (view === "out" ? r.stock != null && r.stock <= 0 : r.stock != null && r.stock > 0 && r.stock <= 5));

  return (
    <div className="space-y-4">
      <div className="flex min-h-[32px] items-center gap-2">
        <Icon name="box" className="h-4 w-4" strokeWidth={1.9} />
        <h1 className="flex-1 text-[15px] font-semibold">Inventory</h1>
      </div>
      <section className="panel overflow-hidden">
        <div className="flex flex-wrap items-center gap-1 border-b border-rule px-2 py-1.5">
          {(["all", "low", "out"] as const).map((v) => (
            <button key={v} type="button" onClick={() => setView(v)} className={`h-7 rounded-lg px-2.5 text-[12.5px] font-medium ${view === v ? "bg-paper-sunk text-ink" : "text-ink-soft hover:bg-paper"}`}>{v === "all" ? "All" : v === "low" ? "Low stock" : "Out of stock"}</button>
          ))}
          <label className="ml-auto flex h-8 min-w-[240px] items-center gap-2 rounded-lg px-2 text-ink-faint shadow-[inset_0_0_0_1px_rgb(var(--rule))] focus-within:shadow-[inset_0_0_0_2px_#005bd3]">
            <Icon name="search" className="h-4 w-4" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by product or SKU" className="min-w-0 flex-1 border-0 bg-transparent text-[13px] text-ink outline-none" aria-label="Search inventory" />
          </label>
        </div>
        {shown.length === 0 ? <p className="px-6 py-12 text-center text-ink-soft">Nothing here.</p> : (
          <div className="scroll-thin overflow-x-auto">
            <table className="table min-w-[720px]">
              <thead><tr><th>Product</th><th>SKU</th><th className="text-right">Price</th><th className="w-[220px] text-right">Available</th></tr></thead>
              <tbody>{shown.map((r) => <StockRow key={r.id} r={r} storeId={storeId} />)}</tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function StockRow({ r, storeId }: { r: { id: number; itemId: number; title: string; variant: string; sku: string | null; stock: number | null; pricePaise: number; image: string | null }; storeId: number }) {
  const f = useFetcher<{ ok: boolean }>();
  const [val, setVal] = useState(r.stock == null ? "" : String(r.stock));
  const changed = val !== (r.stock == null ? "" : String(r.stock));
  const save = () => f.submit({ id: String(r.id), stock: val }, { method: "post", preventScrollReset: true });
  const out = r.stock != null && r.stock <= 0;
  return (
    <tr>
      <td>
        <Link to={`${storePath(storeId)}/catalog/${r.itemId}`} className="flex items-center gap-3">
          {r.image ? <img src={r.image} alt="" className="h-9 w-9 rounded-lg object-cover shadow-[0_0_0_1px_rgba(0,0,0,.06)]" loading="lazy" /> : <span className="h-9 w-9 rounded-lg bg-paper-sunk" />}
          <span><span className="block font-semibold hover:underline">{r.title}</span>{r.variant !== "Default" && <span className="mt-0.5 inline-block rounded bg-paper-sunk px-1.5 text-[11.5px] text-ink-soft">{r.variant}</span>}</span>
        </Link>
      </td>
      <td className="text-ink-soft">{r.sku ?? "—"}</td>
      <td className="num text-right">{formatINR(r.pricePaise)}</td>
      <td className="text-right">
        <span className="inline-flex items-center gap-1.5">
          {out && !changed && <span className="rounded-md bg-[#fee9e8] px-1.5 text-[11.5px] font-medium text-[#8e1f0b]">Out</span>}
          <button type="button" onClick={() => setVal(String(Math.max(0, (Number(val) || 0) - 1)))} className="flex h-7 w-7 items-center justify-center rounded-lg text-ink-soft shadow-[inset_0_0_0_1px_rgb(var(--rule))] hover:bg-paper" aria-label="One less">−</button>
          <input value={val} onChange={(e) => setVal(e.target.value.replace(/[^0-9]/g, ""))} onKeyDown={(e) => { if (e.key === "Enter") save(); }} placeholder="Not tracked" inputMode="numeric" className="input h-7 w-24 text-right" aria-label={`Stock of ${r.title} ${r.variant}`} />
          <button type="button" onClick={() => setVal(String((Number(val) || 0) + 1))} className="flex h-7 w-7 items-center justify-center rounded-lg text-ink-soft shadow-[inset_0_0_0_1px_rgb(var(--rule))] hover:bg-paper" aria-label="One more">+</button>
          <button type="button" onClick={save} disabled={!changed || f.state !== "idle"} className={`btn-primary h-7 ${changed ? "" : "invisible"}`}>{f.state !== "idle" ? "…" : "Save"}</button>
        </span>
      </td>
    </tr>
  );
}
