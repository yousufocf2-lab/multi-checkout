// Super admin → Railway Usage: write each store's hosting bill (resources, quantity, price) and choose which stores see it.
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Form, Link, useActionData, useLoaderData, useNavigation, useSearchParams } from "@remix-run/react";
import { useEffect, useMemo, useState } from "react";
import { Icon } from "~/components/Icons";
import { Notice, PageHeader, Spinner } from "~/components/ui";
import { requireSuperAdmin } from "~/lib/auth.server";
import { formatINR } from "~/lib/pricing";
import { storePath } from "~/lib/store-code";
import { lineAmount, resourceOf, STATUS_LABEL, USAGE_RESOURCES, usageTotals } from "~/lib/usage-bill";
import { billsFor, deleteBill, readLines, saveBill, setUsageBilling, usageStores } from "~/lib/usage-bill.server";

export async function loader({ request }: LoaderFunctionArgs) {
  await requireSuperAdmin(request);
  const sp = new URL(request.url).searchParams;
  const all = await usageStores();
  const storeId = Number(sp.get("store")) || all.find((s) => s.usageBilling)?.id || all[0]?.id || 0;
  const store = all.find((s) => s.id === storeId) ?? null;
  const bills = store ? await billsFor(store.id) : [];
  const billParam = sp.get("bill");
  const isNew = billParam === "new";
  const editing = isNew ? null : bills.find((b) => b.id === Number(billParam)) ?? null;
  return json({ stores: all, store, bills, editing, isNew });
}

export async function action({ request }: ActionFunctionArgs) {
  await requireSuperAdmin(request);
  const fd = await request.formData();
  const intent = String(fd.get("intent") ?? "");
  const storeId = Number(fd.get("storeId"));
  if (!storeId) return json({ error: "Pick a store.", ok: null, id: null });
  if (intent === "visible") {
    await setUsageBilling(storeId, fd.get("on") === "1");
    return json({ error: null, ok: fd.get("on") === "1" ? "Railway Usage is now visible to this store." : "Railway Usage is hidden from this store.", id: null });
  }
  if (intent === "delete") {
    await deleteBill(storeId, Number(fd.get("id")));
    return json({ error: null, ok: "Bill deleted.", id: null });
  }
  if (intent === "save") {
    const r = await saveBill({
      id: Number(fd.get("id")) || undefined, storeId,
      periodStart: String(fd.get("periodStart") ?? ""), periodEnd: String(fd.get("periodEnd") ?? ""),
      lines: readLines(String(fd.get("lines") ?? "[]")), status: String(fd.get("status") ?? "draft"),
      dueDate: String(fd.get("dueDate") ?? ""), note: String(fd.get("note") ?? ""),
    });
    return json("error" in r ? { error: r.error ?? "Couldn't save.", ok: null, id: null } : { error: null, ok: "Bill saved.", id: r.id });
  }
  return json({ error: "Unknown action", ok: null, id: null }, { status: 400 });
}

type D = ReturnType<typeof useLoaderData<typeof loader>>;
const fmtDate = (d: string) => new Date(`${d}T00:00:00+05:30`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
const period = (a: string, b: string) => `${fmtDate(a)} – ${fmtDate(b)}`;
const STATUS_CLS = { draft: "bg-paper-sunk text-ink-soft", due: "bg-[#fff4e0] text-[#8a5a00]", paid: "bg-[#e3f1ea] text-[#1f6f4a]" } as const;

export default function RailwayUsageAdmin() {
  const d = useLoaderData<typeof loader>();
  const a = useActionData<typeof action>();
  const [params] = useSearchParams();
  const href = (patch: Record<string, string | null>) => {
    const p = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) v == null ? p.delete(k) : p.set(k, v);
    return `?${p}`;
  };
  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <PageHeader title="Railway Usage" icon="layers"
        description="Write each store's hosting bill: resources, how much was used and the price. Only stores you switch on can see it." />
      {a?.error && <Notice tone="error">{a.error}</Notice>}
      {a?.ok && <Notice tone="success">{a.ok}</Notice>}

      <div className="grid gap-5 lg:grid-cols-[280px_minmax(0,1fr)]">
        <aside className="panel h-fit overflow-hidden p-0">
          <p className="border-b border-rule px-4 py-3 text-[12px] font-semibold uppercase tracking-wide text-ink-faint">Stores</p>
          <ul className="max-h-[70vh] divide-y divide-rule overflow-y-auto">
            {d.stores.map((s) => (
              <li key={s.id}>
                <Link to={href({ store: String(s.id), bill: null })} preventScrollReset
                  className={`flex items-center gap-2 px-4 py-2.5 text-[13.5px] ${d.store?.id === s.id ? "bg-[#f1f8f4] font-semibold text-ink" : "text-ink-soft hover:bg-paper"}`}>
                  <span className="min-w-0 flex-1 truncate">{s.name} <span className="text-ink-faint">#{s.id}</span></span>
                  {s.usageBilling && <span className="rounded-full bg-[#e3f1ea] px-1.5 py-px text-[10.5px] font-semibold text-[#1f6f4a]">Visible</span>}
                </Link>
              </li>
            ))}
          </ul>
        </aside>

        {d.store ? (
          <div className="min-w-0 space-y-5">
            <section className="panel flex flex-wrap items-center gap-3 p-4">
              <div className="min-w-0 flex-1">
                <p className="text-[15px] font-semibold">{d.store.name}</p>
                <p className="text-[13px] text-ink-soft">{d.store.usageBilling ? "This store sees Railway Usage in its menu (bills marked Due or Paid)." : "Hidden: this store doesn't see Railway Usage."}</p>
              </div>
              {d.store.usageBilling && <a href={`${storePath(d.store.id)}/railway-usage`} target="_blank" rel="noreferrer" className="btn-secondary h-9 px-3 text-[13px]">See as store ↗</a>}
              <Form method="post">
                <input type="hidden" name="intent" value="visible" /><input type="hidden" name="storeId" value={d.store.id} />
                <input type="hidden" name="on" value={d.store.usageBilling ? "0" : "1"} />
                <button className={d.store.usageBilling ? "btn-secondary h-9 px-3 text-[13px]" : "btn-primary h-9 px-3 text-[13px]"}>{d.store.usageBilling ? "Hide from store" : "Show to store"}</button>
              </Form>
            </section>

            <section className="panel overflow-hidden p-0">
              <div className="flex items-center gap-3 border-b border-rule px-4 py-3">
                <h2 className="flex-1 text-[15px] font-semibold">Bills</h2>
                <Link to={href({ bill: "new" })} preventScrollReset className="btn-primary h-9 px-3 text-[13px]"><Icon name="plus" className="h-4 w-4" />New bill</Link>
              </div>
              {d.bills.length === 0 ? <p className="px-4 py-8 text-center text-[13px] text-ink-faint">No bills yet. Create the first one.</p> : (
                <ul className="divide-y divide-rule">
                  {d.bills.map((b) => {
                    const t = usageTotals(b.lines);
                    const on = d.editing?.id === b.id;
                    return (
                      <li key={b.id}>
                        <Link to={href({ bill: String(b.id) })} preventScrollReset className={`flex flex-wrap items-center gap-3 px-4 py-3 text-[13.5px] ${on ? "bg-[#f1f8f4]" : "hover:bg-paper"}`}>
                          <span className="min-w-0 flex-1 font-medium">{period(b.periodStart, b.periodEnd)}</span>
                          <span className="text-[12px] text-ink-faint">{b.lines.length} item{b.lines.length === 1 ? "" : "s"}</span>
                          <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${STATUS_CLS[b.status]}`}>{STATUS_LABEL[b.status]}</span>
                          <span className="num w-24 text-right font-semibold">{formatINR(t.total)}</span>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>

            {(d.isNew || d.editing) && <BillEditor key={d.editing?.id ?? "new"} d={d} storeId={d.store.id} />}
          </div>
        ) : <p className="panel p-6 text-sm text-ink-soft">No stores yet.</p>}
      </div>
    </div>
  );
}

type Row = { key: string; label: string; unit: string; qty: string; rate: string; amount: string };
const toRow = (key: string): Row => {
  if (key.startsWith("custom")) return { key, label: "Other", unit: "unit", qty: "", rate: "", amount: "" };
  const r = resourceOf(key); return { key, label: r.label, unit: r.unit, qty: "", rate: "", amount: "" };
};
const num = (s: string) => (s.trim() === "" ? NaN : Number(s));

function monthRange() {
  const now = new Date(Date.now() + 5.5 * 3600_000);
  const y = now.getUTCFullYear(), m = now.getUTCMonth();
  const iso = (dt: Date) => dt.toISOString().slice(0, 10);
  return { start: iso(new Date(Date.UTC(y, m, 1))), end: iso(new Date(Date.UTC(y, m + 1, 0))) };
}

function BillEditor({ d, storeId }: { d: D; storeId: number }) {
  const nav = useNavigation();
  const busy = nav.state === "submitting" && nav.formData?.get("intent") === "save";
  const bill = d.editing;
  const def = monthRange();
  const [rows, setRows] = useState<Row[]>(() => bill
    ? bill.lines.map((l) => ({ key: l.key, label: l.label, unit: l.unit, qty: String(l.qty), rate: String(l.ratePaise / 100),
        amount: "" }))
    : ["vcpu", "memory", "egress", "volume", "bucket"].map(toRow));
  const [pick, setPick] = useState("");
  const amountOf = (r: Row) => lineAmount(num(r.qty) || 0, Math.round((num(r.rate) || 0) * 100)); // used × price, always
  const total = rows.reduce((s, r) => s + amountOf(r), 0);
  const set = (i: number, patch: Partial<Row>) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const unused = useMemo(() => USAGE_RESOURCES.filter((r) => !rows.some((x) => x.key === r.key)), [rows]);
  useEffect(() => { if (pick) { setRows((rs) => [...rs, toRow(pick)]); setPick(""); } }, [pick]);

  return (
    <section className="panel overflow-hidden p-0">
      <Form method="post">
        <input type="hidden" name="intent" value="save" />
        <input type="hidden" name="storeId" value={storeId} />
        {bill && <input type="hidden" name="id" value={bill.id} />}
        <input type="hidden" name="lines" value={JSON.stringify(rows)} />
        <div className="flex items-center gap-3 border-b border-rule px-4 py-3">
          <h2 className="flex-1 text-[15px] font-semibold">{bill ? "Edit bill" : "New bill"}</h2>
        </div>
        <div className="grid gap-3 border-b border-rule p-4 sm:grid-cols-4">
          <label className="block"><span className="label">Period from</span><input type="date" name="periodStart" required defaultValue={bill?.periodStart ?? def.start} className="input mt-1 h-9 text-[13px]" /></label>
          <label className="block"><span className="label">Period to</span><input type="date" name="periodEnd" required defaultValue={bill?.periodEnd ?? def.end} className="input mt-1 h-9 text-[13px]" /></label>
          <label className="block"><span className="label">Pay by</span><input type="date" name="dueDate" defaultValue={bill?.dueDate ?? ""} className="input mt-1 h-9 text-[13px]" /></label>
          <label className="block"><span className="label">Status</span>
            <select name="status" defaultValue={bill?.status ?? "draft"} className="input mt-1 h-9 text-[13px]">
              <option value="draft">Draft (store can't see it)</option><option value="due">Due</option><option value="paid">Paid</option>
            </select>
          </label>
        </div>

        {/* Rows: a table on a computer, a card per resource on a phone. The amount is worked out as you type. */}
        <div className="hidden grid-cols-[minmax(0,1.6fr)_130px_110px_120px_110px_32px] gap-3 border-b border-rule bg-paper px-4 py-2.5 text-[11.5px] font-semibold uppercase tracking-wide text-ink-faint md:grid">
          <span>Resource</span><span>Unit</span><span className="text-right">Used</span><span className="text-right">Price / unit (₹)</span><span className="text-right">Amount</span><span />
        </div>
        <ul className="divide-y divide-rule">
          {rows.map((r, i) => {
            const amt = amountOf(r);
            return (
              <li key={i} className="grid grid-cols-2 gap-x-3 gap-y-2 px-4 py-3 md:grid-cols-[minmax(0,1.6fr)_130px_110px_120px_110px_32px] md:items-start md:py-2">
                <div className="col-span-2 flex items-start gap-2 md:col-span-1">
                  <div className="min-w-0 flex-1">
                    <input value={r.label} onChange={(e) => set(i, { label: e.target.value })} className="input h-9 text-[13px]" aria-label="Resource name" />
                    <p className="mt-0.5 text-[11px] text-ink-faint">{resourceOf(r.key).hint}</p>
                  </div>
                  <button type="button" onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))} className="mt-1.5 rounded p-1 text-ink-faint hover:text-bad md:hidden" aria-label="Remove row"><Icon name="close" className="h-4 w-4" /></button>
                </div>
                <label className="col-span-2 md:col-span-1"><span className="mb-1 block text-[11px] font-medium text-ink-faint md:hidden">Unit</span>
                  <input value={r.unit} onChange={(e) => set(i, { unit: e.target.value })} className="input h-9 text-[13px]" aria-label="Unit" /></label>
                <label><span className="mb-1 block text-[11px] font-medium text-ink-faint md:hidden">Used</span>
                  <input value={r.qty} onChange={(e) => set(i, { qty: e.target.value })} inputMode="decimal" placeholder="0" className="input num h-9 text-right text-[13px]" aria-label="Quantity used" /></label>
                <label><span className="mb-1 block text-[11px] font-medium text-ink-faint md:hidden">Price / unit (₹)</span>
                  <input value={r.rate} onChange={(e) => set(i, { rate: e.target.value })} inputMode="decimal" placeholder="0.00" className="input num h-9 text-right text-[13px]" aria-label="Price per unit" /></label>
                <p className="col-span-2 flex items-center justify-between rounded-lg bg-paper px-3 py-2 md:col-span-1 md:block md:bg-transparent md:px-0 md:py-2 md:text-right" aria-live="polite">
                  <span className="text-[12px] text-ink-soft md:hidden">Amount</span>
                  <span className={`num text-[14px] font-semibold ${amt < 0 ? "text-[#067647]" : "text-ink"}`}>{amt < 0 ? `− ${formatINR(-amt)}` : formatINR(amt)}</span>
                </p>
                <button type="button" onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))} className="mt-1.5 hidden rounded p-1 text-ink-faint hover:text-bad md:block" aria-label="Remove row"><Icon name="close" className="h-4 w-4" /></button>
              </li>
            );
          })}
        </ul>
        <div className="flex flex-wrap items-center gap-3 border-t border-rule px-4 py-3">
          <select value={pick} onChange={(e) => setPick(e.target.value)} className="input h-9 w-56 text-[13px]" aria-label="Add a resource">
            <option value="">+ Add a resource</option>
            {unused.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
            <option value={`custom-${rows.length}`}>Other (type your own)</option>
          </select>
          <p className="text-[12px] text-ink-faint">Amount = used × price, worked out as you type. For credits use a minus price.</p>
          <div className="ml-auto text-right">
            <p className="text-[12px] text-ink-soft">Total</p>
            <p className="num text-[22px] font-semibold leading-none">{formatINR(Math.max(0, total))}</p>
          </div>
        </div>
        <div className="border-t border-rule p-4">
          <label className="block"><span className="label">Note for the store (optional)</span>
            <textarea name="note" defaultValue={bill?.note ?? ""} rows={2} maxLength={500} placeholder="e.g. Pay to UPI … by the due date" className="input mt-1 text-[13px]" /></label>
        </div>
        <div className="flex items-center gap-2 border-t border-rule bg-paper px-4 py-3">
          <button className="btn-primary h-9 px-4" disabled={busy}>{busy ? <><Spinner /> Saving</> : "Save bill"}</button>
          <Link to={`?store=${storeId}`} className="btn-secondary h-9 px-4" preventScrollReset>Close</Link>
        </div>
      </Form>
      {bill && (
        <Form method="post" className="border-t border-rule px-4 py-3" onSubmit={(e) => { if (!window.confirm("Delete this bill? The store won't see it any more.")) e.preventDefault(); }}>
          <input type="hidden" name="intent" value="delete" /><input type="hidden" name="storeId" value={storeId} /><input type="hidden" name="id" value={bill.id} />
          <button className="text-[13px] font-medium text-bad hover:underline">Delete this bill</button>
        </Form>
      )}
    </section>
  );
}
