// Admin → store → Checkout diagnostics: where and why customers drop out of the Growpefy checkout.
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Form, useActionData, useLoaderData, useSearchParams } from "@remix-run/react";
import { Notice, SubmitButton } from "~/components/ui";
import { requireStore, requireViewer } from "~/lib/auth.server";
import { diagnostics, recheckOnline } from "~/lib/diagnostics.server";
import { formatINR } from "~/lib/pricing";

const DAYS = [1, 3, 7, 14, 30];
const daysOf = (sp: URLSearchParams) => { const d = Number(sp.get("days")); return DAYS.includes(d) ? d : 7; };

export async function loader({ request, params }: LoaderFunctionArgs) {
  const viewer = await requireViewer(request);
  if (viewer.role !== "admin") throw new Response("Not found", { status: 404 });
  const store = await requireStore(viewer, params.id);
  const days = daysOf(new URL(request.url).searchParams);
  return json({ name: store.name, days, d: await diagnostics(store, days) });
}

export async function action({ request, params }: ActionFunctionArgs) {
  const viewer = await requireViewer(request);
  if (viewer.role !== "admin") throw new Response("Not found", { status: 404 });
  const store = await requireStore(viewer, params.id);
  const r = await recheckOnline(store, daysOf(new URL(request.url).searchParams));
  return json({ ok: `Checked ${r.checked} unpaid online order${r.checked === 1 ? "" : "s"} with the gateway.${r.paid ? ` ${r.paid} turned out to be PAID and are now real orders.` : ""} The table below shows what the gateway said.` });
}

const when = (iso: string) => new Date(iso).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : "—");
const EV: Record<string, string> = {
  load: "Opened", step: "Step", submit: "Pressed Pay / Place", error: "Error shown", to_pay: "Sent to payment", hidden: "Left the page", visible: "Came back",
  js_error: "Script error", pay_page: "Payment page", pay_hidden: "Left for gateway", pay_visible: "Back on payment page", pay_back: "Pressed back from gateway", pay_error: "Payment couldn't start", otp_sent: "OTP sent", otp_error: "OTP error",
};

export default function Diagnostics() {
  const { name, days, d } = useLoaderData<typeof loader>();
  const a = useActionData<typeof action>();
  const [sp, setSp] = useSearchParams();
  const b = d.browser;
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[22px] font-semibold leading-tight tracking-tight">Checkout diagnostics</h1>
          <p className="mt-1 text-sm text-ink-soft">{name} · why customers who open the checkout don't end up with an order</p>
        </div>
        <div className="flex rounded-lg bg-paper-sunk p-0.5 text-xs font-medium">
          {DAYS.map((n) => <button key={n} type="button" onClick={() => { const p = new URLSearchParams(sp); p.set("days", String(n)); setSp(p, { replace: true }); }} className={`rounded-md px-3 py-1.5 ${days === n ? "bg-white text-ink shadow-sm" : "text-ink-soft"}`}>{n === 1 ? "24 h" : `${n} days`}</button>)}
        </div>
      </div>

      {a?.ok && <Notice tone="success">{a.ok}</Notice>}
      {d.warnings.map((w) => <Notice key={w} tone="warning">{w}</Notice>)}

      {/* Online payments: what the gateway says */}
      <section className="panel">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-rule px-5 py-4">
          <div>
            <h2 className="text-[15px] font-semibold">Online payments: what the gateway says</h2>
            <p className="mt-0.5 text-xs text-ink-faint">Every “Pay online” order in this period. Press the button to ask {d.gateways.map((g) => g.id.toUpperCase()).join(" / ") || "the gateway"} about each unpaid one. Any that were actually paid become real orders.</p>
          </div>
          <Form method="post"><SubmitButton className="btn-primary" busyText="Checking with the gateway">Check unpaid with the gateway</SubmitButton></Form>
        </div>
        {d.outcomes.length > 0 && (
          <div className="flex flex-wrap gap-2 border-b border-rule px-5 py-3">
            {d.outcomes.map((o) => (
              <span key={o.key} className={`rounded-full px-3 py-1 text-xs font-medium ${o.key === "paid" ? "bg-emerald-50 text-good" : o.key === "unknown" ? "bg-paper-sunk text-ink-soft" : "bg-amber-50 text-amber-800"}`}>
                {o.label}: <b className="num">{o.n}</b> ({pct(o.n, d.payments.length)})
              </span>
            ))}
          </div>
        )}
        {d.payments.length === 0 ? <p className="px-5 py-8 text-center text-sm text-ink-faint">No online-payment orders in this period.</p> : (
          <div className="scroll-thin max-h-[560px] overflow-auto">
            <table className="table min-w-[900px]">
              <thead><tr><th>Time</th><th>Customer</th><th className="text-right">Amount</th><th>Device</th><th>Payment page</th><th>What happened</th><th>Gateway details</th></tr></thead>
              <tbody>
                {d.payments.map((p) => (
                  <tr key={p.id}>
                    <td className="whitespace-nowrap text-xs">{when(p.at)}</td>
                    <td className="num text-xs">{p.phone}</td>
                    <td className="num text-right">{formatINR(p.amount)}</td>
                    <td className="text-xs">{p.device}</td>
                    <td className="text-xs">{p.payPages ? `Opened${p.payPages > 1 ? ` ${p.payPages}×` : ""}${p.cameBack ? ` · pressed back ${p.cameBack}×` : ""}` : <span className="text-ink-faint">no signal</span>}</td>
                    <td className={`text-xs font-medium ${p.outcome.key === "paid" ? "text-good" : p.outcome.key === "unknown" ? "text-ink-soft" : "text-amber-800"}`}>{p.outcome.label}</td>
                    <td className="max-w-[280px] truncate text-[11px] text-ink-faint" title={p.detail ? JSON.stringify(p.detail) : ""}>{p.detail ? Object.entries(p.detail).filter(([k]) => k !== "txn").map(([k, v]) => `${k}: ${v}`).join(" · ") : p.error ?? ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* By device */}
      <section className="panel">
        <div className="border-b border-rule px-5 py-4">
          <h2 className="text-[15px] font-semibold">By device and app</h2>
          <p className="mt-0.5 text-xs text-ink-faint">{d.sessions} checkouts. Instagram / Facebook app = customers who came from an ad and opened the checkout inside the app.</p>
        </div>
        <div className="scroll-thin overflow-x-auto">
          <table className="table min-w-[720px]">
            <thead><tr><th>Device</th><th className="text-right">Checkouts</th><th className="text-right">Mobile</th><th className="text-right">Address</th><th className="text-right">Pressed Pay</th><th className="text-right">Orders</th><th className="text-right">Of which online</th><th className="text-right">Conversion</th></tr></thead>
            <tbody>
              {d.devices.map((r) => (
                <tr key={r.label}>
                  <td className="text-sm">{r.label}</td>
                  <td className="num text-right">{r.sessions}</td>
                  <td className="num text-right">{r.phone} <span className="text-xs text-ink-faint">{pct(r.phone, r.sessions)}</span></td>
                  <td className="num text-right">{r.address}</td>
                  <td className="num text-right">{r.tried}</td>
                  <td className="num text-right font-semibold">{r.orders}</td>
                  <td className="num text-right">{r.prepaid}</td>
                  <td className={`num text-right ${r.sessions >= 10 && r.orders / r.sessions < 0.03 ? "font-semibold text-bad" : ""}`}>{pct(r.orders, r.sessions)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Browser signals */}
      <section className="panel p-5">
        <h2 className="text-[15px] font-semibold">What customers' phones reported</h2>
        <p className="mt-0.5 text-xs text-ink-faint">Collected from the checkout and payment pages (new: only checkouts opened after this was switched on).</p>
        <dl className="mt-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
          {([["Checkouts tracked", b.tracked], ["Pressed Pay / Place", b.submitted], ["Sent to payment", b.toPay], ["Payment page opened", b.payPage], ["Pressed back from gateway", b.payBack], ["Payment couldn't start", b.payError]] as const).map(([k, v]) => (
            <div key={k} className="rounded-xl bg-paper px-3 py-2.5"><dt className="text-xs text-ink-soft">{k}</dt><dd className="num text-lg font-semibold">{v}</dd></div>
          ))}
        </dl>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <List title="Errors customers saw" rows={b.errors} empty="None" />
          <List title="Script errors on the page" rows={b.jsErrors} empty="None" />
        </div>
      </section>

      {/* Recent checkouts */}
      <section className="panel">
        <h2 className="border-b border-rule px-5 py-4 text-[15px] font-semibold">Recent checkouts, step by step</h2>
        {d.recent.length === 0 ? <p className="px-5 py-8 text-center text-sm text-ink-faint">Nothing tracked yet. New checkouts show here within a minute.</p> : (
          <ul className="divide-y divide-rule">
            {d.recent.map((s) => (
              <li key={s.id} className="px-5 py-3">
                <p className="flex flex-wrap items-center gap-2 text-xs">
                  <b>{when(s.at)}</b><span className="text-ink-soft">{s.device}</span>
                  {s.order ? <span className="rounded-full bg-emerald-50 px-2 py-0.5 font-medium text-good">Order placed ({s.order.method === "cod" ? "COD" : "online"})</span> : <span className="rounded-full bg-paper-sunk px-2 py-0.5 text-ink-soft">No order</span>}
                </p>
                <p className="mt-1.5 flex flex-wrap gap-1">
                  {s.events.map((e, i) => (
                    <span key={i} title={e.data ? JSON.stringify(e.data) : ""} className={`rounded px-1.5 py-0.5 text-[11px] ${/error/.test(e.type) || e.type === "pay_back" ? "bg-red-50 text-bad" : e.type.startsWith("pay") || e.type === "to_pay" ? "bg-sky-50 text-sky-800" : "bg-paper-sunk text-ink-soft"}`}>
                      {EV[e.type] ?? e.type}{e.type === "step" && e.data ? ` ${(e.data as { step?: number }).step}` : ""}{e.type === "error" && e.data && (e.data as { form?: string }).form ? `: ${(e.data as { form?: string }).form}` : ""}
                    </span>
                  ))}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function List({ title, rows, empty }: { title: string; rows: [string, number][]; empty: string }) {
  return (
    <div className="rounded-xl border border-rule p-3">
      <p className="text-xs font-semibold">{title}</p>
      {rows.length ? <ul className="mt-2 space-y-1 text-xs">{rows.map(([m, n]) => <li key={m} className="flex justify-between gap-3"><span className="text-ink-soft">{m}</span><b className="num">{n}</b></li>)}</ul> : <p className="mt-2 text-xs text-ink-faint">{empty}</p>}
    </div>
  );
}
