// Discounts: every kind in one list (product discounts, codes, free gifts, bank offers). "Create discount" picks the kind.
import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Link, useLoaderData, useSearchParams } from "@remix-run/react";
import { desc, eq } from "drizzle-orm";
import { DiscountPicker } from "~/components/DiscountPicker";
import { Icon } from "~/components/Icons";
import { LearnMore } from "~/components/ui";
import { bankOffers, coupons, db, discountRules, freeOffers } from "~/db.server";
import { can, requireStore, requireViewer } from "~/lib/auth.server";
import { storePath } from "~/lib/store-code";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const viewer = await requireViewer(request);
  const store = await requireStore(viewer, params.id);
  if (!can(viewer, "offers")) throw new Response("Not allowed", { status: 403 });
  const [rules, codes, gifts, banks] = await Promise.all([
    db.select().from(discountRules).where(eq(discountRules.storeId, store.id)).orderBy(desc(discountRules.createdAt)),
    db.select().from(coupons).where(eq(coupons.storeId, store.id)).orderBy(desc(coupons.createdAt)),
    db.select().from(freeOffers).where(eq(freeOffers.storeId, store.id)).orderBy(desc(freeOffers.createdAt)),
    db.select().from(bankOffers).where(eq(bankOffers.storeId, store.id)).orderBy(desc(bankOffers.createdAt)),
  ]);
  const val = (type: string, v: number) => (type === "flat" ? `₹${v.toLocaleString("en-IN")}` : `${v}%`);
  const now = Date.now();
  const rows = [
    ...rules.map((r) => ({ key: `r${r.id}`, title: r.name, kind: "Amount off products", to: "discounts", active: r.active, detail: `${val(r.type, r.prepaidPct)} online · ${val(r.type, r.codPct)} COD · ${r.products.length} product${r.products.length === 1 ? "" : "s"}`, used: null as number | null, at: r.createdAt })),
    ...codes.map((c) => ({
      key: `c${c.id}`, title: c.code, kind: "Discount code", to: "coupons",
      active: c.active && !(c.endsAt && c.endsAt.getTime() < now) && !(c.usageLimit != null && c.usedCount >= c.usageLimit),
      detail: [`${val(c.type, c.value)} off`, c.minCartRupees > 0 && `min ₹${c.minCartRupees}`, c.paymentRestriction !== "any" && (c.paymentRestriction === "prepaid" ? "online only" : "COD only"), c.endsAt && `ends ${c.endsAt.toLocaleDateString("en-IN", { day: "numeric", month: "short" })}`].filter(Boolean).join(" · "),
      used: c.usedCount, at: c.createdAt,
    })),
    ...gifts.map((g) => ({ key: `g${g.id}`, title: g.name, kind: "Free gift", to: "gifts", active: g.active, detail: `Buy ${g.minQty}${g.buyMode === "any" ? " of anything" : ""}, get ${g.freeQty} free${g.repeat ? " (repeats)" : ""}`, used: null, at: g.createdAt })),
    ...banks.map((b) => ({ key: `b${b.id}`, title: b.title, kind: "Bank & card offer", to: "offers", active: b.active, detail: `${b.bankName} · ${val(b.type, b.value)}${b.minCartRupees > 0 ? ` · min ₹${b.minCartRupees}` : ""}`, used: null, at: b.createdAt })),
  ].sort((a, b) => b.at.getTime() - a.at.getTime());
  return json({ storeId: store.id, rows: rows.map((r) => ({ ...r, at: r.at.toISOString() })) });
}

const FILTERS = ["all", "active", "off"] as const;

export default function Promotions() {
  const { storeId, rows } = useLoaderData<typeof loader>();
  const [sp, setSp] = useSearchParams();
  const f = (FILTERS as readonly string[]).includes(sp.get("f") ?? "") ? (sp.get("f") as (typeof FILTERS)[number]) : "all";
  const q = (sp.get("q") ?? "").toLowerCase();
  const shown = rows.filter((r) => (f === "all" || (f === "active") === r.active) && (!q || `${r.title} ${r.kind}`.toLowerCase().includes(q)));
  const set = (k: string, v: string) => { const n = new URLSearchParams(sp); if (v) n.set(k, v); else n.delete(k); setSp(n, { replace: true, preventScrollReset: true }); };

  if (rows.length === 0) {
    return (
      <div className="panel flex flex-col items-center px-6 py-14 text-center">
        <span className="flex h-20 w-20 items-center justify-center rounded-full bg-paper-sunk"><Icon name="discounts" className="h-9 w-9 text-ink-soft" strokeWidth={1.4} /></span>
        <h2 className="mt-5 text-[15px] font-semibold">Manage discounts and promotions</h2>
        <p className="mt-1 max-w-md text-[13px] text-ink-soft">Add product discounts, discount codes, free gifts and bank offers that show up at checkout.</p>
        <div className="mt-5 flex items-center gap-2"><LearnMore topic="discounts" /><DiscountPicker storeId={storeId} /></div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <section className="panel overflow-hidden">
        <div className="flex flex-wrap items-center gap-1 border-b border-rule px-2 py-1.5">
          {FILTERS.map((x) => (
            <button key={x} type="button" onClick={() => set("f", x === "all" ? "" : x)} className={`h-7 rounded-lg px-2.5 text-[12.5px] font-medium ${f === x ? "bg-paper-sunk text-ink" : "text-ink-soft hover:bg-paper"}`}>
              {x === "all" ? "All" : x === "active" ? "Active" : "Off"}
            </button>
          ))}
          <label className="ml-auto flex h-7 items-center gap-1.5 rounded-lg px-2 text-ink-faint focus-within:shadow-[inset_0_0_0_1px_#005bd3]">
            <Icon name="search" className="h-3.5 w-3.5" />
            <input value={sp.get("q") ?? ""} onChange={(e) => set("q", e.target.value)} placeholder="Search discounts" className="w-44 border-0 bg-transparent text-[12.5px] text-ink outline-none focus:shadow-none" aria-label="Search discounts" />
          </label>
        </div>
        <div className="overflow-x-auto">
          <table className="table min-w-[640px]">
            <thead><tr><th>Title</th><th>Status</th><th>Type</th><th>Details</th><th className="text-right">Used</th></tr></thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.key} className="cursor-pointer">
                  <td><Link to={`${storePath(storeId)}/${r.to}`} className="font-semibold text-ink hover:underline">{r.title}</Link></td>
                  <td><span className={`inline-flex rounded-md px-1.5 py-0.5 text-[11.5px] font-medium ${r.active ? "bg-[#cdfee1] text-[#0c5132]" : "bg-paper-sunk text-ink-soft"}`}>{r.active ? "Active" : "Off"}</span></td>
                  <td className="text-ink-soft">{r.kind}</td>
                  <td className="max-w-[320px] truncate text-ink-soft">{r.detail}</td>
                  <td className="num text-right text-ink-soft">{r.used ?? "—"}</td>
                </tr>
              ))}
              {shown.length === 0 && <tr><td colSpan={5} className="py-10 text-center text-ink-faint">No discounts match.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
