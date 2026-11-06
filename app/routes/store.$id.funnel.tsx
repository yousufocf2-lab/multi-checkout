import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { sql } from "drizzle-orm";
import { RangePicker } from "~/components/Overview";
import { db } from "~/db.server";
import { requireStore, requireViewer } from "~/lib/auth.server";
import { addDays, resolveRange } from "~/lib/dates";

/**
 * Where customers drop off in the Growpefy checkout, day by day:
 * checkout clicked → page opened → mobile number → address → tried to pay → order placed.
 * Also: Instagram / Facebook in-app browsers vs others, and online payments started vs completed.
 */
export async function loader({ request, params }: LoaderFunctionArgs) {
  const viewer = await requireViewer(request);
  const store = await requireStore(viewer, params.id);
  const sp = new URL(request.url).searchParams;
  if (!sp.has("range")) sp.set("range", "30d");
  const range = resolveRange(sp, store.createdAt.toISOString().slice(0, 10));
  // ISO strings: raw SQL parameters can't be Date objects
  const from = new Date(`${range.since}T00:00:00+05:30`).toISOString();
  const to = new Date(`${addDays(range.until, 1)}T00:00:00+05:30`).toISOString();

  type Row = {
    d: string; sessions: number; opened: number; phone: number; addr: number; tried: number;
    orders: number; cod: number; prepaid: number; partial: number; online_started: number; online_failed: number;
    inapp: number; inapp_orders: number; own_domain: number; native: number;
  };
  const rows = (await db.execute<Row>(sql`
    with s as (
      select id,
        to_char(created_at at time zone 'Asia/Kolkata', 'YYYY-MM-DD') as d,
        cart_snapshot is not null as opened,
        coalesce(customer->>'phone', '') <> '' as phone,
        coalesce(customer->>'address1', '') <> '' as addr,
        payment_attempted as tried,
        coalesce(tracking->>'ua', '') ~* '(Instagram|FBAN|FBAV|FB_IAB|FBIOS|FB4A)' as inapp
      from checkout_sessions
      where store_id = ${store.id} and created_at >= ${from}::timestamptz and created_at < ${to}::timestamptz
    ),
    o as (
      select session_id, id, status, payment_method, tracking->>'proxyOrigin' as proxy
      from orders where store_id = ${store.id} and created_at >= ${from}::timestamptz and created_at < ${to}::timestamptz and session_id is not null
    ),
    per as (
      select s.*,
        bool_or(o.status in ('paid', 'cod_placed')) as ordered,
        bool_or(o.status in ('paid', 'cod_placed') and o.payment_method = 'cod') as cod,
        bool_or(o.status in ('paid', 'cod_placed') and o.payment_method = 'prepaid') as prepaid,
        bool_or(o.status in ('paid', 'cod_placed') and o.payment_method = 'partial') as partial,
        bool_or(o.payment_method in ('prepaid', 'partial')) as online_started,
        bool_or(o.payment_method in ('prepaid', 'partial') and o.status in ('failed', 'pending_payment')) and not bool_or(o.status in ('paid', 'cod_placed')) as online_failed,
        bool_or(o.status in ('paid', 'cod_placed') and o.proxy is not null) as own_domain
      from s left join o on o.session_id = s.id
      group by s.id, s.d, s.opened, s.phone, s.addr, s.tried, s.inapp
    )
    select d,
      count(*)::int as sessions,
      count(*) filter (where opened)::int as opened,
      count(*) filter (where phone)::int as phone,
      count(*) filter (where addr)::int as addr,
      count(*) filter (where tried)::int as tried,
      count(*) filter (where ordered)::int as orders,
      count(*) filter (where cod)::int as cod,
      count(*) filter (where prepaid)::int as prepaid,
      count(*) filter (where partial)::int as partial,
      count(*) filter (where online_started)::int as online_started,
      count(*) filter (where online_failed)::int as online_failed,
      count(*) filter (where inapp)::int as inapp,
      count(*) filter (where inapp and ordered)::int as inapp_orders,
      count(*) filter (where own_domain)::int as own_domain,
      0 as native
    from per group by d order by d`)) as unknown as Row[];

  // Orders on the store's own Shopify checkout (profit-dashboard stores) for comparison
  const native = store.profitEnabled ? (await db.execute<{ d: string; n: number }>(sql`
    select to_char(created_at at time zone 'Asia/Kolkata', 'YYYY-MM-DD') as d, count(*)::int as n
    from shopify_native_orders where store_id = ${store.id} and not cancelled and created_at >= ${from}::timestamptz and created_at < ${to}::timestamptz
    group by 1`)) as unknown as { d: string; n: number }[] : [];
  const byDay = new Map(rows.map((r) => [r.d, r]));
  for (const n of native) {
    const r = byDay.get(n.d);
    if (r) r.native = Number(n.n);
    else byDay.set(n.d, { d: n.d, sessions: 0, opened: 0, phone: 0, addr: 0, tried: 0, orders: 0, cod: 0, prepaid: 0, partial: 0, online_started: 0, online_failed: 0, inapp: 0, inapp_orders: 0, own_domain: 0, native: Number(n.n) });
  }
  const days = [...byDay.values()].map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, k === "d" ? v : Number(v)])) as Row).sort((a, b) => a.d.localeCompare(b.d));
  const total = days.reduce((t, r) => {
    for (const k of Object.keys(t) as (keyof Omit<Row, "d">)[]) t[k] += r[k];
    return t;
  }, { sessions: 0, opened: 0, phone: 0, addr: 0, tried: 0, orders: 0, cod: 0, prepaid: 0, partial: 0, online_started: 0, online_failed: 0, inapp: 0, inapp_orders: 0, own_domain: 0, native: 0 });
  return json({ name: store.name, range, days, total, profit: store.profitEnabled });
}

const pct = (a: number, b: number) => (b ? `${((a / b) * 100).toFixed(a / b < 0.1 ? 1 : 0)}%` : "—");
const dayLabel = (d: string) => new Date(`${d}T12:00:00+05:30`).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short" });

export default function Funnel() {
  const { name, range, days, total: t, profit } = useLoaderData<typeof loader>();
  const steps = [
    { label: "Clicked checkout", n: t.sessions, hint: "Buy now or Checkout pressed on the store" },
    { label: "Checkout page opened", n: t.opened, hint: "The checkout page loaded" },
    { label: "Mobile number entered", n: t.phone, hint: "" },
    { label: "Address filled", n: t.addr, hint: "" },
    { label: "Tried to place the order", n: t.tried, hint: "Pressed Pay / Place order" },
    { label: "Order placed", n: t.orders, hint: `${t.cod} COD · ${t.prepaid} online · ${t.partial} partial COD` },
  ];
  const other = t.sessions - t.inapp, otherOrders = t.orders - t.inapp_orders;
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[22px] font-semibold leading-tight tracking-tight">Checkout funnel</h1>
          <p className="mt-1 text-sm text-ink-soft">{name} · where customers drop off in the Growpefy checkout</p>
        </div>
        <RangePicker current={range} align="right" />
      </div>

      <section className="panel p-5">
        <ol className="space-y-3">
          {steps.map((s, i) => {
            const prev = i ? steps[i - 1].n : s.n;
            const w = t.sessions ? Math.max(2, (s.n / t.sessions) * 100) : 0;
            const drop = i && prev ? 1 - s.n / prev : 0;
            return (
              <li key={s.label}>
                <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
                  <span className="font-medium">{s.label}{s.hint && <span className="ml-2 text-xs font-normal text-ink-faint">{s.hint}</span>}</span>
                  <span className="num text-ink-soft"><b className="text-ink">{s.n.toLocaleString("en-IN")}</b> · {pct(s.n, t.sessions)} of clicks{i > 0 && <span className={drop > 0.4 ? "ml-2 font-semibold text-bad" : "ml-2"}>({drop > 0 ? "−" : ""}{(drop * 100).toFixed(0)}% from previous step)</span>}</span>
                </div>
                <div className="mt-1.5 h-3 overflow-hidden rounded-full bg-paper-sunk"><div className={`h-full rounded-full ${i === steps.length - 1 ? "bg-pine" : "bg-sky-500"}`} style={{ width: `${w}%` }} /></div>
              </li>
            );
          })}
        </ol>
      </section>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <Card title="Instagram / Facebook app" lines={[["Checkouts", t.inapp.toLocaleString("en-IN")], ["Orders", t.inapp_orders.toLocaleString("en-IN")], ["Conversion", pct(t.inapp_orders, t.inapp)]]} />
        <Card title="Other browsers" lines={[["Checkouts", other.toLocaleString("en-IN")], ["Orders", otherOrders.toLocaleString("en-IN")], ["Conversion", pct(otherOrders, other)]]} />
        <Card title="Online payment" lines={[["Started", t.online_started.toLocaleString("en-IN")], ["Completed", (t.prepaid + t.partial).toLocaleString("en-IN")], ["Not completed", `${t.online_failed} (${pct(t.online_failed, t.online_started)})`]]} />
      </div>

      <section className="panel">
        <div className="border-b border-rule px-5 py-4">
          <h2 className="text-[15px] font-semibold">Day by day</h2>
          <p className="mt-0.5 text-xs text-ink-faint">“Own site” = orders placed with the checkout on the store's own domain.{profit ? " “Shopify checkout” = orders on the store's own Shopify checkout." : ""}</p>
        </div>
        <div className="scroll-thin overflow-x-auto">
          <table className="table min-w-[980px]">
            <thead><tr>
              <th>Date</th><th className="text-right">Clicks</th><th className="text-right">Opened</th><th className="text-right">Mobile</th><th className="text-right">Address</th>
              <th className="text-right">Tried</th><th className="text-right">Orders</th><th className="text-right">Conversion</th><th className="text-right">COD / online</th>
              <th className="text-right">Online not done</th><th className="text-right">In-app conv.</th><th className="text-right">Own site</th>{profit && <th className="text-right">Shopify checkout</th>}
            </tr></thead>
            <tbody>
              {days.slice().reverse().map((r) => (
                <tr key={r.d}>
                  <td className="whitespace-nowrap">{dayLabel(r.d)}</td>
                  <td className="num text-right">{r.sessions}</td>
                  <td className="num text-right">{r.opened} <span className="text-xs text-ink-faint">{pct(r.opened, r.sessions)}</span></td>
                  <td className="num text-right">{r.phone}</td>
                  <td className="num text-right">{r.addr}</td>
                  <td className="num text-right">{r.tried}</td>
                  <td className="num text-right font-semibold">{r.orders}</td>
                  <td className={`num text-right ${r.sessions >= 10 && r.orders / r.sessions < 0.05 ? "text-bad" : ""}`}>{pct(r.orders, r.sessions)}</td>
                  <td className="num text-right">{r.cod} / {r.prepaid + r.partial}</td>
                  <td className="num text-right">{r.online_failed ? <span className="text-bad">{r.online_failed}</span> : 0}</td>
                  <td className="num text-right">{pct(r.inapp_orders, r.inapp)}</td>
                  <td className="num text-right">{r.own_domain}</td>
                  {profit && <td className="num text-right">{r.native}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!days.length && <p className="px-5 py-8 text-center text-sm text-ink-faint">No checkouts in this period.</p>}
      </section>
    </div>
  );
}

function Card({ title, lines }: { title: string; lines: [string, string][] }) {
  return (
    <section className="panel p-4">
      <h2 className="text-sm font-semibold">{title}</h2>
      <dl className="mt-3 space-y-1.5 text-sm">
        {lines.map(([k, v]) => <div key={k} className="flex justify-between gap-3"><dt className="text-ink-soft">{k}</dt><dd className="num font-semibold">{v}</dd></div>)}
      </dl>
    </section>
  );
}
