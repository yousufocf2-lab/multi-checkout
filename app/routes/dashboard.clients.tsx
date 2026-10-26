// Admin → Clients: everyone who signed up, what they told us, and how far onboarding has got.
import type { LoaderFunctionArgs, MetaFunction } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Link, useLoaderData, useSearchParams } from "@remix-run/react";
import { useMemo, useState } from "react";
import { Steps } from "~/components/AdminOverview";
import { SourceTagChip, StatusChip } from "~/components/LeadChips";
import { PageHeader } from "~/components/ui";
import { requireViewer } from "~/lib/auth.server";
import { SITE_PLATFORMS, STEPS, URGENCY, labelOf } from "~/lib/clients";
import { funnel, listClients } from "~/lib/clients.server";

export const meta: MetaFunction = () => [{ title: "Clients · Growpefy" }];

export async function loader({ request }: LoaderFunctionArgs) {
  const v = await requireViewer(request);
  if (v.role !== "admin") throw new Response("Not found", { status: 404 });
  const list = await listClients();
  return json({ list, funnel: funnel(list) });
}

const when = (iso: string) => new Date(iso).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short" });

export default function Clients() {
  const { list, funnel: f } = useLoaderData<typeof loader>();
  const [sp, setSp] = useSearchParams();
  const stage = sp.get("at") ?? "all";
  const urgency = sp.get("u") ?? "all";
  const [q, setQ] = useState("");
  const set = (k: string, v: string) => { const n = new URLSearchParams(sp); if (v === "all") n.delete(k); else n.set(k, v); setSp(n, { replace: true, preventScrollReset: true }); };

  const rows = useMemo(() => list.filter((c) =>
    (stage === "all" || (stage === "done" ? !c.next : c.next?.id === stage)) &&
    (urgency === "all" || c.signup?.urgency === urgency) &&
    (!q.trim() || `${c.name} ${c.phone ?? ""} ${c.email ?? ""} ${(c.signup?.websites ?? []).map((w) => w.url).join(" ")}`.toLowerCase().includes(q.trim().toLowerCase())),
  ), [list, stage, urgency, q]);

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader title="Clients" description="Everyone who signed up, what they told us, and the next step to get them live."
        actions={<Link to="/dashboard/owners" className="btn-secondary">Owner accounts &amp; KYC</Link>} />

      {/* Funnel: click a step to see who is stuck there */}
      <div className="mb-5 grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
        {f.map((s, i) => {
          const stuck = list.filter((c) => c.next?.id === s.id).length;
          const on = stage === s.id;
          return (
            <button key={s.id} type="button" onClick={() => set("at", on ? "all" : s.id)} disabled={i === 0}
              className={`panel p-3 text-left transition ${on ? "ring-2 ring-pine" : i ? "hover:border-rule-strong" : ""}`}>
              <p className="text-[11px] text-ink-soft">{i + 1}. {STEPS[i].label}</p>
              <p className="num mt-1 text-xl font-semibold">{s.n}</p>
              {i > 0 && <p className="text-[11px] text-ink-faint">{stuck ? `${stuck} waiting here` : "No one waiting"}</p>}
            </button>
          );
        })}
      </div>

      <section className="panel overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 border-b border-rule px-5 py-3">
          <select value={stage} onChange={(e) => set("at", e.target.value)} className="input h-9 w-auto py-0 text-sm" aria-label="Step">
            <option value="all">All steps</option>
            {STEPS.slice(1).map((s) => <option key={s.id} value={s.id}>Waiting for: {s.label}</option>)}
            <option value="done">Fully onboarded</option>
          </select>
          <select value={urgency} onChange={(e) => set("u", e.target.value)} className="input h-9 w-auto py-0 text-sm" aria-label="Urgency">
            <option value="all">Any urgency</option>
            {URGENCY.map((u) => <option key={u.id} value={u.id}>{u.label}</option>)}
          </select>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search brand, phone, email, website" className="input h-9 min-w-0 flex-1 text-sm" />
        </div>
        {rows.length === 0 ? <p className="px-5 py-12 text-center text-sm text-ink-faint">No clients here.</p> : (
          <ul className="divide-y divide-rule">
            {rows.map((c) => {
              const u = URGENCY.find((x) => x.id === c.signup?.urgency);
              return (
                <li key={c.id}>
                  <Link to={`/dashboard/leads/signup-${c.id}`} className="grid gap-x-4 gap-y-1.5 px-5 py-3.5 transition hover:bg-paper md:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_auto]">
                    <div className="min-w-0">
                      <p className="flex flex-wrap items-center gap-2 text-sm font-semibold">
                        {c.name}<SourceTagChip s={c.source} />
                        {u && <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${u.tone}`}>{u.label}</span>}
                        {!c.active && <span className="rounded-full bg-red-50 px-2 py-0.5 text-[11px] font-medium text-bad">Paused</span>}
                      </p>
                      <p className="mt-0.5 truncate text-xs text-ink-soft">
                        {[c.contactName, c.phone ? `+91 ${c.phone}` : null, c.email].filter(Boolean).join(" · ")}
                      </p>
                      {(c.signup?.websites ?? []).length > 0 && (
                        <p className="mt-0.5 truncate text-xs text-ink-faint">
                          {c.signup!.websites!.map((w) => `${w.url.replace(/^https?:\/\//, "")} (${w.platform === "other" ? w.other || "Other" : labelOf(SITE_PLATFORMS, w.platform)})`).join(", ")}
                        </p>
                      )}
                    </div>
                    <div className="min-w-0">
                      <Steps reached={c.reached} />
                      <p className="mt-1 text-xs text-ink-soft">{c.next ? <>Next: <b className="font-medium text-ink">{c.next.label}</b></> : <b className="font-medium text-good">Fully onboarded</b>}</p>
                      <p className="text-[11px] text-ink-faint">{c.stores} store{c.stores === 1 ? "" : "s"} · {c.orders} orders{c.rechargedPaise ? ` · ₹${(c.rechargedPaise / 100).toLocaleString("en-IN")} recharged` : ""}</p>
                    </div>
                    <div className="flex items-center gap-2 md:flex-col md:items-end">
                      <StatusChip s={c.crmStatus} />
                      <span className="text-[11px] text-ink-faint">Signed up {when(c.createdAt)}</span>
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
