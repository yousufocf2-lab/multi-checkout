// One lead: contact, form answers, source, and the follow-up log (status, notes, demo booking).
import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Form, Link, useActionData, useLoaderData, useNavigation } from "@remix-run/react";
import { useEffect, useRef, useState } from "react";
import { Icon } from "~/components/Icons";
import { SourceTagChip, StatusChip } from "~/components/LeadChips";
import { Notice, SubmitButton } from "~/components/ui";
import { requireAdmin } from "~/lib/auth.server";
import { DEMO_MINUTES, KIND_LABEL, LEAD_STATUSES, demoLabel, parseLeadKey, slotsClash } from "~/lib/leads";
import { bookedSlots, getLead, updateLead } from "~/lib/leads.server";

export const meta: MetaFunction = () => [{ title: "Lead · Growpefy" }];

export async function loader({ request, params }: LoaderFunctionArgs) {
  await requireAdmin(request);
  const k = parseLeadKey(String(params.key));
  if (!k) throw new Response("Not found", { status: 404 });
  const lead = await getLead(k.kind, k.id);
  if (!lead) throw new Response("Lead not found", { status: 404 });
  return json({
    key: params.key!, lead: { ...lead, crm: lead.crm ? { ...lead.crm, demoAt: lead.crm.demoAt?.toISOString() ?? null, updatedAt: lead.crm.updatedAt.toISOString() } : null },
    booked: await bookedSlots(params.key),
  });
}

export async function action({ request, params }: ActionFunctionArgs) {
  await requireAdmin(request);
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
  });
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

export default function Lead() {
  const { lead: l, booked, key } = useLoaderData<typeof loader>();
  const a = useActionData<typeof action>();
  const nav = useNavigation();
  const [status, setStatus] = useState(l.crm?.status ?? "new");
  const [demo, setDemo] = useState(toLocal(l.crm?.demoAt));
  const form = useRef<HTMLFormElement>(null);
  useEffect(() => { if (a?.ok) { form.current?.reset(); setStatus(l.crm?.status ?? "new"); } }, [a, l.crm?.status]);
  const clash = status === "demo_scheduled" && demo ? booked.find((b) => slotsClash(new Date(b), new Date(`${demo}:00+05:30`))) : undefined;
  const wa = l.phone ? `https://wa.me/91${l.phone.slice(-10)}` : null;
  const notes = [...(l.crm?.notes ?? [])].reverse();

  return (
    <div className="mx-auto max-w-5xl">
      <Link to="/dashboard/leads" className="text-sm text-ink-soft hover:text-ink">← All leads</Link>
      <div className="mb-5 mt-2 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex flex-wrap items-center gap-2 text-[22px] font-semibold tracking-tight">{l.name}<SourceTagChip s={l.source} /><StatusChip s={l.crm?.status ?? "new"} /></h1>
          <p className="mt-1 text-sm text-ink-soft">{KIND_LABEL[l.kind]} · {when(l.createdAt)}</p>
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
          <section className="panel p-5">
            <h2 className="text-sm font-semibold">{l.kind === "meta" ? "Form answers" : "Message"}</h2>
            {l.answers.length === 0 ? <p className="mt-2 text-sm text-ink-faint">{l.kind === "meta" ? "No extra answers on this lead." : "No message."}</p> : (
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
              <label className="block"><span className="label">Note (only you see this)</span>
                <textarea name="note" rows={3} className="input" maxLength={1000} placeholder="e.g. Called, uses Shopify, 300 orders a month. Wants the RTO Shield demo." />
              </label>
              <SubmitButton className="btn-primary w-full" busyText="Saving" disabled={Boolean(clash) || nav.state !== "idle"}>Save</SubmitButton>
            </Form>
          </section>

          <section className="panel">
            <h2 className="border-b border-rule px-5 py-3 text-sm font-semibold">History</h2>
            {notes.length === 0 ? <p className="px-5 py-6 text-sm text-ink-faint">Nothing yet. Call the lead and log what happened.</p> : (
              <ol className="divide-y divide-rule">
                {notes.map((n, i) => (
                  <li key={i} className="px-5 py-3">
                    <p className="flex flex-wrap items-center gap-2 text-xs text-ink-faint">{when(n.at)}{n.status && <StatusChip s={n.status} />}{n.demoAt && <span className="num font-medium text-pine">Demo {demoLabel(n.demoAt)}</span>}</p>
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
