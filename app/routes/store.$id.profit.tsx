import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Form, useActionData, useLoaderData } from "@remix-run/react";
import { and, desc, eq, gte, lte, or } from "drizzle-orm";
import { useState } from "react";
import { Icon, type IconName } from "~/components/Icons";
import { RangePicker } from "~/components/Overview";
import { Notice, SubmitButton } from "~/components/ui";
import { db, profitPayments } from "~/db.server";
import { requireStore, requireViewer } from "~/lib/auth.server";
import { resolveRange } from "~/lib/dates";
import { confirmProfitPayment, createProfitPayment, PAYMENT_REPLY_DAYS, profitReport } from "~/lib/profit.server";
import { compactINR } from "~/lib/pricing";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const viewer = await requireViewer(request);
  const store = await requireStore(viewer, params.id);
  if (!store.profitEnabled && viewer.role !== "admin") throw new Response("Not found", { status: 404 });
  const raw = await profitReport(store);
  const sp = new URL(request.url).searchParams;
  if (!sp.has("range")) sp.set("range", "max"); // the whole partnership by default
  const r = resolveRange(sp, raw.since);
  const range = { ...r, since: r.since < raw.since ? raw.since : r.since };
  const admin = viewer.role === "admin";

  const rows = raw.rows.filter((x) => x.day >= range.since && x.day <= range.until);
  const sum = (k: "orders" | "revenue" | "settlement" | "adCostWithGst" | "dropship" | "payments" | "net") => rows.reduce((n, x) => n + x[k], 0);
  const inRange = { orders: sum("orders"), revenue: sum("revenue"), settlement: sum("settlement"), ads: sum("adCostWithGst"), dropship: sum("dropship"), payments: sum("payments"), net: sum("net") };
  const t = raw.totals;
  const share = store.profitShareBps / 100;

  const payments = await db.select().from(profitPayments)
    .where(and(eq(profitPayments.storeId, store.id), or(
      eq(profitPayments.status, "pending"),
      and(eq(profitPayments.status, "rejected"), gte(profitPayments.paymentDate, range.since), lte(profitPayments.paymentDate, range.until)),
      and(eq(profitPayments.status, "confirmed"), gte(profitPayments.paymentDate, range.since), lte(profitPayments.paymentDate, range.until)),
    )))
    .orderBy(desc(profitPayments.createdAt)).limit(100);
  const canManage = viewer.role === "owner" || (admin && !viewer.staff);

  return json({
    name: store.name, admin, canManage, dropship: store.dropshipEnabled, storeId: store.id, share,
    enabled: raw.enabled, since: raw.since, until: raw.until, range, warnings: raw.warnings,
    lastSettlement: raw.lastSettlement, upcoming: raw.upcoming,
    nativeSyncedAt: raw.native?.at ?? null,
    overall: t ? {
      cumulative: t.cumulative, storeShare: t.storeShare, payments: t.payments, advances: t.advances,
      growpefyShare: admin ? t.growpefyShare : null, growpefyBalance: admin ? t.growpefyBalance : null,
    } : null,
    inRange,
    rows: rows.map((x) => ({ ...x, growpefyShare: admin ? x.growpefyShare : null, growpefyBalance: admin ? x.growpefyBalance : null })),
    payments: payments.map((p) => ({
      id: p.id, amount: p.amountPaise, direction: p.direction === "to_store" ? "to_store" as const : "to_growpefy" as const, date: p.paymentDate, note: p.note, createdBy: p.createdBy, confirmedBy: p.confirmedBy,
      status: p.status, confirmRole: p.confirmRole,
      // Pending entries stay open for the WhatsApp buttons for a week; the 6-digit code only for 10 minutes
      expired: p.status === "expired" || (p.status === "pending" && Date.now() - p.createdAt.getTime() > PAYMENT_REPLY_DAYS * 86400_000),
      viaWhatsapp: Boolean(p.waPhone),
      canConfirm: canManage && p.status === "pending" && Boolean(p.otpExpiresAt && p.otpExpiresAt.getTime() >= Date.now()) && p.confirmRole === viewer.role,
    })),
  });
}

export async function action({ request, params }: ActionFunctionArgs) {
  const viewer = await requireViewer(request);
  const store = await requireStore(viewer, params.id);
  if (viewer.role === "admin" && viewer.staff) throw new Response("Only the Super Admin can record or confirm direct payments.", { status: 403 });
  if (viewer.role === "owner" && !store.profitEnabled) throw new Response("Not found", { status: 404 });
  const fd = await request.formData();
  const intent = String(fd.get("intent") ?? "");
  try {
    if (intent === "createPayment") {
      const amountPaise = Math.round(Number(String(fd.get("amount") ?? "").replace(/[₹,\s]/g, "")) * 100);
      await createProfitPayment(store, {
        amountPaise, paymentDate: String(fd.get("paymentDate") ?? ""),
        direction: fd.get("direction") === "to_store" ? "to_store" : "to_growpefy",
        note: String(fd.get("note") ?? "").trim().slice(0, 200) || null, role: viewer.role, name: viewer.name,
      });
      return json({ ok: "Sent to the other side on WhatsApp (I accept / I reject) and email (6-digit code). The entry changes the balance only after they accept.", error: null });
    }
    if (intent === "confirmPayment") {
      const result = await confirmProfitPayment(String(fd.get("paymentId") ?? ""), store.id, String(fd.get("code") ?? "").trim(), viewer.role, viewer.name);
      const messages = {
        confirmed: "Payment confirmed. The balance is updated.",
        incorrect: "That code isn't correct. Check the message and try again.",
        locked: "Too many incorrect codes. The code is blocked; the other side can still accept on WhatsApp.",
        expired: "This code expired. The other side can still accept on WhatsApp, or create a new entry.",
        unavailable: "This payment can't be confirmed from this account or is no longer pending.",
      };
      return result === "confirmed" ? json({ ok: messages[result], error: null }) : json({ ok: null, error: messages[result] }, { status: 400 });
    }
    return json({ ok: null, error: "Unknown action." }, { status: 400 });
  } catch (e) {
    return json({ ok: null, error: e instanceof Error ? e.message : "Could not save this payment entry." }, { status: 400 });
  }
}

// ---------------- UI ----------------

const inr = (v: number, d = 0) => "₹" + Math.abs(v).toLocaleString("en-IN", { maximumFractionDigits: d, minimumFractionDigits: d });
const signed = (v: number, d = 0) => (v < 0 ? "−" : v > 0 ? "+" : "") + inr(v, d);
const paise = (v: number) => inr(v / 100, 2);
const compact = (v: number, plus = false) => (v < 0 ? "−" : plus && v > 0 ? "+" : "") + compactINR(Math.abs(v));
const dateLabel = (v: string, year = false) => new Date(`${v}T12:00:00+05:30`).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", ...(year ? { year: "numeric" } : {}) });

type D = ReturnType<typeof useLoaderData<typeof loader>>;

export default function ProfitShare() {
  const d = useLoaderData<typeof loader>();
  const res = useActionData<typeof action>();
  const o = d.overall;
  const r = d.inRange;
  const upcomingTotal = d.upcoming.reduce((n, u) => n + u.amount, 0);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[22px] font-semibold leading-tight tracking-tight">Sales and profit</h1>
          <p className="mt-1 text-sm text-ink-soft">{d.name} · partnership since {dateLabel(d.since, true)}{d.admin ? ` · Growpefy share ${d.share}%` : ""}</p>
        </div>
        {d.enabled && <RangePicker current={d.range} align="right" />}
      </div>

      {res?.ok && <Notice tone="success">{res.ok}</Notice>}
      {res?.error && <Notice tone="error">{res.error}</Notice>}
      {!d.enabled && <Notice tone="info">This store's profit dashboard is off. Turn it on in Store settings → Sales and profit dashboard.</Notice>}

      {d.enabled && o && (
        <>
          {/* Hero: where the partnership stands overall */}
          <section className="relative overflow-hidden rounded-2xl bg-[linear-gradient(135deg,#0E1714_0%,#0B5D4B_60%,#138a6e_100%)] p-5 text-white shadow-lift sm:p-7">
            <div aria-hidden className="pointer-events-none absolute -right-16 -top-20 h-64 w-64 rounded-full bg-emerald-300/20 blur-3xl" />
            <div className="relative grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] lg:items-end">
              <div>
                <p className="text-sm text-white/70">{d.admin ? "Growpefy balance (to receive)" : "Your profit so far"}</p>
                <p className="num mt-2 text-[40px] font-semibold leading-none tracking-tight sm:text-[52px]">
                  {d.admin ? signed(o.growpefyBalance ?? 0) : (o.storeShare < 0 ? "−" : "") + inr(o.storeShare)}
                </p>
                <p className="mt-3 text-sm text-white/75">
                  {d.admin
                    ? <>Share earned {signed(o.growpefyShare ?? 0)} − paid directly {inr(o.payments)}{o.advances ? <> + given to the store {inr(o.advances)}</> : null}</>
                    : <>Your share of {(o.cumulative < 0 ? "−" : "") + inr(o.cumulative)} net profit since {dateLabel(d.since)}{o.advances ? <> · received from Growpefy {inr(o.advances)}</> : null}</>}
                </p>
              </div>
              <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4 sm:gap-3">
                <Glass label="Net profit" value={compact(o.cumulative)} title={(o.cumulative < 0 ? "−" : "") + inr(o.cumulative)} />
                <Glass label="Store share" value={compact(o.storeShare)} title={(o.storeShare < 0 ? "−" : "") + inr(o.storeShare)} />
                {d.admin ? <Glass label="Growpefy share" value={compact(o.growpefyShare ?? 0, true)} title={signed(o.growpefyShare ?? 0)} /> : <Glass label="Paid directly" value={compact(o.payments)} title={inr(o.payments)} />}
                <Glass label="Coming from PayU" value={compact(upcomingTotal)} title={inr(upcomingTotal, 2)} />
              </dl>
            </div>
          </section>

          {/* The selected period */}
          <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-5">
            <Tile icon="orders" tint="bg-sky-50 text-sky-700" label="Orders" value={r.orders.toLocaleString("en-IN")} sub={`${inr(r.revenue)} revenue`} />
            <Tile icon="rupee" tint="bg-emerald-50 text-emerald-700" label="PayU settled" value={inr(r.settlement)} sub="Money that reached the bank" />
            <Tile icon="ads" tint="bg-violet-50 text-violet-700" label="Ads + 18% GST" value={inr(r.ads)} sub="Meta + Google" />
            {d.dropship
              ? <Tile icon="box" tint="bg-amber-50 text-amber-700" label="Dropship costs" value={inr(-r.dropship)} sub="Product, shipping, packing" />
              : <Tile icon="wallet" tint="bg-amber-50 text-amber-700" label="Paid directly" value={inr(r.payments)} sub="Confirmed payments" />}
            <Tile icon="trend" tint={r.net < 0 ? "bg-red-50 text-bad" : "bg-emerald-50 text-good"} label="Profit in period" value={(r.net < 0 ? "−" : "") + inr(r.net)} sub="Settled − ads (− dropship)" />
          </div>

          <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
            <section className="panel p-5">
              <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="text-[15px] font-semibold">Profit by day</h2>
                <p className="flex items-center gap-3 text-xs text-ink-faint">
                  <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-pine" />Day profit</span>
                  <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-red-400" />Day loss</span>
                  <span className="inline-flex items-center gap-1.5"><span className="h-0.5 w-4 bg-sky-500" />Running total</span>
                </p>
              </div>
              <ProfitChart rows={d.rows} />
            </section>

            <section className="panel flex flex-col">
              <div className="border-b border-rule px-5 py-4">
                <h2 className="text-[15px] font-semibold">Upcoming PayU settlements</h2>
                <p className="mt-0.5 text-xs text-ink-faint">{d.lastSettlement ? `Last settlement ${dateLabel(d.lastSettlement)}. ` : ""}Estimate from online payments, before PayU's fee.</p>
              </div>
              {d.upcoming.length ? (
                <ul className="scroll-thin max-h-[340px] flex-1 divide-y divide-rule overflow-y-auto">
                  {d.upcoming.map((u) => (
                    <li key={u.day} className="flex items-center gap-3 px-5 py-3 text-sm">
                      <span className="flex h-9 w-9 shrink-0 flex-col items-center justify-center rounded-lg bg-paper text-[10px] font-semibold leading-tight text-ink-soft">
                        {dateLabel(u.expected).split(" ").map((p, i) => <span key={i}>{p}</span>)}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="num block font-semibold">{inr(u.amount, 2)}</span>
                        <span className="block text-xs text-ink-faint">{u.orders} online {u.orders === 1 ? "payment" : "payments"} on {dateLabel(u.day)}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              ) : <p className="flex-1 px-5 py-8 text-center text-sm text-ink-faint">Nothing waiting. New online payments show here until PayU settles them.</p>}
              <div className="border-t border-rule px-5 py-3 text-sm"><span className="text-ink-soft">Total expected</span> <b className="num float-right">{inr(upcomingTotal, 2)}</b></div>
            </section>
          </div>

          {d.warnings.length > 0 && (
            <details className="panel px-5 py-3 text-sm">
              <summary className="cursor-pointer font-medium text-amber-800">{d.warnings.length} {d.warnings.length === 1 ? "note" : "notes"} about this data</summary>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-ink-soft">{d.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
            </details>
          )}

          <DailyTable d={d} />
          <Payments d={d} />

          <p className="text-xs text-ink-faint">
            Profit counts money when PayU settles it to the bank, minus Meta and Google ad spend with 18% GST{d.dropship ? ", minus dropship product, shipping, ₹4 packing per unit and RTO charges (refunds added back)" : ""}. Losses carry forward. Orders include Growpefy checkout and the store's own Shopify checkout{d.nativeSyncedAt ? ` (Shopify checkout updated ${new Date(d.nativeSyncedAt).toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "numeric", minute: "2-digit" })})` : ""}.
          </p>
        </>
      )}
    </div>
  );
}

function Glass({ label, value, title }: { label: string; value: string; title?: string }) {
  return (
    <div className="min-w-0 rounded-xl bg-white/10 px-3 py-2.5 ring-1 ring-white/15 backdrop-blur" title={title}>
      <dt className="truncate text-[11px] text-white/70">{label}</dt>
      <dd className="num mt-0.5 truncate text-base font-semibold sm:text-lg">{value}</dd>
    </div>
  );
}

function Tile({ icon, tint, label, value, sub }: { icon: IconName; tint: string; label: string; value: string; sub?: string }) {
  return (
    <div className="panel min-w-0 p-4">
      <div className="flex items-center gap-2.5">
        <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${tint}`}><Icon name={icon} className="h-4 w-4" /></span>
        <p className="min-w-0 truncate text-xs font-medium text-ink-soft">{label}</p>
      </div>
      <p className="num mt-3 truncate text-xl font-semibold leading-tight">{value}</p>
      {sub && <p className="mt-1 truncate text-xs text-ink-faint">{sub}</p>}
    </div>
  );
}

/** Bars: each day's profit (green) or loss (red). Line: running profit. Months instead of days for long ranges. */
function ProfitChart({ rows }: { rows: D["rows"] }) {
  const [hover, setHover] = useState<number | null>(null);
  let pts = rows.map((x) => ({ key: x.day, label: dateLabel(x.day), net: x.net, run: x.cumulative }));
  if (pts.length > 92) {
    const m = new Map<string, { key: string; label: string; net: number; run: number }>();
    for (const x of rows) {
      const k = x.day.slice(0, 7);
      const p = m.get(k) ?? { key: k, label: new Date(`${k}-15T12:00:00Z`).toLocaleDateString("en-IN", { month: "short", year: "2-digit" }), net: 0, run: 0 };
      p.net += x.net; p.run = x.cumulative; m.set(k, p);
    }
    pts = [...m.values()];
  }
  if (!pts.length) return <p className="py-12 text-center text-sm text-ink-faint">No data in this period yet.</p>;
  const W = 720, H = 240, padL = 8, padR = 8, padT = 12, padB = 26;
  const vals = pts.flatMap((p) => [p.net, p.run, 0]);
  const max = Math.max(...vals), min = Math.min(...vals);
  const span = max - min || 1;
  const y = (v: number) => padT + ((max - v) / span) * (H - padT - padB);
  const slot = (W - padL - padR) / pts.length;
  const bw = Math.max(2, Math.min(28, slot * 0.62));
  const x = (i: number) => padL + slot * i + slot / 2;
  const line = pts.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.run).toFixed(1)}`).join(" ");
  const every = Math.max(1, Math.ceil(pts.length / 8));
  const h = hover != null ? pts[hover] : null;
  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-[240px] w-full" role="img" aria-label="Profit by day" onMouseLeave={() => setHover(null)}>
        <line x1={padL} x2={W - padR} y1={y(0)} y2={y(0)} stroke="currentColor" className="text-rule" />
        {pts.map((p, i) => {
          const top = Math.min(y(p.net), y(0)), hgt = Math.max(1, Math.abs(y(p.net) - y(0)));
          return (
            <g key={p.key} onMouseEnter={() => setHover(i)}>
              <rect x={x(i) - slot / 2} y={padT} width={slot} height={H - padT - padB} fill="transparent" />
              <rect x={x(i) - bw / 2} y={top} width={bw} height={hgt} rx={Math.min(3, bw / 2)} className={p.net < 0 ? "fill-red-400" : "fill-pine"} opacity={hover == null || hover === i ? 1 : 0.45} />
              {i % every === 0 && <text x={x(i)} y={H - 8} textAnchor="middle" className="fill-ink-faint text-[11px]">{p.label}</text>}
            </g>
          );
        })}
        <path d={line} fill="none" stroke="#0ea5e9" strokeWidth={2.2} strokeLinejoin="round" strokeLinecap="round" />
        {h && <circle cx={x(hover!)} cy={y(h.run)} r={4} fill="#0ea5e9" stroke="white" strokeWidth={2} />}
      </svg>
      {h && (
        <div className="pointer-events-none absolute top-0 rounded-lg border border-rule bg-surface px-3 py-2 text-xs shadow-lift" style={{ left: `min(calc(${((x(hover!) / W) * 100).toFixed(1)}% + 8px), calc(100% - 170px))` }}>
          <p className="font-semibold">{h.label}</p>
          <p className="num mt-1">Profit <b className={h.net < 0 ? "text-bad" : "text-good"}>{(h.net < 0 ? "−" : "") + inr(h.net)}</b></p>
          <p className="num">Running <b>{(h.run < 0 ? "−" : "") + inr(h.run)}</b></p>
        </div>
      )}
    </div>
  );
}

function DailyTable({ d }: { d: D }) {
  const rows = d.rows.slice().reverse();
  return (
    <section className="panel">
      <div className="border-b border-rule px-5 py-4">
        <h2 className="text-[15px] font-semibold">Day by day</h2>
        <p className="mt-0.5 text-xs text-ink-faint">Orders by order date (Growpefy + Shopify checkout). Settlements by the day PayU paid the bank.</p>
      </div>
      {rows.length ? (
        <div className="scroll-thin overflow-x-auto">
          <table className="table min-w-[980px]">
            <thead><tr>
              <th>Date</th><th className="text-right">Orders</th><th className="text-right">Revenue</th><th className="text-right">PayU settled</th><th className="text-right">Ads + GST</th>
              {d.dropship && <th className="text-right">Dropship</th>}
              <th className="text-right">Day profit</th><th className="text-right">Running profit</th>
              {d.admin && <th className="text-right">Growpefy balance</th>}
              <th className="text-right">Store share</th>
            </tr></thead>
            <tbody>
              {rows.map((x) => (
                <tr key={x.day}>
                  <td className="whitespace-nowrap">{dateLabel(x.day, true)}</td>
                  <td className="num text-right">{x.orders ? x.orders.toLocaleString("en-IN") : <span className="text-ink-faint">0</span>}</td>
                  <td className="num text-right">{inr(x.revenue)}</td>
                  <td className="num text-right">{x.settlement ? inr(x.settlement) : <span className="text-ink-faint">—</span>}</td>
                  <td className="num text-right">{x.adCostWithGst ? inr(x.adCostWithGst) : <span className="text-ink-faint">—</span>}</td>
                  {d.dropship && <td className="num text-right">{x.dropship ? inr(-x.dropship) : <span className="text-ink-faint">—</span>}</td>}
                  <td className={`num text-right ${x.net < 0 ? "text-bad" : x.net > 0 ? "text-good" : ""}`}>{(x.net < 0 ? "−" : "") + inr(x.net)}</td>
                  <td className={`num text-right font-semibold ${x.cumulative < 0 ? "text-bad" : ""}`}>{(x.cumulative < 0 ? "−" : "") + inr(x.cumulative)}</td>
                  {d.admin && <td className="num text-right">{signed(x.growpefyBalance ?? 0)}</td>}
                  <td className="num text-right">{(x.storeShare < 0 ? "−" : "") + inr(x.storeShare)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : <p className="px-5 py-8 text-center text-sm text-ink-faint">No days in this period.</p>}
    </section>
  );
}

function Payments({ d }: { d: D }) {
  const today = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
  return (
    <section className="panel">
      <div className="border-b border-rule px-5 py-4">
        <h2 className="text-[15px] font-semibold">Direct payments between the store and Growpefy</h2>
        <p className="mt-0.5 text-xs text-ink-faint">Both ways: the store paying Growpefy its share, or Growpefy giving the store money (it's added to what the store owes). The other side gets the details on WhatsApp with I accept / I reject buttons (or a 6-digit code by email). Only accepted entries change the balance.</p>
      </div>
      {d.canManage && (
        <Form method="post" className="grid gap-3 border-b border-rule p-5 sm:grid-cols-4">
          <input type="hidden" name="intent" value="createPayment" />
          <fieldset className="sm:col-span-4">
            <legend className="label">Who paid whom</legend>
            <div className="flex flex-wrap gap-2">
              {([["to_growpefy", "Store paid Growpefy"], ["to_store", "Growpefy gave the store"]] as const).map(([v, label], i) => (
                <label key={v} className="flex cursor-pointer items-center gap-2 rounded-lg border border-rule px-3 py-2 text-sm has-[:checked]:border-pine has-[:checked]:bg-emerald-50">
                  <input type="radio" name="direction" value={v} defaultChecked={i === 0} className="accent-[#0B5D4B]" />{label}
                </label>
              ))}
            </div>
          </fieldset>
          <label className="block"><span className="label">Amount (₹)</span><input name="amount" type="number" min="0.01" step="0.01" required className="input" /></label>
          <label className="block"><span className="label">Payment date</span><input name="paymentDate" type="date" min={d.since} max={today} defaultValue={today} required className="input" /></label>
          <label className="block sm:col-span-2"><span className="label">Reference / note (optional)</span><input name="note" maxLength={200} className="input" placeholder="UPI / bank reference" /></label>
          <div className="sm:col-span-4"><SubmitButton intent="createPayment" className="btn-primary" busyText="Sending code">Record payment and send code</SubmitButton></div>
        </Form>
      )}
      {d.payments.length === 0 ? <p className="px-5 py-6 text-sm text-ink-faint">No payments in this period.</p> : (
        <div className="divide-y divide-rule">
          {d.payments.map((p) => (
            <div key={p.id} className="flex flex-wrap items-center gap-3 px-5 py-4">
              <div className="min-w-0 flex-1">
                <p className="num font-semibold">
                  <span className={p.direction === "to_store" ? "text-bad" : "text-good"}>{p.direction === "to_store" ? "↑ " : "↓ "}{paise(p.amount)}</span>{" "}
                  <span className="text-xs font-normal text-ink-soft">{p.direction === "to_store" ? "Growpefy gave the store" : "Store paid Growpefy"}</span>{" "}
                  <span className="text-xs font-normal text-ink-faint">{dateLabel(p.date, true)}</span>
                </p>
                <p className="text-xs text-ink-soft">Entered by {p.createdBy}{p.note ? ` · ${p.note}` : ""}</p>
                <p className={`text-xs ${p.status === "confirmed" ? "text-good" : p.status === "rejected" ? "text-bad" : "text-amber-700"}`}>
                  {p.status === "confirmed" ? `Accepted by ${p.confirmedBy ?? "the other side"}`
                    : p.status === "rejected" ? `Rejected by ${p.confirmedBy ?? "the other side"}. Not counted.`
                    : p.expired ? "Expired without an answer. Create a new entry."
                    : `Waiting for ${p.confirmRole === "admin" ? "Growpefy" : "the store"} to accept${p.viaWhatsapp ? " on WhatsApp" : ""}`}
                </p>
              </div>
              {p.canConfirm && (
                <Form method="post" className="flex items-end gap-2">
                  <input type="hidden" name="intent" value="confirmPayment" /><input type="hidden" name="paymentId" value={p.id} />
                  <label className="block"><span className="label">6-digit code</span><input name="code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} pattern="[0-9]{6}" required className="input w-32" /></label>
                  <SubmitButton className="btn-secondary" busyText="Confirming">Confirm</SubmitButton>
                </Form>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
