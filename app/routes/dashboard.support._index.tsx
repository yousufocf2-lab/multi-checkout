// Help & support. Store owners: request a callback or raise a complaint.
// Super admin: Leads (website callbacks + signups, with their source), store callbacks, complaints.
import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Form, Link, useActionData, useLoaderData, useNavigation, useSearchParams } from "@remix-run/react";
import { useEffect, useRef, useState } from "react";
import { Icon, type IconName } from "~/components/Icons";
import { Notice, PageHeader, SubmitButton } from "~/components/ui";
import { requireViewer, viewerStores } from "~/lib/auth.server";
import { selectedStore } from "~/lib/selection.server";
import {
  CALL_TIMES, CALLBACK_REASONS, CALLBACK_STATUS, SUPPORT_EMAIL, SUPPORT_HOURS, TICKET_CATEGORIES, TICKET_CHIP, TICKET_STATUS,
  callTimeLabel, reasonLabel,
} from "~/lib/support";
import { CHANNELS, SOURCE_GROUPS, channelLabel, sourceGroup, touchSummary, type Channel } from "~/lib/attribution";
import { createCallback, createTicket, listCallbacks, listSignupLeads, listTickets, ownerContactFor, updateCallback } from "~/lib/support.server";

export const meta: MetaFunction = () => [{ title: "Help & support · Growpefy" }, { name: "robots", content: "noindex" }];

type CbRow = Awaited<ReturnType<typeof listCallbacks>>[number];
const cbOut = ({ attribution: at, ...c }: CbRow) => ({
  ...c, createdAt: c.createdAt.toISOString(), handledAt: c.handledAt?.toISOString() ?? null,
  via: touchSummary(at?.last ?? at?.first), landing: (at?.last ?? at?.first)?.lp ?? null,
  firstVia: at?.first && at?.last && at.first.at !== at.last.at ? touchSummary(at.first) : null,
});
type StoreOpt = { id: number; name: string };

export async function loader({ request }: LoaderFunctionArgs) {
  const v = await requireViewer(request);
  const url = new URL(request.url);
  const iso = <T extends { createdAt: Date }>(r: T) => ({ ...r, createdAt: r.createdAt.toISOString() });
  if (v.role === "admin") {
    const t = url.searchParams.get("tab");
    const tab = t === "complaints" ? "complaints" : t === "store" ? "store" : "leads";
    const lk = url.searchParams.get("lk") === "signups" ? "signups" : "callbacks";
    const src = url.searchParams.get("src") ?? "all";
    const cbStatus = url.searchParams.get("cb") ?? "new";
    const tkStatus = url.searchParams.get("tk") ?? "active";
    const [callbacks, signups, tickets, newLeads, newStore, activeTickets] = await Promise.all([
      tab === "leads" && lk === "callbacks" ? listCallbacks({ status: cbStatus, source: "website", limit: 300 })
        : tab === "store" ? listCallbacks({ status: cbStatus, source: "dashboard" }) : Promise.resolve([]),
      tab === "leads" && lk === "signups" ? listSignupLeads(200) : Promise.resolve([]),
      tab === "complaints" ? listTickets(v, { status: tkStatus }) : Promise.resolve([]),
      listCallbacks({ status: "new", source: "website", limit: 500 }).then((r) => r.length),
      listCallbacks({ status: "new", source: "dashboard", limit: 500 }).then((r) => r.length),
      listTickets(v, { status: "active" }).then((r) => r.filter((x) => x.lastBy === "owner").length),
    ]);
    const bySrc = <T extends { channel?: string | null }>(rows: T[]) => (tab === "leads" && src !== "all" ? rows.filter((r) => sourceGroup(r.channel) === src) : rows);
    const signupRows = signups.map((u) => ({
      id: u.id, name: u.name, phone: u.phone, email: u.email, verified: u.signupWith === "phone", kycStatus: u.kycStatus, stores: Number(u.stores),
      channel: u.attribution?.channel ?? null, via: touchSummary(u.attribution?.last ?? u.attribution?.first), landing: (u.attribution?.last ?? u.attribution?.first)?.lp ?? null,
      createdAt: u.createdAt.toISOString(),
    }));
    return json({
      admin: true as const, tab, lk, src, cbStatus, tkStatus, newCount: newLeads, newStore, activeTickets,
      callbacks: bySrc(callbacks.map(cbOut)),
      signups: bySrc(signupRows),
      tickets: tickets.map((x) => ({ ...iso(x), updatedAt: x.updatedAt.toISOString(), unread: x.lastBy === "owner" && (!x.adminSeenAt || x.adminSeenAt < x.updatedAt) })),
      me: null as { name: string; phone: string; email: string } | null, stores: [] as StoreOpt[], selected: null as number | null, myCallbacks: [] as ReturnType<typeof cbOut>[],
    });
  }
  const [me, list, tickets, myCallbacks, selected] = await Promise.all([
    ownerContactFor(v.userId), viewerStores(v), listTickets(v), listCallbacks({ userId: v.userId, limit: 5 }), selectedStore(request),
  ]);
  return json({
    admin: false as const, tab: "", lk: "", src: "", cbStatus: "", tkStatus: "", newCount: 0, newStore: 0, activeTickets: 0, callbacks: [] as ReturnType<typeof cbOut>[],
    signups: [] as { id: number; name: string; phone: string | null; email: string | null; verified: boolean; kycStatus: string; stores: number; channel: string | null; via: string; landing: string | null; createdAt: string }[],
    me: { name: me?.name ?? v.name, phone: me?.phone ?? "", email: me?.email ?? "" },
    stores: list.map((s): StoreOpt => ({ id: s.id, name: s.name })), selected: selected ?? null,
    tickets: tickets.map((t) => ({ ...iso(t), updatedAt: t.updatedAt.toISOString(), unread: t.lastBy === "admin" && (!t.ownerSeenAt || t.ownerSeenAt < t.updatedAt) })),
    myCallbacks: myCallbacks.map(cbOut),
  });
}

export async function action({ request }: ActionFunctionArgs) {
  const v = await requireViewer(request);
  const fd = await request.formData();
  const intent = String(fd.get("intent") ?? "");
  if (intent === "callback") {
    // the owner's own login number was confirmed with an OTP at signup
    const mine = v.role === "owner" ? (await ownerContactFor(v.userId))?.phone : null;
    const verified = Boolean(mine && String(fd.get("phone") ?? "").replace(/\D/g, "").endsWith(mine));
    return json({ intent, ...(await createCallback(request, fd, { source: "dashboard", viewer: v, verified })) });
  }
  if (intent === "complaint") {
    if (v.role !== "owner") return json({ intent, ok: false as const, errors: { form: "Only store owners raise complaints" } as Record<string, string> });
    return json({ intent, ...(await createTicket(v, fd)) });
  }
  if (intent === "cbUpdate" && v.role === "admin") {
    await updateCallback(Number(fd.get("id")), String(fd.get("status") ?? ""), String(fd.get("note") ?? "").trim());
    return json({ intent, ok: true as const, message: "Saved", id: undefined as number | undefined });
  }
  return json({ intent, ok: false as const, errors: { form: "Unknown action" } as Record<string, string> }, { status: 400 });
}

type D = ReturnType<typeof useLoaderData<typeof loader>>;
const when = (iso: string) => new Date(iso).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

const CB_CHIP: Record<string, string> = { new: "bg-sky-50 text-sky-800", contacted: "bg-emerald-50 text-good", closed: "bg-paper-sunk text-ink-soft" };

export default function Support() {
  const d = useLoaderData<typeof loader>();
  return d.admin ? <AdminInbox d={d} /> : <OwnerHelp d={d} />;
}

// ---------------- store owner ----------------

function OwnerHelp({ d }: { d: D }) {
  const [sp, setSp] = useSearchParams();
  const a = useActionData<typeof action>();
  const mode = sp.get("new") === "callback" ? "callback" : sp.get("new") === "complaint" ? "complaint" : null;
  const open = (m: "callback" | "complaint" | null) => { const n = new URLSearchParams(sp); if (m) n.set("new", m); else n.delete("new"); setSp(n, { preventScrollReset: true }); };
  const done = a && a.ok ? a : null;
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => { if (mode) panel.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }); }, [mode]);
  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader title="Help & support" description="Stuck somewhere? Ask for a call from our team or raise a complaint and track it here." />

      {done && <div className="mb-5"><Notice tone="success">{done.message}</Notice></div>}

      <div className="grid gap-3 sm:grid-cols-2">
        <OptionCard active={mode === "callback"} icon="phone" title="Request a callback" text="Tell us what it's about and when to call. Our team calls you back on your mobile." onClick={() => open(mode === "callback" ? null : "callback")} />
        <OptionCard active={mode === "complaint"} icon="flag" title="Raise a complaint" text="Something not working? Write it down, we reply here and you can follow every update." onClick={() => open(mode === "complaint" ? null : "complaint")} />
      </div>

      <div ref={panel}>
        {mode === "callback" && <CallbackForm d={d} key={done?.intent === "callback" ? "sent" : "form"} />}
        {mode === "complaint" && <ComplaintForm d={d} key={done?.intent === "complaint" ? "sent" : "form"} />}
      </div>

      <section className="panel mt-6">
        <header className="flex items-center justify-between gap-3 border-b border-rule px-5 py-4">
          <h2 className="text-[15px] font-semibold">Your complaints</h2>
          {d.tickets.length > 0 && <span className="text-xs text-ink-faint">{d.tickets.filter((t) => t.status === "open" || t.status === "in_progress").length} open</span>}
        </header>
        {d.tickets.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-ink-faint">No complaints yet. If anything breaks, raise one and we'll take it from there.</p>
        ) : (
          <ul className="divide-y divide-rule">
            {d.tickets.map((t) => <TicketRow key={t.id} t={t} />)}
          </ul>
        )}
      </section>

      {d.myCallbacks.length > 0 && (
        <section className="panel mt-4">
          <header className="border-b border-rule px-5 py-4"><h2 className="text-[15px] font-semibold">Your callback requests</h2></header>
          <ul className="divide-y divide-rule">
            {d.myCallbacks.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-5 py-3 text-sm">
                <Icon name="phone" className="h-4 w-4 text-ink-faint" />
                <span className="font-medium">{reasonLabel(c.reason)}</span>
                <span className="text-xs text-ink-faint">{when(c.createdAt)} · {callTimeLabel(c.preferredTime)}</span>
                <span className={`ml-auto rounded-full px-2 py-0.5 text-xs font-medium ${CB_CHIP[c.status] ?? CB_CHIP.new}`}>{c.status === "new" ? "Waiting for call" : CALLBACK_STATUS[c.status as keyof typeof CALLBACK_STATUS] ?? c.status}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <a href={`mailto:${SUPPORT_EMAIL}`} className="group flex items-center gap-3 rounded-2xl border border-rule bg-surface px-4 py-3.5 transition hover:-translate-y-0.5 hover:border-rule-strong hover:shadow-lift">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-sky-50 text-sky-700"><Icon name="mail" className="h-5 w-5" /></span>
          <span className="min-w-0 flex-1"><span className="block text-xs text-ink-faint">Email us</span><span className="block truncate font-medium">{SUPPORT_EMAIL}</span></span>
          <Icon name="arrow" className="h-4 w-4 text-ink-faint transition group-hover:translate-x-0.5 group-hover:text-ink" />
        </a>
        <div className="flex items-center gap-3 rounded-2xl border border-rule bg-surface px-4 py-3.5">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-50 text-emerald-700"><Icon name="clock" className="h-5 w-5" /></span>
          <span><span className="block text-xs text-ink-faint">Support hours</span><span className="block font-medium">{SUPPORT_HOURS}</span></span>
        </div>
      </div>
    </div>
  );
}

function OptionCard({ active, icon, title, text, onClick }: { active: boolean; icon: IconName; title: string; text: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} aria-expanded={active}
      className={`group flex items-start gap-4 rounded-2xl border p-5 text-left transition duration-200 hover:-translate-y-0.5 hover:shadow-lift focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pine/40 ${active ? "border-pine bg-pine-tint/50" : "border-rule bg-surface hover:border-rule-strong"}`}>
      <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl transition ${active ? "bg-pine text-white" : "bg-pine-tint text-pine group-hover:bg-pine group-hover:text-white"}`}><Icon name={icon} className="h-5 w-5" /></span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2 font-semibold">{title}<Icon name="chevron" className={`h-4 w-4 text-ink-faint transition ${active ? "rotate-180" : "-rotate-90 group-hover:translate-x-0.5"}`} /></span>
        <span className="mt-1 block text-sm text-ink-soft">{text}</span>
      </span>
    </button>
  );
}

function StoreSelect({ d }: { d: D }) {
  if (d.stores.length === 0) return null;
  return (
    <label className="block">
      <span className="label">Store</span>
      <select name="storeId" className="input" defaultValue={String(d.selected ?? d.stores[0]?.id ?? "")}>
        {d.stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        {d.stores.length > 1 && <option value="">All stores / not store specific</option>}
      </select>
    </label>
  );
}

function errs(a: ReturnType<typeof useActionData<typeof action>>, intent: string) {
  return (a && !a.ok && a.intent === intent ? a.errors : {}) as Record<string, string | undefined>;
}

function CallbackForm({ d }: { d: D }) {
  const a = useActionData<typeof action>();
  const sent = a?.ok && a.intent === "callback";
  const e = errs(a, "callback");
  if (sent) return <SentCard icon="phone" title="Callback requested" text={a.message} />;
  return (
    <Form method="post" className="panel mt-3 animate-fadein space-y-4 p-5">
      {e.form && <Notice tone="error">{e.form}</Notice>}
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block"><span className="label">Your name</span><input name="name" className="input" defaultValue={d.me?.name} autoComplete="name" aria-invalid={Boolean(e.name) || undefined} />{e.name && <span className="error-text">{e.name}</span>}</label>
        <label className="block"><span className="label">Mobile number</span>
          <span className="relative block"><span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm text-ink-faint">+91</span>
            <input name="phone" className="input pl-11" inputMode="numeric" maxLength={10} defaultValue={d.me?.phone ?? ""} autoComplete="tel-national" aria-invalid={Boolean(e.phone) || undefined} /></span>
          {e.phone && <span className="error-text">{e.phone}</span>}
        </label>
        <label className="block"><span className="label">Email <span className="font-normal text-ink-faint">· optional</span></span><input name="email" type="email" className="input" defaultValue={d.me?.email ?? ""} autoComplete="email" aria-invalid={Boolean(e.email) || undefined} />{e.email && <span className="error-text">{e.email}</span>}</label>
        <StoreSelect d={d} />
        <label className="block"><span className="label">What's it about?</span>
          <select name="reason" className="input" defaultValue="" aria-invalid={Boolean(e.reason) || undefined}>
            <option value="" disabled>Choose a reason</option>
            {CALLBACK_REASONS.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
          </select>{e.reason && <span className="error-text">{e.reason}</span>}
        </label>
        <label className="block"><span className="label">Best time to call</span>
          <select name="time" className="input" defaultValue="anytime">{CALL_TIMES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}</select>
        </label>
      </div>
      <label className="block"><span className="label">Anything we should know? <span className="font-normal text-ink-faint">· optional</span></span><textarea name="message" rows={3} className="input" maxLength={1000} /></label>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-ink-faint">We call {SUPPORT_HOURS}.</p>
        <SubmitButton intent="callback" busyText="Sending…" className="btn-primary px-5"><Icon name="phone" className="h-4 w-4" />Request callback</SubmitButton>
      </div>
    </Form>
  );
}

function ComplaintForm({ d }: { d: D }) {
  const a = useActionData<typeof action>();
  const sent = a?.ok && a.intent === "complaint";
  const e = errs(a, "complaint");
  if (sent) return <SentCard icon="flag" title="Complaint raised" text={a.message} to={a.id ? `/dashboard/support/${a.id}` : undefined} />;
  return (
    <Form method="post" className="panel mt-3 animate-fadein space-y-4 p-5">
      {e.form && <Notice tone="error">{e.form}</Notice>}
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block"><span className="label">Category</span>
          <select name="category" className="input" defaultValue="" aria-invalid={Boolean(e.category) || undefined}>
            <option value="" disabled>Choose a category</option>
            {TICKET_CATEGORIES.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
          </select>{e.category && <span className="error-text">{e.category}</span>}
        </label>
        <StoreSelect d={d} />
      </div>
      <label className="block"><span className="label">Subject</span><input name="subject" className="input" maxLength={120} placeholder="e.g. Order not created in Shopify" aria-invalid={Boolean(e.subject) || undefined} />{e.subject && <span className="error-text">{e.subject}</span>}</label>
      <label className="block"><span className="label">What happened?</span>
        <textarea name="body" rows={5} className="input" maxLength={4000} placeholder="Order number, what you expected and what happened instead. Steps to repeat it help us fix it faster." aria-invalid={Boolean(e.body) || undefined} />
        {e.body && <span className="error-text">{e.body}</span>}
      </label>
      <div className="flex justify-end"><SubmitButton intent="complaint" busyText="Raising…" className="btn-primary px-5"><Icon name="send" className="h-4 w-4" />Raise complaint</SubmitButton></div>
    </Form>
  );
}

function SentCard({ icon, title, text, to }: { icon: IconName; title: string; text: string; to?: string }) {
  return (
    <div className="panel mt-3 flex animate-fadein items-start gap-4 p-5">
      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-emerald-50 text-good"><Icon name="check" className="h-5 w-5" strokeWidth={2.4} /></span>
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-2 font-semibold"><Icon name={icon} className="h-4 w-4 text-ink-faint" />{title}</p>
        <p className="mt-1 text-sm text-ink-soft">{text}</p>
        {to && <Link to={to} className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-pine hover:underline">Open complaint <Icon name="arrow" className="h-4 w-4" /></Link>}
      </div>
    </div>
  );
}

function TicketRow({ t, admin = false }: { t: D["tickets"][number]; admin?: boolean }) {
  return (
    <li>
      <Link to={`/dashboard/support/${t.id}`} className="group flex items-center gap-3 px-5 py-3.5 transition hover:bg-paper/60">
        <span className={`h-2 w-2 shrink-0 rounded-full ${t.unread ? "bg-pine" : "bg-transparent"}`} aria-label={t.unread ? "New reply" : undefined} />
        <div className="min-w-0 flex-1">
          <p className={`truncate text-sm ${t.unread ? "font-semibold" : "font-medium"}`}><span className="num text-ink-faint">#{t.id}</span> {t.subject}</p>
          <p className="truncate text-xs text-ink-faint">
            {reasonLabel(t.category)}{t.storeName ? ` · ${t.storeName}` : ""}{admin && t.ownerName ? ` · ${t.ownerName}` : ""} · updated {when(t.updatedAt)}
            {t.lastBy === "admin" && !admin ? " · Growpefy replied" : ""}{t.lastBy === "owner" && admin ? " · waiting for us" : ""}
          </p>
        </div>
        <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${TICKET_CHIP[t.status] ?? TICKET_CHIP.open}`}>{TICKET_STATUS[t.status as keyof typeof TICKET_STATUS] ?? t.status}</span>
        <Icon name="chevron" className="h-4 w-4 shrink-0 -rotate-90 text-ink-faint transition group-hover:translate-x-0.5" />
      </Link>
    </li>
  );
}

// ---------------- super admin ----------------

function AdminInbox({ d }: { d: D }) {
  const [sp, setSp] = useSearchParams();
  const go = (patch: Record<string, string | null>) => { const n = new URLSearchParams(sp); for (const [k, v] of Object.entries(patch)) { if (v == null) n.delete(k); else n.set(k, v); } setSp(n, { preventScrollReset: true }); };
  const tabs = [["leads", "Leads", d.newCount], ["store", "Store callbacks", d.newStore], ["complaints", "Complaints", d.activeTickets]] as const;
  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader title="Support inbox" description="Sales leads from the website, callback requests from stores, and complaints." />
      <div className="mb-4 flex gap-1 overflow-x-auto border-b border-rule">
        {tabs.map(([id, label, n]) => (
          <button key={id} type="button" onClick={() => go({ tab: id === "leads" ? null : id, cb: null, src: null, lk: null })}
            className={`-mb-px flex shrink-0 items-center gap-2 border-b-2 px-3 py-2.5 text-sm font-medium transition ${d.tab === id ? "border-ink text-ink" : "border-transparent text-ink-soft hover:text-ink"}`}>
            {label}{n > 0 && <span className="num rounded-full bg-pine px-1.5 text-[11px] font-semibold text-white">{n}</span>}
          </button>
        ))}
      </div>
      {d.tab === "leads" ? (
        <>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <div className="flex gap-1 rounded-lg bg-paper-sunk p-1 text-xs font-medium">
              {([["callbacks", "Callback requests"], ["signups", "Signups"]] as const).map(([k, l]) => (
                <button key={k} type="button" onClick={() => go({ lk: k === "callbacks" ? null : k })} className={`rounded-md px-3 py-1.5 ${d.lk === k ? "bg-white text-ink shadow-sm" : "text-ink-soft hover:text-ink"}`}>{l}</button>
              ))}
            </div>
            <span className="flex flex-wrap gap-3">
              <Link to="/dashboard/leads" className="text-xs font-semibold text-pine hover:underline">Open Leads (with Meta form leads, notes and demos) →</Link>
              <Link to="/dashboard/marketing" className="text-xs font-medium text-ink-soft hover:underline">Ad spend and cost per lead</Link>
            </span>
          </div>
          <div className="mb-1 flex flex-wrap items-center gap-x-1 text-[11px] font-semibold uppercase tracking-wide text-ink-faint">Source</div>
          <Filters value={d.src} options={[["all", "All sources"], ...SOURCE_GROUPS.map((g) => [g.id, g.label] as const)]} onPick={(v) => go({ src: v === "all" ? null : v })} />
          {d.lk === "callbacks" ? (
            <>
              <Filters value={d.cbStatus} options={[["new", "New"], ["contacted", "Contacted"], ["closed", "Closed"], ["all", "All"]]} onPick={(v) => go({ cb: v === "new" ? null : v })} />
              {d.callbacks.length === 0 ? <p className="panel px-5 py-10 text-center text-sm text-ink-faint">No leads here.</p> : (
                <ul className="space-y-3">{d.callbacks.map((c) => <CallbackCard key={c.id} c={c} lead />)}</ul>
              )}
            </>
          ) : (
            <section className="panel overflow-hidden">
              {d.signups.length === 0 ? <p className="px-5 py-10 text-center text-sm text-ink-faint">No signups here.</p> : (
                <ul className="divide-y divide-rule">{d.signups.map((u) => <SignupRow key={u.id} u={u} />)}</ul>
              )}
            </section>
          )}
        </>
      ) : d.tab === "store" ? (
        <>
          <Filters value={d.cbStatus} options={[["new", "New"], ["contacted", "Contacted"], ["closed", "Closed"], ["all", "All"]]} onPick={(v) => go({ cb: v === "new" ? null : v })} />
          {d.callbacks.length === 0 ? <p className="panel px-5 py-10 text-center text-sm text-ink-faint">No callback requests from stores.</p> : (
            <ul className="space-y-3">{d.callbacks.map((c) => <CallbackCard key={c.id} c={c} />)}</ul>
          )}
        </>
      ) : (
        <>
          <Filters value={d.tkStatus} options={[["active", "Open & in progress"], ["resolved", "Resolved"], ["closed", "Closed"], ["all", "All"]]} onPick={(v) => go({ tk: v === "active" ? null : v })} />
          <section className="panel">
            {d.tickets.length === 0 ? <p className="px-5 py-10 text-center text-sm text-ink-faint">No complaints here.</p> : (
              <ul className="divide-y divide-rule">{d.tickets.map((t) => <TicketRow key={t.id} t={t} admin />)}</ul>
            )}
          </section>
        </>
      )}
    </div>
  );
}

/** Source chip: colour of the channel, "Paid" for ad platforms. */
function SourceChip({ channel }: { channel: string | null }) {
  const c = CHANNELS[(channel ?? "untracked") as Channel | "untracked"] ?? CHANNELS.untracked;
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-rule bg-white px-2 py-0.5 text-[11px] font-semibold text-ink">
      <span className="h-2 w-2 rounded-full" style={{ background: c.color }} />{c.label}{c.paid && <span className="rounded bg-amber-50 px-1 text-[9px] font-bold uppercase text-amber-800">Paid</span>}
    </span>
  );
}

function Verified({ yes }: { yes: boolean }) {
  return yes
    ? <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-good"><Icon name="check" className="h-3 w-3" />Number verified</span>
    : <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-800"><Icon name="alert" className="h-3 w-3" />Not verified</span>;
}

function SignupRow({ u }: { u: D["signups"][number] }) {
  const kyc: Record<string, string> = { pending: "KYC pending", submitted: "KYC submitted", approved: "KYC approved", rejected: "KYC rejected" };
  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3.5">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-sky-50 text-sky-700"><Icon name="users" className="h-4 w-4" /></span>
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-2 text-sm font-semibold">{u.name}<Verified yes={u.verified} /><span className="rounded-full bg-paper-sunk px-2 py-0.5 text-[11px] font-medium text-ink-soft">{kyc[u.kycStatus] ?? u.kycStatus}{u.stores ? ` · ${u.stores} store${u.stores === 1 ? "" : "s"}` : ""}</span></p>
        <p className="mt-0.5 truncate text-xs text-ink-soft">{[u.phone ? `+91 ${u.phone}` : null, u.email].filter(Boolean).join(" · ")} · {when(u.createdAt)}</p>
      </div>
      <div className="min-w-0 text-right">
        <SourceChip channel={u.channel} />
        {u.via && <p className="mt-0.5 max-w-[280px] truncate text-[11px] text-ink-faint" title={u.via}>{u.via}{u.landing ? ` · landed on ${u.landing}` : ""}</p>}
      </div>
      {u.phone && <a href={`tel:+91${u.phone}`} className="btn-quiet h-8 px-2.5 text-xs"><Icon name="phone" className="h-3.5 w-3.5" />Call</a>}
    </li>
  );
}

function Filters({ value, options, onPick }: { value: string; options: (readonly [string, string])[]; onPick: (v: string) => void }) {
  return (
    <div className="mb-4 flex gap-1.5 overflow-x-auto">
      {options.map(([v, l]) => (
        <button key={v} type="button" onClick={() => onPick(v)}
          className={`shrink-0 rounded-full border px-3 py-1 text-xs font-medium transition ${value === v ? "border-ink bg-ink text-white" : "border-rule-strong text-ink-soft hover:border-ink"}`}>{l}</button>
      ))}
    </div>
  );
}

function CallbackCard({ c, lead }: { c: D["callbacks"][number]; lead?: boolean }) {
  const nav = useNavigation();
  const busy = nav.state === "submitting" && nav.formData?.get("id") === String(c.id);
  const [status, setStatus] = useState(c.status);
  return (
    <li className="panel p-4">
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-2 font-semibold">
            {c.name}
            <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${CB_CHIP[c.status] ?? CB_CHIP.new}`}>{CALLBACK_STATUS[c.status as keyof typeof CALLBACK_STATUS] ?? c.status}</span>
            {lead ? <SourceChip channel={c.channel} /> : <span className="rounded-full bg-paper-sunk px-2 py-0.5 text-[11px] font-medium text-ink-soft">{c.source === "website" ? (c.channel ? `Website · ${channelLabel(c.channel)}` : "Website") : c.storeName ? `Dashboard · ${c.storeName}` : "Dashboard"}</span>}
            <Verified yes={c.phoneVerified} />
          </p>
          {lead && (c.via || c.landing) && (
            <p className="mt-1 text-xs text-ink-faint">
              {c.via && <>Came from <span className="font-medium text-ink-soft">{c.via}</span></>}{c.landing ? <>{c.via ? " · " : ""}landed on <span className="font-medium text-ink-soft">{c.landing}</span></> : null}
              {c.firstVia && <> · first visit: {c.firstVia}</>}
            </p>
          )}
          <p className="mt-1 text-sm"><span className="font-medium">{reasonLabel(c.reason)}</span><span className="text-ink-faint"> · {callTimeLabel(c.preferredTime)} · {when(c.createdAt)}</span></p>
          {c.message && <p className="mt-2 whitespace-pre-line rounded-lg bg-paper px-3 py-2 text-sm text-ink-soft">{c.message}</p>}
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <a href={`tel:+91${c.phone}`} className="btn-secondary h-9 px-3 text-sm"><Icon name="phone" className="h-4 w-4" />+91 {c.phone}</a>
          <a href={`https://wa.me/91${c.phone}`} target="_blank" rel="noreferrer" className="btn-quiet h-9 px-3 text-sm"><Icon name="chat" className="h-4 w-4" />WhatsApp</a>
          {c.email && <a href={`mailto:${c.email}`} className="btn-quiet h-9 px-3 text-sm"><Icon name="mail" className="h-4 w-4" />Email</a>}
        </div>
      </div>
      <Form method="post" className="mt-3 flex flex-wrap items-center gap-2 border-t border-rule pt-3">
        <input type="hidden" name="id" value={c.id} />
        <select name="status" value={status} onChange={(e) => setStatus(e.target.value)} className="input h-9 w-auto py-0 text-sm">
          {Object.entries(CALLBACK_STATUS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
        <input name="note" defaultValue={c.adminNote ?? ""} placeholder="Note (only admins see this)" className="input h-9 min-w-0 flex-1 text-sm" maxLength={500} />
        <button name="intent" value="cbUpdate" className="btn-primary h-9 px-4 text-sm" disabled={busy}>{busy ? "Saving…" : "Save"}</button>
      </Form>
    </li>
  );
}
