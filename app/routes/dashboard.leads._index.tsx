// Super admin → Leads: every sales lead (Meta lead forms, website callbacks, signups) with its source and follow-up status.
import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Form, Link, useActionData, useLoaderData, useRevalidator, useSearchParams } from "@remix-run/react";
import { useEffect, useMemo, useState } from "react";
import { Icon } from "~/components/Icons";
import { SourceTagChip, StatusChip } from "~/components/LeadChips";
import { Notice, PageHeader, SubmitButton } from "~/components/ui";
import { requireAdmin } from "~/lib/auth.server";
import { KIND_LABEL, LEAD_STATUSES, LEAD_TABS, SOURCE_TAGS, agoLabel, demoLabel, leadTab, matchLead, readLeadFilter, type LeadKind } from "~/lib/leads";
import { listLeads, syncMetaLeads, upcomingDemos } from "~/lib/leads.server";

export const meta: MetaFunction = () => [{ title: "Leads · Growpefy" }];

export async function loader({ request }: LoaderFunctionArgs) {
  await requireAdmin(request);
  const sync = await syncMetaLeads();
  const [leads, demos] = await Promise.all([listLeads(), upcomingDemos(5)]);
  return json({ leads, demos, syncError: sync.error, page: sync.page });
}

export async function action({ request }: ActionFunctionArgs) {
  await requireAdmin(request);
  const r = await syncMetaLeads(true);
  return json({ ok: !r.error, message: r.error ?? (r.added ? `${r.added} new lead${r.added === 1 ? "" : "s"} from Meta` : "Up to date. No new Meta leads.") });
}

const when = (iso: string) => new Date(iso).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

export default function Leads() {
  const d = useLoaderData<typeof loader>();
  const a = useActionData<typeof action>();
  const [sp, setSp] = useSearchParams();
  const f = readLeadFilter(sp);
  const [q, setQ] = useState(sp.get("q") ?? "");
  const set = (k: string, v: string | null) => { const n = new URLSearchParams(sp); if (v == null) n.delete(k); else n.set(k, v); setSp(n, { preventScrollReset: true, replace: true }); };
  // Search goes into the URL (after a short pause) so next / previous inside a lead follows the same list
  useEffect(() => { const t = setTimeout(() => { if ((sp.get("q") ?? "") !== q) set("q", q.trim() ? q : null); }, 300); return () => clearTimeout(t); }); // eslint-disable-line react-hooks/exhaustive-deps
  // Teammates' updates show up without reloading
  const revalidator = useRevalidator();
  useEffect(() => { const t = setInterval(() => { if (document.visibilityState === "visible" && revalidator.state === "idle") revalidator.revalidate(); }, 60_000); return () => clearInterval(t); }, [revalidator]);
  const src = f.src, st = f.st, kind = f.k;

  const rows = useMemo(() => d.leads.filter((l) => matchLead(l, f)), [d.leads, sp]); // eslint-disable-line react-hooks/exhaustive-deps
  const tabCount = (t: string) => d.leads.filter((l) => matchLead(l, { ...f, tab: "all" }) && (t === "all" || leadTab(l) === t)).length;
  const qs = sp.toString() ? `?${sp}` : "";
  const count = (s: string) => d.leads.filter((l) => matchLead(l, { ...f, src: s })).length;
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
  const newToday = d.leads.filter((l) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date(l.createdAt)) === today).length;

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader title="Leads" description="Every sales lead in one place: Meta lead forms, website callbacks and signups."
        actions={<>
          <Link to="/dashboard/leads/welcome" className="btn-secondary"><Icon name="send" className="h-4 w-4" />Welcome messages</Link>
          <Form method="post"><SubmitButton className="btn-secondary" busyText="Checking Meta"><Icon name="refresh" className="h-4 w-4" />Get new Meta leads</SubmitButton></Form>
        </>} />

      <div className="space-y-5">
        {a?.message && <Notice tone={a.ok ? "success" : "error"}>{a.message}</Notice>}
        {d.syncError && !a && <Notice tone="warning"><b>Meta leads:</b> {d.syncError}</Notice>}

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Kpi label="All leads" value={d.leads.length} note={`${newToday} today`} />
          <Kpi label="To call" value={d.leads.filter((l) => l.status === "new").length} note="Status: New" />
          <Kpi label="Demos booked" value={d.demos.length} note={d.demos[0] ? `Next: ${demoLabel(d.demos[0].demoAt)}` : "None upcoming"} />
          <Kpi label="Customers" value={d.leads.filter((l) => l.status === "customer" || (l.signedUp && (l.stores ?? 0) > 0)).length} note="Connected a store" />
        </div>

        {d.demos.length > 0 && (
          <section className="panel overflow-hidden">
            <div className="border-b border-rule px-5 py-3"><h2 className="text-sm font-semibold">Upcoming demos</h2></div>
            <ul className="divide-y divide-rule">
              {d.demos.map((x) => (
                <li key={x.key}><Link to={x.key} className="flex flex-wrap items-center gap-3 px-5 py-2.5 text-sm hover:bg-paper">
                  <Icon name="calendar" className="h-4 w-4 text-pine" /><b className="num">{demoLabel(x.demoAt)}</b><span className="text-ink-soft">{x.name}{x.phone ? ` · +91 ${x.phone}` : ""}</span>
                </Link></li>
              ))}
            </ul>
          </section>
        )}

        <section className="panel overflow-hidden">
          <div className="flex gap-1 overflow-x-auto border-b border-rule px-3 pt-2" role="tablist">
            {LEAD_TABS.map((t) => (
              <button key={t.id} type="button" role="tab" aria-selected={f.tab === t.id} title={t.hint} onClick={() => set("tab", t.id === "new" ? null : t.id)}
                className={`-mb-px flex shrink-0 items-center gap-2 border-b-2 px-3 py-2.5 text-sm font-medium transition ${f.tab === t.id ? "border-ink text-ink" : "border-transparent text-ink-soft hover:text-ink"}`}>
                {t.label}<span className={`num rounded-full px-1.5 text-[11px] font-semibold ${f.tab === t.id ? "bg-ink text-white" : "bg-paper-sunk text-ink-soft"}`}>{tabCount(t.id)}</span>
              </button>
            ))}
          </div>
          <div className="space-y-3 border-b border-rule px-5 py-4">
            <div className="flex flex-wrap gap-1.5">
              {([["all", "All sources"], ["meta", "Meta"], ["google", "Google"], ["organic", "Organic"], ["direct", "Direct"], ["other", "Other"]] as const).map(([id, l]) => (
                <button key={id} type="button" onClick={() => set("src", id === "all" ? null : id)}
                  className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium ${src === id ? "border-ink bg-ink text-white" : "border-rule-strong text-ink-soft hover:border-ink"}`}>
                  {id !== "all" && <span className="h-2 w-2 rounded-full" style={{ background: SOURCE_TAGS[id].color }} />}{l}<span className="num opacity-70">{count(id)}</span>
                </button>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <select value={st} onChange={(e) => set("st", e.target.value === "all" ? null : e.target.value)} className="input h-9 w-auto py-0 text-sm" aria-label="Status">
                <option value="all">Any status</option>
                {LEAD_STATUSES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
              </select>
              <select value={kind} onChange={(e) => set("k", e.target.value === "all" ? null : e.target.value)} className="input h-9 w-auto py-0 text-sm" aria-label="Type">
                <option value="all">All types</option>
                {(Object.keys(KIND_LABEL) as LeadKind[]).map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
              </select>
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, phone, email" className="input h-9 min-w-0 flex-1 text-sm" />
            </div>
          </div>
          {rows.length === 0 ? <p className="px-5 py-12 text-center text-sm text-ink-faint">{f.tab === "new" ? "No new leads. Everyone has been worked on." : "No leads here."}</p> : (
            <ul className="divide-y divide-rule">
              {rows.map((l) => (
                <li key={l.key}>
                  <Link to={`${l.key}${qs}`} className="flex flex-wrap items-center gap-x-4 gap-y-1.5 px-5 py-3 transition hover:bg-paper">
                    <div className="min-w-0 flex-1">
                      <p className="flex flex-wrap items-center gap-2 text-sm font-semibold">{l.name}<SourceTagChip s={l.source} /><span className="rounded bg-paper-sunk px-1.5 py-px text-[10px] font-medium uppercase tracking-wide text-ink-soft">{KIND_LABEL[l.kind]}</span></p>
                      <p className="mt-0.5 truncate text-xs text-ink-soft">{[l.phone ? `+91 ${l.phone}` : null, l.email, l.detail].filter(Boolean).join(" · ")}</p>
                      {(l.lastBy || l.lastNote) && (
                        <p className="mt-0.5 truncate text-xs text-ink-faint">
                          {l.lastBy && <span className="font-medium text-ink-soft">{l.lastBy}{l.lastAt ? `, ${agoLabel(l.lastAt)}` : ""}</span>}
                          {l.lastBy && l.lastNote && " · "}{l.lastNote && `“${l.lastNote}”`}
                        </p>
                      )}
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      {l.signedUp && <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-good">{l.stores ?? 0} store{l.stores === 1 ? "" : "s"}</span>}
                      {l.status === "demo_scheduled" && l.demoAt && <span className="num rounded-full bg-pine-tint px-2 py-0.5 text-[11px] font-semibold text-pine">{demoLabel(l.demoAt)}</span>}
                      <StatusChip s={l.status} />
                    </div>
                    <p className="w-full text-[11px] text-ink-faint sm:w-28 sm:text-right">{when(l.createdAt)}</p>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
        {d.page && <p className="text-xs text-ink-faint">Meta leads come from the Page “{d.page}” and refresh every couple of minutes when you open this page.</p>}
      </div>
    </div>
  );
}

function Kpi({ label, value, note }: { label: string; value: number; note: string }) {
  return (
    <div className="panel p-4">
      <p className="text-xs font-medium text-ink-soft">{label}</p>
      <p className="num mt-1.5 text-2xl font-semibold">{value}</p>
      <p className="mt-0.5 truncate text-[11px] text-ink-faint">{note}</p>
    </div>
  );
}
