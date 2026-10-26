// One lead: contact, form answers, source, and the follow-up log (status, notes, demo booking).
import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { Form, Link, useActionData, useLoaderData, useLocation, useNavigate, useNavigation } from "@remix-run/react";
import { useEffect, useRef, useState } from "react";
import { Icon } from "~/components/Icons";
import { SourceTagChip, StatusChip } from "~/components/LeadChips";
import { Notice, SubmitButton } from "~/components/ui";
import { requireAdmin } from "~/lib/auth.server";
import { DEMO_MINUTES, KIND_LABEL, LEAD_STATUSES, agoLabel, demoLabel, matchLead, parseLeadKey, readLeadFilter, slotsClash } from "~/lib/leads";
import { bookedSlots, getLead, listLeads, updateLead } from "~/lib/leads.server";
import { listClients } from "~/lib/clients.server";
import { messagesFor } from "~/lib/welcome.server";
import { MSG_LABEL, STATUS_LABEL } from "~/lib/welcome";
import { STEPS } from "~/lib/clients";

export const meta: MetaFunction = () => [{ title: "Lead · Growpefy" }];

/** Previous / next lead in the same list (tab, filters and search) the person opened this one from. */
async function neighbours(key: string, sp: URLSearchParams) {
  const all = await listLeads();
  const f = readLeadFilter(sp);
  const at = all.findIndex((l) => l.key === key);
  const list = all.filter((l) => matchLead(l, f));
  const pos = list.findIndex((l) => l.key === key);
  // Works even after this lead has left the list (e.g. it was just marked "not reachable")
  const before = at < 0 ? [] : all.slice(0, at).filter((l) => matchLead(l, f));
  const after = at < 0 ? [] : all.slice(at + 1).filter((l) => matchLead(l, f));
  return { prev: before.at(-1)?.key ?? null, next: after[0]?.key ?? null, pos: pos >= 0 ? pos + 1 : null, total: list.length };
}

export async function loader({ request, params }: LoaderFunctionArgs) {
  await requireAdmin(request);
  const k = parseLeadKey(String(params.key));
  if (!k) throw new Response("Not found", { status: 404 });
  const lead = await getLead(k.kind, k.id);
  if (!lead) throw new Response("Lead not found", { status: 404 });
  const sp = new URL(request.url).searchParams;
  return json({
    key: params.key!, lead: { ...lead, crm: lead.crm ? { ...lead.crm, demoAt: lead.crm.demoAt?.toISOString() ?? null, updatedAt: lead.crm.updatedAt.toISOString() } : null },
    booked: await bookedSlots(params.key),
    // How far this person has got with Growpefy (signup → KYC → store → live → order → recharge)
    progress: lead.owner ? (await listClients(lead.owner.id))[0] ?? null : null,
    nav: await neighbours(String(params.key), sp),
    welcome: (await messagesFor(lead.phone, lead.email)).map((m) => ({ id: m.id, msg: m.msg, channel: m.channel, status: m.status, error: m.error, at: (m.sentAt ?? m.createdAt).toISOString() })),
  });
}

export async function action({ request, params }: ActionFunctionArgs) {
  const v = await requireAdmin(request);
  const k = parseLeadKey(String(params.key));
  if (!k) throw new Response("Not found", { status: 404 });
  const fd = await request.formData();
  const local = String(fd.get("demoAt") ?? ""); // YYYY-MM-DDTHH:mm in IST
  const stores = String(fd.get("stores") ?? "").trim();
  const r = await updateLead(k.kind, k.id, {
    status: String(fd.get("status") ?? ""),
    note: String(fd.get("note") ?? ""),
    demoAt: /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(local) ? `${local}:00+05:30` : null,
    storesCount: stores === "" ? null : Number(stores),
  }, v.staff?.name ?? "Admin");
  // "Save & next": go straight to the next lead in the same list
  const next = String(fd.get("next") ?? "");
  if (r.ok && fd.get("intent") === "saveNext" && parseLeadKey(next)) throw redirect(`/dashboard/leads/${next}${new URL(request.url).search}`);
  return json(r.ok ? { ok: true as const, error: null } : { ok: false as const, error: r.error }, { status: r.ok ? 200 : 400 });
}

const IST = { timeZone: "Asia/Kolkata" } as const;
const when = (iso: string) => new Date(iso).toLocaleString("en-IN", { ...IST, day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" });
/** ISO → "YYYY-MM-DDTHH:mm" in IST for <input type="datetime-local"> */
const toLocal = (iso: string | null | undefined) => {
  if (!iso) return "";
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { ...IST, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(iso)).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
};

// Keyed by lead so the form starts fresh when moving to the next / previous lead
export default function Lead() {
  const { key } = useLoaderData<typeof loader>();
  return <LeadView key={key} />;
}

function LeadView() {
  const { lead: l, booked, key, progress, welcome, nav: around } = useLoaderData<typeof loader>();
  const a = useActionData<typeof action>();
  const nav = useNavigation();
  const { search } = useLocation();
  const go = useNavigate();
  const to = (k: string | null) => (k ? `/dashboard/leads/${k}${search}` : null);
  // ← / → keys and a sideways swipe on phones move between leads
  useEffect(() => {
    const prev = to(around.prev), next = to(around.next);
    const typing = (t: EventTarget | null) => t instanceof HTMLElement && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName);
    const onKey = (e: KeyboardEvent) => {
      if (typing(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "ArrowLeft" && prev) go(prev);
      if (e.key === "ArrowRight" && next) go(next);
    };
    let sx = 0, sy = 0, st = 0;
    const onStart = (e: TouchEvent) => { if (typing(e.target)) { st = 0; return; } sx = e.touches[0].clientX; sy = e.touches[0].clientY; st = Date.now(); };
    const onEnd = (e: TouchEvent) => {
      if (!st) return;
      const dx = e.changedTouches[0].clientX - sx, dy = e.changedTouches[0].clientY - sy;
      if (Date.now() - st < 600 && Math.abs(dx) > 70 && Math.abs(dy) < 50) { if (dx < 0 && next) go(next); if (dx > 0 && prev) go(prev); }
      st = 0;
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("touchstart", onStart, { passive: true });
    window.addEventListener("touchend", onEnd, { passive: true });
    return () => { window.removeEventListener("keydown", onKey); window.removeEventListener("touchstart", onStart); window.removeEventListener("touchend", onEnd); };
  }, [around.prev, around.next, search]); // eslint-disable-line react-hooks/exhaustive-deps
  const last = l.crm?.notes.at(-1);
  const [status, setStatus] = useState(l.crm?.status ?? "new");
  const [demo, setDemo] = useState(toLocal(l.crm?.demoAt));
  const form = useRef<HTMLFormElement>(null);
  useEffect(() => { if (a?.ok) { form.current?.reset(); setStatus(l.crm?.status ?? "new"); } }, [a, l.crm?.status]);
  const clash = status === "demo_scheduled" && demo ? booked.find((b) => slotsClash(new Date(b), new Date(`${demo}:00+05:30`))) : undefined;
  const wa = l.phone ? `https://wa.me/91${l.phone.slice(-10)}` : null;
  const notes = [...(l.crm?.notes ?? [])].reverse();

  return (
    <div className="mx-auto max-w-5xl">
      <div className="flex items-center justify-between gap-3">
        <Link to={`/dashboard/leads${search}`} className="text-sm text-ink-soft hover:text-ink">← All leads</Link>
        <div className="flex items-center gap-1" aria-label="Move between leads">
          {around.prev ? <Link to={to(around.prev)!} prefetch="intent" className="btn-secondary h-8 px-2.5 py-0" aria-label="Previous lead" title="Previous lead (←)">‹</Link> : <span className="btn-secondary pointer-events-none h-8 px-2.5 py-0 opacity-40">‹</span>}
          <span className="num min-w-[56px] text-center text-xs text-ink-soft">{around.pos ? `${around.pos} / ${around.total}` : `${around.total} left`}</span>
          {around.next ? <Link to={to(around.next)!} prefetch="intent" className="btn-secondary h-8 px-2.5 py-0" aria-label="Next lead" title="Next lead (→)">›</Link> : <span className="btn-secondary pointer-events-none h-8 px-2.5 py-0 opacity-40">›</span>}
        </div>
      </div>
      <div className="mb-5 mt-2 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex flex-wrap items-center gap-2 text-[22px] font-semibold tracking-tight">{l.name}<SourceTagChip s={l.source} /><StatusChip s={l.crm?.status ?? "new"} /></h1>
          <p className="mt-1 text-sm text-ink-soft">{KIND_LABEL[l.kind]} · {when(l.createdAt)}</p>
          {last && <p className="mt-1 inline-flex items-center gap-1.5 rounded-full bg-sky-50 px-2.5 py-0.5 text-xs font-medium text-sky-800"><Icon name="users" className="h-3.5 w-3.5" />Worked on by {last.by ?? "the team"} · {agoLabel(last.at)}</p>}
        </div>
        <div className="flex flex-wrap gap-2">
          {l.phone && <a href={`tel:+91${l.phone.slice(-10)}`} className="btn-primary"><Icon name="phone" className="h-4 w-4" />+91 {l.phone}</a>}
          {wa && <a href={wa} target="_blank" rel="noreferrer" className="btn-secondary"><Icon name="chat" className="h-4 w-4" />WhatsApp</a>}
          {l.email && <a href={`mailto:${l.email}`} className="btn-secondary"><Icon name="mail" className="h-4 w-4" />Email</a>}
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
        <div className="space-y-5">
          <section className="panel p-5">
            <h2 className="text-sm font-semibold">Details</h2>
            <dl className="mt-3 space-y-2 text-sm">
              <Row k="Phone" v={l.phone ? `+91 ${l.phone}` : "—"} />
              <Row k="Email" v={l.email ?? "—"} />
              {l.facts.map(([k, v]) => <Row key={k} k={k} v={v} />)}
              <Row k="Growpefy account" v={l.owner ? `Signed up · ${l.owner.n} store${l.owner.n === 1 ? "" : "s"} connected` : "Not signed up yet"} />
            </dl>
          </section>
          {progress && (
            <section className="panel p-5">
              <h2 className="text-sm font-semibold">Onboarding progress</h2>
              <ol className="mt-3 space-y-2">
                {STEPS.map((st) => {
                  const at = progress.steps[st.id];
                  const isNext = progress.next?.id === st.id;
                  return (
                    <li key={st.id} className="flex items-center gap-3 text-sm">
                      <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${at ? "bg-pine text-white" : isNext ? "border-2 border-amber-400 text-amber-600" : "border border-rule-strong text-ink-faint"}`}>{at ? "✓" : ""}</span>
                      <span className={`flex-1 ${at ? "" : isNext ? "font-semibold" : "text-ink-faint"}`}>{st.label}{isNext && <span className="ml-2 rounded-full bg-amber-50 px-2 py-px text-[11px] font-medium text-amber-800">Next step</span>}</span>
                      {at && <span className="text-[11px] text-ink-faint">{when(at)}</span>}
                    </li>
                  );
                })}
              </ol>
              <p className="mt-3 text-xs text-ink-soft">{progress.stores} store{progress.stores === 1 ? "" : "s"} · {progress.orders} orders{progress.rechargedPaise ? ` · ₹${(progress.rechargedPaise / 100).toLocaleString("en-IN")} recharged` : ""}</p>
            </section>
          )}
          <section className="panel p-5">
            <h2 className="text-sm font-semibold">{l.kind === "meta" ? "Form answers" : l.kind === "signup" ? "Signup answers" : "Message"}</h2>
            {l.answers.length === 0 ? <p className="mt-2 text-sm text-ink-faint">{l.kind === "meta" ? "No extra answers on this lead." : l.kind === "signup" ? "Signed up before these questions were added." : "No message."}</p> : (
              <dl className="mt-3 space-y-3">
                {l.answers.filter((x): x is NonNullable<typeof x> => x != null).map((x, i) => (
                  <div key={i} className="rounded-lg bg-paper px-3 py-2"><dt className="text-xs text-ink-soft">{x.q}</dt><dd className="mt-0.5 whitespace-pre-line text-sm font-medium">{x.a || "—"}</dd></div>
                ))}
              </dl>
            )}
          </section>
        </div>

        <div className="space-y-5">
          <section className="panel p-5">
            <h2 className="text-sm font-semibold">Update follow-up</h2>
            {a?.ok && <div className="mt-3"><Notice tone="success">Saved</Notice></div>}
            {a && !a.ok && <div className="mt-3"><Notice tone="error">{a.error}</Notice></div>}
            <Form method="post" ref={form} className="mt-3 space-y-3">
              <label className="block"><span className="label">Status</span>
                <select name="status" value={status} onChange={(e) => setStatus(e.target.value)} className="input">
                  {LEAD_STATUSES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
                </select>
              </label>
              {status === "demo_scheduled" && (
                <label className="block"><span className="label">Demo date & time (IST) · {DEMO_MINUTES} min</span>
                  <input type="datetime-local" name="demoAt" value={demo} onChange={(e) => setDemo(e.target.value)} step={900} className="input num" required />
                  {clash
                    ? <span className="mt-1 block text-xs font-medium text-bad">Clashes with the demo at {demoLabel(clash)}. Pick a time more than {DEMO_MINUTES} minutes away.</span>
                    : booked.length > 0 && <span className="mt-1 block text-xs text-ink-faint">Booked: {booked.slice(0, 6).map((b) => demoLabel(b)).join(" · ")}</span>}
                </label>
              )}
              {(status === "customer" || l.crm?.storesCount != null) && !l.owner && (
                <label className="block"><span className="label">Stores connected</span>
                  <input type="number" name="stores" min={0} max={999} defaultValue={l.crm?.storesCount ?? ""} placeholder="e.g. 1" className="input num w-32" />
                </label>
              )}
              <label className="block"><span className="label">Note (only your team sees this)</span>
                <textarea name="note" rows={3} className="input" maxLength={1000} placeholder="e.g. Called, uses Shopify, 300 orders a month. Wants the RTO Shield demo." />
              </label>
              {around.next && <input type="hidden" name="next" value={around.next} />}
              <div className="flex gap-2">
                <SubmitButton intent="save" className="btn-primary flex-1" busyText="Saving" disabled={Boolean(clash) || nav.state !== "idle"}>Save</SubmitButton>
                {around.next && <SubmitButton intent="saveNext" className="btn-secondary flex-1" busyText="Saving" disabled={Boolean(clash) || nav.state !== "idle"}>Save &amp; next lead ›</SubmitButton>}
              </div>
            </Form>
          </section>

          {welcome.length > 0 && (
            <section className="panel p-5">
              <h2 className="text-sm font-semibold">Welcome messages</h2>
              <ul className="mt-2 space-y-1.5">
                {welcome.map((m) => {
                  const st = STATUS_LABEL[m.status] ?? STATUS_LABEL.queued;
                  return (
                    <li key={m.id} className="flex flex-wrap items-center gap-2 text-sm">
                      <Icon name={m.channel === "whatsapp" ? "chat" : "mail"} className="h-4 w-4 text-ink-soft" />
                      <span>{MSG_LABEL[m.msg as "lead" | "signup"]} · {m.channel === "whatsapp" ? "WhatsApp" : "Email"}</span>
                      <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${st.tone}`}>{st.label}</span>
                      <span className="ml-auto text-[11px] text-ink-faint">{when(m.at)}</span>
                      {m.error && m.status !== "sent" && <p className="w-full pl-6 text-xs text-bad">{m.error}</p>}
                    </li>
                  );
                })}
              </ul>
            </section>
          )}
          <section className="panel">
            <h2 className="border-b border-rule px-5 py-3 text-sm font-semibold">History</h2>
            {notes.length === 0 ? <p className="px-5 py-6 text-sm text-ink-faint">Nothing yet. Call the lead and log what happened.</p> : (
              <ol className="divide-y divide-rule">
                {notes.map((n, i) => (
                  <li key={i} className="px-5 py-3">
                    <p className="flex flex-wrap items-center gap-2 text-xs text-ink-faint">{n.by && <b className="font-semibold text-ink-soft">{n.by}</b>}{when(n.at)}{n.status && <StatusChip s={n.status} />}{n.demoAt && <span className="num font-medium text-pine">Demo {demoLabel(n.demoAt)}</span>}</p>
                    {n.text && <p className="mt-1 whitespace-pre-line text-sm">{n.text}</p>}
                  </li>
                ))}
              </ol>
            )}
          </section>
        </div>
      </div>
      <p className="mt-4 text-[11px] text-ink-faint">Lead {key}</p>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return <div className="flex gap-3"><dt className="w-36 shrink-0 text-ink-soft">{k}</dt><dd className="min-w-0 break-words font-medium">{v}</dd></div>;
}
