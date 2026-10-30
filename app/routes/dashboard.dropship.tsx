// Super admin only. Stores never see this page, its menu item, or any dropshipping setting.
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Form, useActionData, useLoaderData, useNavigation } from "@remix-run/react";
import { and, asc, eq, sql } from "drizzle-orm";
import { useState } from "react";
import { Notice, PageHeader, SubmitButton } from "~/components/ui";
import { db, dropshipOrders, dropshipSkus, stores, wallets } from "~/db.server";
import { requireAdmin } from "~/lib/auth.server";
import { STATUS_LABEL, ZONES, parsePriceLines, skuKey, type DropshipStatus, type Zone } from "~/lib/dropship";
import {
  dropshipAlerts, fulfilDropship, markRto, recentDropshipOrders, savePriceList, saveZones, zonesNow,
} from "~/lib/dropship.server";
import { rupees } from "~/lib/wallet";
import { getWallet, stateOf, walletsFor } from "~/lib/wallet.server";

export async function loader({ request }: LoaderFunctionArgs) {
  await requireAdmin(request);
  const allStores = await db.select({ id: stores.id, name: stores.name, logoUrl: stores.logoUrl, enabled: stores.dropshipEnabled, dropship: stores.dropship })
    .from(stores).orderBy(asc(stores.name));
  const [ws, zones, skus, recent, alerts, counts] = await Promise.all([
    walletsFor(allStores.map((s) => s.id)),
    zonesNow(),
    db.select().from(dropshipSkus).orderBy(asc(dropshipSkus.sku)),
    recentDropshipOrders(150),
    dropshipAlerts(),
    db.select({ status: dropshipOrders.status, n: sql<number>`count(*)::int` }).from(dropshipOrders).groupBy(dropshipOrders.status),
  ]);
  const count = (s: string) => Number(counts.find((c) => c.status === s)?.n ?? 0);
  return json({
    zones,
    skus: skus.map((s) => ({ sku: s.sku, name: s.name, price: s.pricePaise })),
    stores: allStores.map((s) => {
      const w = ws.find((x) => x.storeId === s.id)!;
      return {
        id: s.id, name: s.name, logoUrl: s.logoUrl, enabled: s.enabled,
        balance: w.balancePaise, limit: w.negativeLimitPaise, state: stateOf(w),
        rtoPaise: s.dropship?.rtoPaise ?? null, prices: s.dropship?.prices ?? {},
      };
    }),
    orders: recent.map((r) => ({
      id: r.d.orderId, name: r.name, store: r.storeName, city: r.customer.city, pincode: r.customer.pincode,
      status: r.d.status as DropshipStatus, zone: r.d.zone, product: r.d.productPaise, shipping: r.d.shippingPaise, packing: r.d.packingPaise,
      rto: r.d.rtoPaise, refund: r.d.refundPaise, tracking: r.d.trackingNumber, error: r.d.error,
      lines: r.d.lines, missing: r.d.missingSkus, fulfilAfter: r.d.fulfilAfter, fulfilledAt: r.d.fulfilledAt, createdAt: r.d.createdAt,
    })),
    alerts: alerts.map((a) => ({ id: a.d.orderId, name: a.name, store: a.storeName, missing: a.d.missingSkus, createdAt: a.d.createdAt })),
    counts: { waiting: count("charged"), fulfilled: count("fulfilled"), cancelled: count("cancelled"), rto: count("rto") },
  });
}

/** "24", "₹24.50", "1,200" → paise. Blank → null. */
const paise = (v: FormDataEntryValue | null) => {
  const t = String(v ?? "").replace(/[₹,\s]/g, "");
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : NaN;
};

export async function action({ request }: ActionFunctionArgs) {
  const admin = await requireAdmin(request);
  const fd = await request.formData();
  const s = (k: string) => String(fd.get(k) ?? "").trim();
  const intent = s("intent");
  const fail = (error: string) => json({ ok: null, error }, { status: 400 });

  if (intent === "store") {
    const id = Number(s("storeId"));
    const [store] = await db.select().from(stores).where(eq(stores.id, id)).limit(1);
    if (!store) return fail("Store not found");
    const on = fd.get("enabled") === "on";
    const limit = paise(fd.get("limit"));
    const rto = paise(fd.get("rto"));
    if (limit == null || Number.isNaN(limit)) return fail("Enter how far below ₹0 the wallet may go (e.g. 500)");
    if (Number.isNaN(rto)) return fail("RTO charge isn't a valid amount");
    const { rows, bad } = parsePriceLines(s("prices"), false);
    if (bad.length) return fail(`Couldn't read these price lines: ${bad.slice(0, 3).join(" | ")}`);
    const prices: Record<string, number> = {};
    for (const r of rows) {
      if (!skuKey(r.sku)) return fail(`${r.sku} is shorter than 9 characters`);
      prices[r.sku] = r.pricePaise;
    }
    await db.update(stores).set({
      dropshipEnabled: on,
      dropship: {
        ...store.dropship, rtoPaise: rto, prices,
        enabledAt: on ? (store.dropshipEnabled && store.dropship?.enabledAt ? store.dropship.enabledAt : new Date().toISOString()) : store.dropship?.enabledAt,
      },
    }).where(eq(stores.id, id));
    const w = await getWallet(id);
    await db.update(wallets).set({ negativeLimitPaise: limit, updatedAt: new Date() }).where(eq(wallets.id, w.id));
    return json({ ok: `${store.name}: dropshipping ${on ? "on" : "off"}. Saved.`, error: null });
  }

  if (intent === "zones") {
    const z = {} as Record<Zone, number>;
    for (const { id } of ZONES) {
      const v = paise(fd.get(`zone${id}`));
      if (v == null || Number.isNaN(v)) return fail(`Enter the shipping charge for zone ${id}`);
      z[id] = v;
    }
    await saveZones(z);
    return json({ ok: "Shipping charges saved. They apply to new orders.", error: null });
  }

  if (intent === "prices") {
    const { rows, bad } = parsePriceLines(s("list"), true);
    if (bad.length) return fail(`Couldn't read these lines: ${bad.slice(0, 3).join(" | ")}`);
    if (!rows.length) return fail("The price list is empty");
    try {
      const n = await savePriceList(rows);
      return json({ ok: `Price list saved: ${n} products. New orders use these prices.`, error: null });
    } catch (e) {
      return fail(e instanceof Error ? e.message : "Couldn't save the price list");
    }
  }

  if (intent === "rto") {
    try {
      const u = await markRto(s("orderId"), admin.email || "admin");
      return json({ ok: u ? `Marked RTO. ${rupees(u.rtoPaise ?? 0)} taken from the wallet.` : "Already marked", error: null });
    } catch (e) {
      return fail(e instanceof Error ? e.message : "Couldn't mark RTO");
    }
  }

  if (intent === "fulfilNow") {
    const [row] = await db.update(dropshipOrders).set({ fulfilAfter: new Date() })
      .where(and(eq(dropshipOrders.orderId, s("orderId")), eq(dropshipOrders.status, "charged"))).returning();
    if (!row) return fail("This order isn't waiting to be fulfilled");
    const u = await fulfilDropship(row);
    if (u?.status === "fulfilled") return json({ ok: `Fulfilled in Shopify with tracking ${u.trackingNumber}`, error: null });
    if (u?.status === "cancelled") return json({ ok: "The order was cancelled in Shopify, so it was refunded instead", error: null });
    const [after] = await db.select({ error: dropshipOrders.error }).from(dropshipOrders).where(eq(dropshipOrders.orderId, row.orderId));
    return fail(after?.error ?? "Couldn't fulfil. It will retry automatically.");
  }

  if (intent === "seen") {
    await db.update(dropshipOrders).set({ alertSeen: true }).where(eq(dropshipOrders.orderId, s("orderId")));
    return json({ ok: null, error: null });
  }
  if (intent === "seenAll") {
    await db.update(dropshipOrders).set({ alertSeen: true }).where(eq(dropshipOrders.alertSeen, false));
    return json({ ok: "All alerts cleared", error: null });
  }
  return fail("Unknown action");
}

type D = ReturnType<typeof useLoaderData<typeof loader>>;

const STATUS_CHIP: Record<DropshipStatus, string> = {
  charged: "bg-amber-50 text-amber-800", fulfilled: "bg-emerald-50 text-good", cancelled: "bg-paper-sunk text-ink-soft", rto: "bg-red-50 text-bad",
};

const when = (d: string | Date | null) => (d ? new Date(d).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) : "—");

export default function Dropship() {
  const d = useLoaderData<typeof loader>();
  const res = useActionData<typeof action>();
  const enabled = d.stores.filter((s) => s.enabled).length;
  return (
    <>
      <PageHeader title="Dropshipping" description="Shipnex ships prepaid orders for the stores you turn on. Only you can see this page." />
      <div className="space-y-5">
        {res?.ok && <Notice tone="success">{res.ok}</Notice>}
        {res?.error && <Notice tone="error">{res.error}</Notice>}

        <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
          <Stat label="Stores on dropshipping" value={String(enabled)} sub={`of ${d.stores.length} stores`} />
          <Stat label="Waiting to fulfil" value={String(d.counts.waiting)} sub="Marked fulfilled 8 h after the order" />
          <Stat label="Fulfilled" value={String(d.counts.fulfilled)} sub={`${d.counts.cancelled} cancelled`} />
          <Stat label="RTO" value={String(d.counts.rto)} sub="Marked by you" />
        </div>

        {d.alerts.length > 0 && <Alerts alerts={d.alerts} />}

        <section className="panel">
          <div className="border-b border-rule px-5 py-4">
            <h2 className="text-[15px] font-semibold">Stores</h2>
            <p className="mt-0.5 text-xs text-ink-faint">Only prepaid orders are dropshipped. COD and Partial COD stay with the store's own courier. A dropshipping store stops taking orders once its wallet goes below the limit.</p>
          </div>
          <ul className="divide-y divide-rule">
            {d.stores.map((s) => <StoreRow key={s.id} s={s} />)}
          </ul>
        </section>

        <Orders orders={d.orders} />

        <div className="grid gap-5 lg:grid-cols-[1fr_1.4fr]">
          <Zones zones={d.zones} />
          <PriceList skus={d.skus} />
        </div>
      </div>
    </>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="panel min-w-0 p-4">
      <p className="truncate text-xs font-medium text-ink-soft">{label}</p>
      <p className="num mt-2 text-xl font-semibold">{value}</p>
      <p className="mt-1 truncate text-xs text-ink-faint">{sub}</p>
    </div>
  );
}

function Alerts({ alerts }: { alerts: D["alerts"] }) {
  return (
    <section className="panel border-red-200">
      <div className="flex flex-wrap items-center gap-2 border-b border-rule bg-red-50/60 px-5 py-3">
        <h2 className="mr-auto text-[15px] font-semibold text-bad">SKU missing · {alerts.length} order{alerts.length === 1 ? "" : "s"}</h2>
        <Form method="post"><input type="hidden" name="intent" value="seenAll" /><button className="btn-quiet text-xs">Clear all</button></Form>
      </div>
      <p className="px-5 pt-3 text-xs text-ink-soft">These items weren't in the price list, so nothing was charged for them. Add the SKU to the price list, and charge this order from the store's wallet page (Debit by admin) if needed.</p>
      <ul className="divide-y divide-rule">
        {alerts.map((a) => (
          <li key={a.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3 text-sm">
            <span className="font-medium">{a.name ?? a.id}</span>
            <span className="text-ink-soft">{a.store}</span>
            <span className="text-xs text-ink-faint">{when(a.createdAt)}</span>
            <span className="flex flex-wrap gap-1">{a.missing.map((m) => <code key={m} className="rounded bg-red-50 px-1.5 py-0.5 text-xs text-bad">{m}</code>)}</span>
            <Form method="post" className="ml-auto"><input type="hidden" name="intent" value="seen" /><input type="hidden" name="orderId" value={a.id} /><button className="btn-quiet text-xs">Got it</button></Form>
          </li>
        ))}
      </ul>
    </section>
  );
}

const priceText = (p: Record<string, number>) => Object.entries(p).map(([k, v]) => `${k}, ${(v / 100).toString()}`).join("\n");

function StoreRow({ s }: { s: D["stores"][number] }) {
  const [on, setOn] = useState(s.enabled);
  const [open, setOpen] = useState(false);
  const custom = Object.keys(s.prices).length;
  return (
    <li className="px-5 py-4">
      <Form method="post" className="space-y-3">
        <input type="hidden" name="intent" value="store" />
        <input type="hidden" name="storeId" value={s.id} />
        <div className="flex flex-wrap items-center gap-3">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-rule bg-surface text-xs font-semibold">{s.logoUrl ? <img src={s.logoUrl} alt="" className="h-full w-full object-contain p-0.5" /> : s.name.slice(0, 1)}</span>
          <span className="min-w-0 flex-1">
            <span className="block truncate font-medium">{s.name}</span>
            <span className={`num text-xs ${s.balance < -s.limit ? "font-semibold text-bad" : "text-ink-faint"}`}>
              Wallet {rupees(s.balance)}{s.balance < -s.limit ? " · past the limit, checkout is closed" : ""}
            </span>
          </span>
          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <input type="checkbox" name="enabled" checked={on} onChange={(e) => setOn(e.target.checked)} className="peer sr-only" />
            <span aria-hidden className={`relative h-6 w-10 shrink-0 rounded-full transition peer-focus-visible:ring-2 peer-focus-visible:ring-brand ${on ? "bg-brand" : "bg-rule-strong"}`}>
              <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${on ? "left-[18px]" : "left-0.5"}`} />
            </span>
            <span className={on ? "font-medium text-ink" : "text-ink-soft"}>{on ? "Dropshipping on" : "Off"}</span>
          </label>
        </div>
        <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
          <label className="block">
            <span className="label">Wallet can go down to (₹ below 0)</span>
            <input name="limit" inputMode="decimal" className="input" defaultValue={s.limit / 100} />
          </label>
          <label className="block">
            <span className="label">RTO charge (₹)</span>
            <input name="rto" inputMode="decimal" className="input" defaultValue={s.rtoPaise == null ? "" : s.rtoPaise / 100} placeholder="Same as the order's shipping" />
          </label>
          <SubmitButton className="btn-primary" busyText="Saving">Save</SubmitButton>
        </div>
        <div>
          <button type="button" onClick={() => setOpen((o) => !o)} className="text-xs font-medium text-brand underline-offset-2 hover:underline" aria-expanded={open}>
            {custom ? `Own prices for ${custom} SKU${custom === 1 ? "" : "s"}` : "Set own prices for this store"} {open ? "▴" : "▾"}
          </button>
          <div className={open ? "mt-2" : "hidden"}>
            <textarea name="prices" rows={4} className="input font-mono text-[13px]" defaultValue={priceText(s.prices)} placeholder={"VIX-001-SMT, 22\nSON-016-EBD, 15"} />
            <span className="hint">One per line: SKU, price in ₹. These replace the default price for this store only. Leave empty to use the default list.</span>
          </div>
        </div>
      </Form>
    </li>
  );
}

function Orders({ orders }: { orders: D["orders"] }) {
  const nav = useNavigation();
  const busy = (id: string) => nav.state !== "idle" && nav.formData?.get("orderId") === id;
  return (
    <section className="panel">
      <div className="border-b border-rule px-5 py-4">
        <h2 className="text-[15px] font-semibold">Dropship orders</h2>
        <p className="mt-0.5 text-xs text-ink-faint">Packing is ₹4 per unit. Before fulfilment: product + packing + shipping go back to the wallet. Within 24 h after fulfilment: product + packing. Later: nothing.</p>
      </div>
      {orders.length === 0 ? (
        <p className="px-5 py-8 text-center text-sm text-ink-faint">No dropship orders yet. They show up here when a prepaid order is paid on a dropshipping store.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="table min-w-[920px]">
            <thead><tr><th>Order</th><th>Store</th><th>Deliver to</th><th>Items</th><th className="text-right">Product</th><th className="text-right">Shipping</th><th className="text-right">Packing</th><th>Status</th><th /></tr></thead>
            <tbody>
              {orders.map((o) => (
                <tr key={o.id}>
                  <td><span className="font-medium">{o.name ?? o.id}</span><span className="block text-xs text-ink-faint">{when(o.createdAt)}</span></td>
                  <td className="text-sm">{o.store}</td>
                  <td className="text-sm">{o.city} {o.pincode}<span className="block text-xs text-ink-faint">Zone {o.zone}</span></td>
                  <td className="max-w-[240px] text-xs">
                    {o.lines.map((l, i) => (
                      <span key={i} className="block truncate">{l.quantity} × {l.sku ?? <em className="text-bad">no SKU</em>} {l.unitPaise == null && <span className="text-bad">· not in list</span>}</span>
                    ))}
                  </td>
                  <td className="num text-right text-sm">{rupees(o.product)}</td>
                  <td className="num text-right text-sm">{rupees(o.shipping)}{o.rto ? <span className="block text-xs text-bad">RTO {rupees(o.rto)}</span> : null}</td>
                  <td className="num text-right text-sm">{rupees(o.packing)}</td>
                  <td>
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_CHIP[o.status]}`}>{STATUS_LABEL[o.status]}</span>
                    {o.status === "charged" && <span className="mt-1 block text-[11px] text-ink-faint">at {when(o.fulfilAfter)}</span>}
                    {o.tracking && <span className="mt-1 block font-mono text-[11px] text-ink-soft">{o.tracking}</span>}
                    {o.refund > 0 && <span className="mt-1 block text-[11px] text-good">Refunded {rupees(o.refund)}</span>}
                    {o.error && o.status === "charged" && <span className="mt-1 block max-w-[220px] text-[11px] text-bad">{o.error}</span>}
                  </td>
                  <td className="text-right">
                    {o.status === "charged" && (
                      <Form method="post"><input type="hidden" name="intent" value="fulfilNow" /><input type="hidden" name="orderId" value={o.id} />
                        <button className="btn-quiet whitespace-nowrap text-xs" disabled={busy(o.id)}>{busy(o.id) ? "Fulfilling…" : "Fulfil now"}</button></Form>
                    )}
                    {o.status === "fulfilled" && (
                      <Form method="post" onSubmit={(e) => { if (!confirm(`Mark ${o.name ?? o.id} as RTO? The RTO charge comes out of the store's wallet.`)) e.preventDefault(); }}>
                        <input type="hidden" name="intent" value="rto" /><input type="hidden" name="orderId" value={o.id} />
                        <button className="btn-quiet whitespace-nowrap text-xs text-bad" disabled={busy(o.id)}>Mark RTO</button>
                      </Form>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function Zones({ zones }: { zones: D["zones"] }) {
  return (
    <section className="panel">
      <div className="border-b border-rule px-5 py-4">
        <h2 className="text-[15px] font-semibold">Shipping by zone</h2>
        <p className="mt-0.5 text-xs text-ink-faint">From the Gurugram warehouse. Charged once per order, from the customer's pincode and state.</p>
      </div>
      <Form method="post" className="space-y-3 p-5">
        <input type="hidden" name="intent" value="zones" />
        {ZONES.map((z) => (
          <label key={z.id} className="grid grid-cols-[1fr_110px] items-center gap-3">
            <span><span className="block text-sm font-medium">{z.label}</span><span className="block text-xs text-ink-faint">{z.hint}</span></span>
            <span className="relative"><span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-ink-faint">₹</span>
              <input name={`zone${z.id}`} inputMode="decimal" className="input pl-7 text-right" defaultValue={zones[z.id as Zone] / 100} /></span>
          </label>
        ))}
        <div className="pt-1"><SubmitButton className="btn-primary" busyText="Saving">Save shipping charges</SubmitButton></div>
      </Form>
    </section>
  );
}

function PriceList({ skus }: { skus: D["skus"] }) {
  const [edit, setEdit] = useState(false);
  const [q, setQ] = useState("");
  const shown = skus.filter((s) => !q || `${s.sku} ${s.name}`.toLowerCase().includes(q.toLowerCase()));
  return (
    <section className="panel">
      <div className="flex flex-wrap items-center gap-2 border-b border-rule px-5 py-4">
        <div className="mr-auto">
          <h2 className="text-[15px] font-semibold">Price list · {skus.length} products</h2>
          <p className="mt-0.5 text-xs text-ink-faint">Default price for every store, GST included. Orders match the first 9 characters of the SKU, so SSP-052-SST-2 uses SSP-052-SST.</p>
        </div>
        <button type="button" onClick={() => setEdit((e) => !e)} className="btn-secondary text-sm">{edit ? "Cancel" : "Edit list"}</button>
      </div>
      {edit ? (
        <Form method="post" className="space-y-3 p-5">
          <input type="hidden" name="intent" value="prices" />
          <textarea name="list" rows={18} className="input font-mono text-[12.5px] leading-relaxed" defaultValue={skus.map((s) => `${s.sku}, ${s.name}, ${s.price / 100}`).join("\n")} />
          <p className="hint">One product per line: SKU, name, price in ₹. You can also paste the table from a sheet (#, Product, SKU, Price). Saving replaces the whole list.</p>
          <SubmitButton className="btn-primary" busyText="Saving">Save price list</SubmitButton>
        </Form>
      ) : (
        <>
          <div className="px-5 pt-3"><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search SKU or product" className="input h-9 text-sm" /></div>
          <div className="max-h-[420px] overflow-y-auto">
            <table className="table">
              <thead><tr><th>SKU</th><th>Product</th><th className="text-right">Price</th></tr></thead>
              <tbody>
                {shown.map((s) => (
                  <tr key={s.sku}><td className="font-mono text-xs">{s.sku}</td><td className="text-sm">{s.name}</td><td className="num text-right text-sm">{rupees(s.price, 0)}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}
