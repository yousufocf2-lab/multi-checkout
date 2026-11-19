// Settings → Messages & OTP: what OTP and WhatsApp messages cost, at the store's rates, with a full list.
import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Link, useLoaderData, useSearchParams } from "@remix-run/react";
import { Icon } from "~/components/Icons";
import { RangePicker } from "~/components/Overview";
import { PageHeader } from "~/components/ui";
import { requireStore, requireViewer } from "~/lib/auth.server";
import { rangeLabel, resolveRange } from "~/lib/dates";
import { FILTER_LABEL, FILTERS, GROUP_INFO, kindOf, MSG_KINDS, PAGE_SIZE, type MsgFilter, type MsgGroup } from "~/lib/message-usage";
import { messageUsage } from "~/lib/message-usage.server";
import { getWallet, ratesFor } from "~/lib/wallet.server";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const viewer = await requireViewer(request);
  const store = await requireStore(viewer, params.id);
  const url = new URL(request.url);
  if (!url.searchParams.get("range")) url.searchParams.set("range", "this_month");
  const range = resolveRange(url.searchParams, store.createdAt.toISOString().slice(0, 10));
  const f = url.searchParams.get("type") as MsgFilter | null;
  const filter: MsgFilter = f && (FILTERS as readonly string[]).includes(f) ? f : "all";
  const page = Math.max(1, Number(url.searchParams.get("page")) || 1);
  const [data, rates] = await Promise.all([messageUsage(store.id, range, filter, page), getWallet(store.id).then(ratesFor)]);
  return json({ range, label: rangeLabel(range), filter, ...data, rates: rates as unknown as Record<string, number> });
}

const inr = (p: number) => `₹${(p / 100).toLocaleString("en-IN", { minimumFractionDigits: p % 100 ? 2 : 0, maximumFractionDigits: 2 })}`;
const n = (v: number) => v.toLocaleString("en-IN");
const GROUPS: MsgGroup[] = ["otp", "transactional", "service", "promotional"];
const DOT: Record<MsgGroup, string> = { otp: "#2563eb", transactional: "#0B5D4B", service: "#7c3aed", promotional: "#d97706" };

export default function MessageUsage() {
  const d = useLoaderData<typeof loader>();
  const [params] = useSearchParams();
  const href = (patch: Record<string, string | null>) => {
    const p = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) v == null ? p.delete(k) : p.set(k, v);
    return `?${p}`;
  };
  const tot = (pred: (g: MsgGroup) => boolean) => d.totals.filter((t) => pred(kindOf(t.type).group)).reduce((a, t) => ({ count: a.count + t.count, paise: a.paise + t.paise }), { count: 0, paise: 0 });
  const all = tot(() => true), otp = tot((g) => g === "otp"), wa = tot((g) => g !== "otp");
  const first = (d.page - 1) * PAGE_SIZE + 1;

  return (
    <div className="mx-auto w-full max-w-6xl space-y-5 pb-8">
      <PageHeader title="Messages & OTP" icon="chat"
        description="What OTP codes and WhatsApp messages cost, at your rates, for the dates you pick."
        actions={<RangePicker current={d.range} align="right" />} />

      {/* Totals for the period */}
      <section className="panel overflow-hidden p-0">
        <div className="grid sm:grid-cols-3">
          <div className="border-b border-rule px-5 py-5 sm:border-b-0 sm:border-r">
            <p className="text-[13px] font-medium text-ink-soft">Total spent · {d.label}</p>
            <p className="num mt-2 text-[34px] font-semibold leading-none tracking-tight text-ink">{inr(all.paise)}</p>
            <p className="mt-2 text-[12.5px] text-ink-faint">{n(all.count)} message{all.count === 1 ? "" : "s"} and codes · before GST</p>
          </div>
          <div className="border-b border-rule px-5 py-5 sm:border-b-0 sm:border-r">
            <p className="flex items-center gap-2 text-[13px] font-medium text-ink-soft"><span className="h-2 w-2 rounded-full" style={{ background: DOT.otp }} />OTP</p>
            <p className="num mt-2 text-[26px] font-semibold leading-none text-ink">{inr(otp.paise)}</p>
            <p className="mt-2 text-[12.5px] text-ink-faint">{n(otp.count)} code{otp.count === 1 ? "" : "s"} sent</p>
          </div>
          <div className="px-5 py-5">
            <p className="flex items-center gap-2 text-[13px] font-medium text-ink-soft"><Icon name="chat" className="h-3.5 w-3.5" />WhatsApp</p>
            <p className="num mt-2 text-[26px] font-semibold leading-none text-ink">{inr(wa.paise)}</p>
            <p className="mt-2 text-[12.5px] text-ink-faint">{n(wa.count)} message{wa.count === 1 ? "" : "s"} sent</p>
          </div>
        </div>
      </section>

      {/* Breakdown: by group, then by message type */}
      <section className="panel overflow-hidden p-0">
        <div className="border-b border-rule px-5 py-4">
          <h2 className="text-[15px] font-semibold">Breakdown</h2>
          <p className="text-[12.5px] text-ink-soft">{d.label} · rate is what one message or code costs today</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[620px] text-[13.5px]">
            <thead>
              <tr className="border-b border-rule bg-paper text-left text-[11.5px] uppercase tracking-wide text-ink-faint">
                <th className="px-5 py-2.5 font-semibold">Type</th>
                <th className="px-3 py-2.5 text-right font-semibold">Rate</th>
                <th className="px-3 py-2.5 text-right font-semibold">Sent</th>
                <th className="px-5 py-2.5 text-right font-semibold">Amount</th>
              </tr>
            </thead>
            {GROUPS.map((g) => {
              const kinds = MSG_KINDS.filter((k) => k.group === g);
              const sub = tot((x) => x === g);
              return (
                <tbody key={g} className="border-b border-rule">
                  <tr className="bg-[#fafbfc]">
                    <td className="px-5 py-2.5" colSpan={2}>
                      <span className="flex items-center gap-2 font-semibold text-ink"><span className="h-2.5 w-2.5 rounded-full" style={{ background: DOT[g] }} />{GROUP_INFO[g].label}</span>
                      <span className="ml-[18px] block text-[12px] text-ink-faint">{GROUP_INFO[g].text}</span>
                    </td>
                    <td className="num px-3 py-2.5 text-right font-semibold">{n(sub.count)}</td>
                    <td className="num px-5 py-2.5 text-right font-semibold">{inr(sub.paise)}</td>
                  </tr>
                  {kinds.length > 1 && kinds.map((k) => {
                    const t = d.totals.find((x) => x.type === k.id);
                    return (
                      <tr key={k.id} className="text-ink-soft">
                        <td className="py-2 pl-[38px] pr-3">{k.label}</td>
                        <td className="num px-3 py-2 text-right">{d.rates[k.rateKey] ? inr(d.rates[k.rateKey]) : "—"}</td>
                        <td className="num px-3 py-2 text-right">{n(t?.count ?? 0)}</td>
                        <td className="num px-5 py-2 text-right text-ink">{inr(t?.paise ?? 0)}</td>
                      </tr>
                    );
                  })}
                  {kinds.length === 1 && (
                    <tr className="text-ink-soft">
                      <td className="py-2 pl-[38px] pr-3">{kinds[0].label}</td>
                      <td className="num px-3 py-2 text-right">{d.rates[kinds[0].rateKey] ? inr(d.rates[kinds[0].rateKey]) : "—"}</td>
                      <td className="num px-3 py-2 text-right">{n(sub.count)}</td>
                      <td className="num px-5 py-2 text-right text-ink">{inr(sub.paise)}</td>
                    </tr>
                  )}
                </tbody>
              );
            })}
            <tfoot>
              <tr className="bg-paper">
                <td className="px-5 py-3.5 text-[14px] font-semibold" colSpan={2}>Total</td>
                <td className="num px-3 py-3.5 text-right font-semibold">{n(all.count)}</td>
                <td className="num px-5 py-3.5 text-right text-[16px] font-semibold">{inr(all.paise)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </section>

      {/* Every message and code, 50 per page */}
      <section className="panel overflow-hidden p-0" id="list">
        <div className="flex flex-wrap items-center gap-3 border-b border-rule px-5 py-4">
          <h2 className="mr-auto text-[15px] font-semibold">All messages</h2>
          <div className="flex gap-1.5 overflow-x-auto">
            {FILTERS.map((f) => (
              <Link key={f} to={href({ type: f === "all" ? null : f, page: null })} preventScrollReset
                className={`shrink-0 rounded-full border px-3 py-1 text-[12.5px] font-medium ${d.filter === f ? "border-ink bg-ink text-white" : "border-rule-strong text-ink-soft hover:border-ink hover:text-ink"}`}>
                {FILTER_LABEL[f]}
              </Link>
            ))}
          </div>
        </div>
        {d.rows.length === 0 ? (
          <p className="px-5 py-10 text-center text-[13px] text-ink-faint">Nothing sent in this period.</p>
        ) : (
          <>
            <ul className="divide-y divide-rule md:hidden">
              {d.rows.map((r) => {
                const k = kindOf(r.type);
                return (
                  <li key={r.id} className="flex items-start gap-3 px-5 py-3">
                    <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full" style={{ background: DOT[k.group] }} />
                    <div className="min-w-0 flex-1">
                      <p className="flex justify-between gap-2 text-[13.5px]"><span className="font-medium text-ink">{k.label}</span><span className="num font-semibold">{inr(r.paise)}</span></p>
                      <p className="truncate text-[12px] text-ink-soft">{r.note ?? r.ref}</p>
                      {(r.resent > 0 || r.verified != null) && <p className="mt-1 flex flex-wrap items-center gap-2"><Resent r={r} /><Verified v={r.verified} /></p>}
                      <p className="text-[11.5px] text-ink-faint">{new Date(r.at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}</p>
                    </div>
                  </li>
                );
              })}
            </ul>
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="border-b border-rule bg-paper text-left text-[11.5px] uppercase tracking-wide text-ink-faint">
                    <th className="px-5 py-2.5 font-semibold">Date</th>
                    <th className="px-3 py-2.5 font-semibold">Type</th>
                    <th className="px-3 py-2.5 font-semibold">Details</th>
                    <th className="px-3 py-2.5 text-center font-semibold">Resent</th>
                    <th className="px-3 py-2.5 font-semibold">Verification</th>
                    <th className="px-5 py-2.5 text-right font-semibold">Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-rule">
                  {d.rows.map((r) => {
                    const k = kindOf(r.type);
                    return (
                      <tr key={r.id} className="hover:bg-paper/60">
                        <td className="whitespace-nowrap px-5 py-2.5 text-ink-soft">{new Date(r.at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" })}</td>
                        <td className="px-3 py-2.5">
                          <span className="flex items-center gap-2 font-medium text-ink"><span className="h-2 w-2 rounded-full" style={{ background: DOT[k.group] }} />{k.label}</span>
                          <span className="ml-4 block text-[11.5px] text-ink-faint">{GROUP_INFO[k.group].label}</span>
                        </td>
                        <td className="max-w-[320px] truncate px-3 py-2.5 text-ink-soft">{r.note ?? r.ref}</td>
                        <td className="px-3 py-2.5 text-center"><Resent r={r} /></td>
                        <td className="px-3 py-2.5"><Verified v={r.verified} /></td>
                        <td className="num px-5 py-2.5 text-right font-semibold text-ink">{inr(r.paise)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
        <div className="flex items-center justify-between gap-3 border-t border-rule px-5 py-3 text-[13px]">
          <span className="text-ink-soft">{d.rows.length ? `${n(first)}–${n(first + d.rows.length - 1)}` : "0"} · {FILTER_LABEL[d.filter]}</span>
          <div className="flex gap-2">
            {d.page > 1 ? <Link to={href({ page: d.page > 2 ? String(d.page - 1) : null })} preventScrollReset className="btn-secondary h-9 px-3">← Previous</Link>
              : <span className="btn-secondary pointer-events-none h-9 px-3 opacity-40">← Previous</span>}
            {d.hasMore ? <Link to={href({ page: String(d.page + 1) })} preventScrollReset className="btn-secondary h-9 px-3">Next →</Link>
              : <span className="btn-secondary pointer-events-none h-9 px-3 opacity-40">Next →</span>}
          </div>
        </div>
      </section>
    </div>
  );
}

/** How many times the same code request was sent again (the row's amount covers every send). */
function Resent({ r }: { r: { resent: number; at: string; lastAt: string } }) {
  if (!r.resent) return <span className="text-[12px] text-ink-faint">0</span>;
  const last = new Date(r.lastAt).toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "numeric", minute: "2-digit" });
  return (
    <span title={`Sent ${r.resent + 1} times · last at ${last}`} className="inline-flex items-center gap-1 rounded-full bg-[#eef2ff] px-2 py-0.5 text-[11.5px] font-semibold text-[#3730a3]">
      <Icon name="refresh" className="h-3 w-3" />{r.resent} resent
    </span>
  );
}

/** OTP only: did the customer enter the code? */
function Verified({ v }: { v: boolean | null }) {
  if (v == null) return <span className="text-[12px] text-ink-faint">—</span>;
  return v
    ? <span className="inline-flex items-center gap-1 rounded-full bg-[#e3f1ea] px-2 py-0.5 text-[11.5px] font-semibold text-[#1f6f4a]"><Icon name="check" className="h-3 w-3" />Verified</span>
    : <span className="inline-flex items-center gap-1 rounded-full bg-[#fdeceb] px-2 py-0.5 text-[11.5px] font-semibold text-[#b42318]"><Icon name="close" className="h-3 w-3" />Not verified</span>;
}
