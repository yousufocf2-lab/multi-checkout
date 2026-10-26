// Leads → Welcome messages: WhatsApp + email that go to new leads and signups, and a one-time send to older leads.
import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Form, Link, useActionData, useLoaderData } from "@remix-run/react";
import { useState } from "react";
import { Icon } from "~/components/Icons";
import { Notice, PageHeader, Section, SubmitButton, TextField, Toggle } from "~/components/ui";
import { requireAdmin } from "~/lib/auth.server";
import { MSG_LABEL, STATUS_LABEL, WA_TEMPLATE_TEXT, WELCOME_DEFAULTS } from "~/lib/welcome";
import {
  emailReady, existingNotSent, getWelcome, queueExisting, recentMessages, renderWelcome, retryFailed, saveWelcome, sendDue, sendTestEmails, startWelcomeWatcher, welcomeStats, whatsappReady,
} from "~/lib/welcome.server";

export const meta: MetaFunction = () => [{ title: "Welcome messages · Growpefy" }];

export async function loader({ request }: LoaderFunctionArgs) {
  await requireAdmin(request);
  startWelcomeWatcher();
  const [s, stats, recent, pending, wa] = await Promise.all([getWelcome(), welcomeStats(), recentMessages(40), existingNotSent(), whatsappReady()]);
  const [pLead, pSignup] = await Promise.all([renderWelcome("lead", "Rahul Sharma", s), renderWelcome("signup", "Rahul Sharma", s)]);
  return json({
    s, stats, wa, email: emailReady(),
    preview: { lead: { subject: pLead.subject, html: pLead.html }, signup: { subject: pSignup.subject, html: pSignup.html } },
    pending: { whatsapp: pending.whatsapp, email: pending.email, leads: pending.leads, signups: pending.signups },
    recent: recent.map((r) => ({ id: r.id, msg: r.msg, channel: r.channel, target: r.target, name: r.name, kind: r.kind, refId: r.refId, status: r.status, error: r.error, attempts: r.attempts, at: (r.sentAt ?? r.createdAt).toISOString() })),
  });
}

export async function action({ request }: ActionFunctionArgs) {
  await requireAdmin(request);
  const fd = await request.formData();
  const intent = String(fd.get("intent") ?? "");
  const t = (k: string, max = 4000) => String(fd.get(k) ?? "").trim().slice(0, max);
  if (intent === "save") {
    const tpl = (k: string) => t(k, 120).toLowerCase().replace(/[^a-z0-9_]/g, "");
    await saveWelcome({
      auto: fd.get("auto") === "on", whatsapp: fd.get("whatsapp") === "on", email: fd.get("email") === "on",
      waLeadTemplate: tpl("waLeadTemplate"), waSignupTemplate: tpl("waSignupTemplate"), waLang: t("waLang", 10) || "en",
      leadSubject: t("leadSubject", 200), leadBody: t("leadBody"), signupSubject: t("signupSubject", 200), signupBody: t("signupBody"),
      fromName: t("fromName", 60).replace(/[<>"]/g, ""), fromEmail: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t("fromEmail")) ? t("fromEmail", 120).toLowerCase() : undefined,
      replyTo: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t("replyTo")) ? t("replyTo", 120).toLowerCase() : undefined,
      whatsappNumber: t("whatsappNumber", 20).replace(/\D/g, ""),
    });
    return json({ ok: "Saved" });
  }
  if (intent === "test") {
    const to = t("testTo", 120).toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) return json({ ok: null, error: "Enter an email address to send the test to" });
    return json({ ok: `${await sendTestEmails(to)} to ${to}. Check the inbox (and the Promotions / Spam tab).` });
  }
  if (intent === "existing") {
    const n = await queueExisting();
    void sendDue();
    return json({ ok: n ? `${n} welcome message${n === 1 ? "" : "s"} queued for existing leads. They go out over the next few minutes.` : "Everyone already has a welcome message." });
  }
  if (intent === "retry") {
    const n = await retryFailed();
    void sendDue();
    return json({ ok: n ? `${n} message${n === 1 ? "" : "s"} will be tried again now.` : "Nothing to retry." });
  }
  return json({ ok: null });
}

const when = (iso: string) => new Date(iso).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

export default function Welcome() {
  const d = useLoaderData<typeof loader>();
  const r = useActionData<typeof action>() as { ok: string | null; error?: string } | undefined;
  const s = d.s;
  const totalPending = d.pending.whatsapp + d.pending.email;

  return (
    <div className="mx-auto max-w-5xl">
      <Link to="/dashboard/leads" className="text-sm text-ink-soft hover:text-ink">← Leads</Link>
      <PageHeader title="Welcome messages" description="A WhatsApp message and an email to every new lead and every new signup." />

      <div className="space-y-5">
        {r?.ok && <Notice tone="success">{r.ok}</Notice>}
        {r && "error" in r && typeof r.error === "string" && <Notice tone="error">{r.error}</Notice>}

        <div className="grid gap-3 sm:grid-cols-4">
          <Stat label="Sent" value={d.stats.sent} note={`${d.stats.whatsappSent} WhatsApp · ${d.stats.emailSent} email`} />
          <Stat label="Waiting" value={d.stats.waiting} note="Queued or will retry" />
          <Stat label="Failed" value={d.stats.failed} note="Wrong number or gave up" />
          <Stat label="Not sent yet" value={totalPending} note={`${d.pending.leads} leads · ${d.pending.signups} signups`} />
        </div>

        {!d.wa && <Notice tone="warning">WhatsApp isn't set up yet in Wallets → Messaging. Messages stay in the queue until it is.</Notice>}
        {!d.email && <Notice tone="warning">Email isn't set up (RESEND_API_KEY on Railway). Emails stay in the queue until it is.</Notice>}

        <section className="panel p-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0 flex-1">
              <h2 className="text-sm font-semibold">Leads that came in before</h2>
              <p className="mt-1 text-sm text-ink-soft">
                {totalPending
                  ? <>{d.pending.leads} lead{d.pending.leads === 1 ? "" : "s"} and {d.pending.signups} signup{d.pending.signups === 1 ? "" : "s"} haven't had a welcome: <b className="text-ink">{d.pending.whatsapp} WhatsApp</b> and <b className="text-ink">{d.pending.email} email</b>. Each person gets each message once.</>
                  : "Everyone has already been sent a welcome."}
              </p>
              <p className="mt-1 text-xs text-ink-faint">Create and get both WhatsApp templates approved first (below), or the WhatsApp messages will wait in the queue.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              {totalPending > 0 && (
                <Form method="post" onSubmit={(e) => { if (!confirm(`Send ${totalPending} welcome messages to existing leads and signups now?`)) e.preventDefault(); }}>
                  <SubmitButton intent="existing" busyText="Queueing"><Icon name="send" className="h-4 w-4" />Send to existing leads</SubmitButton>
                </Form>
              )}
              {(d.stats.failed > 0 || d.stats.waiting > 0) && (
                <Form method="post"><SubmitButton intent="retry" className="btn-secondary" busyText="Retrying"><Icon name="refresh" className="h-4 w-4" />Retry now</SubmitButton></Form>
              )}
            </div>
          </div>
        </section>

        <Form method="post" className="space-y-5">
          <Section title="Sending">
            <div className="space-y-4">
              <Toggle name="auto" label="Send to new leads and signups automatically" description="Meta form leads, website callback requests and new accounts get a welcome within a few minutes." defaultChecked={s.auto} />
              <Toggle name="whatsapp" label="WhatsApp" description="From Growpefy's WhatsApp number, using the templates below." defaultChecked={s.whatsapp} />
              <Toggle name="email" label="Email" description="Only to leads who gave an email address." defaultChecked={s.email} />
            </div>
          </Section>

          <Section title="WhatsApp templates" description="Create these two templates in WhatsApp Manager → Message templates (category Marketing, language English). Use the exact names, and {{1}} for the person's name.">
            <div className="grid gap-4 lg:grid-cols-2">
              <TemplateBox title="For leads" name="waLeadTemplate" value={s.waLeadTemplate} text={WA_TEMPLATE_TEXT.lead} />
              <TemplateBox title="For signups" name="waSignupTemplate" value={s.waSignupTemplate} text={WA_TEMPLATE_TEXT.signup} />
            </div>
            <div className="mt-4 max-w-[180px]"><TextField label="Template language code" name="waLang" defaultValue={s.waLang} hint="en for English" /></div>
          </Section>

          <Section title="Who the emails come from" description="Any address @growpefy.com works for sending (the domain is verified in Resend). Replies go to the reply-to address, so make sure it lands in your Gmail (Cloudflare Email Routing).">
            <div className="grid gap-4 sm:grid-cols-2">
              <TextField label="Sender name" name="fromName" defaultValue={s.fromName} hint="e.g. Growpefy, or Yusuf from Growpefy. Also used to sign the email." />
              <TextField label="Sender email" name="fromEmail" type="email" defaultValue={s.fromEmail} hint="e.g. hello@growpefy.com" />
              <TextField label="Replies go to" name="replyTo" type="email" defaultValue={s.replyTo} hint="e.g. hello@growpefy.com or yusuf@growpefy.com" />
              <TextField label="WhatsApp number for the button" name="whatsappNumber" defaultValue={s.whatsappNumber} placeholder="Uses the phone in invoice details if empty" hint="10 digits, or with 91" />
            </div>
          </Section>

          <Section title="Emails" description="Write {{name}} where the person's first name should go. The design (logo, checkout photo, features, buttons) is added around your message automatically.">
            <div className="grid gap-5 lg:grid-cols-2">
              <EmailBox title="For leads" sKey="leadSubject" bKey="leadBody" subject={s.leadSubject} body={s.leadBody} defSubject={WELCOME_DEFAULTS.leadSubject} defBody={WELCOME_DEFAULTS.leadBody} />
              <EmailBox title="For signups" sKey="signupSubject" bKey="signupBody" subject={s.signupSubject} body={s.signupBody} defSubject={WELCOME_DEFAULTS.signupSubject} defBody={WELCOME_DEFAULTS.signupBody} />
            </div>
          </Section>
          <SubmitButton intent="save" busyText="Saving">Save</SubmitButton>
        </Form>

        <EmailPreview d={d} />

        <section className="panel overflow-hidden">
          <h2 className="border-b border-rule px-5 py-3 text-sm font-semibold">Recent messages</h2>
          {d.recent.length === 0 ? <p className="px-5 py-8 text-center text-sm text-ink-faint">Nothing sent yet.</p> : (
            <ul className="divide-y divide-rule">
              {d.recent.map((m) => {
                const st = STATUS_LABEL[m.status] ?? STATUS_LABEL.queued;
                return (
                  <li key={m.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-5 py-2.5 text-sm">
                    <Icon name={m.channel === "whatsapp" ? "chat" : "mail"} className="h-4 w-4 text-ink-soft" />
                    <Link to={`/dashboard/leads/${m.kind}-${m.refId}`} className="font-medium hover:underline">{m.name || m.target}</Link>
                    <span className="num text-xs text-ink-soft">{m.channel === "whatsapp" ? `+91 ${m.target}` : m.target}</span>
                    <span className="text-xs text-ink-faint">{MSG_LABEL[m.msg as "lead" | "signup"]}</span>
                    <span className={`ml-auto rounded-full px-2 py-0.5 text-[11px] font-medium ${st.tone}`}>{st.label}{m.attempts > 1 ? ` · ${m.attempts} tries` : ""}</span>
                    <span className="w-24 text-right text-[11px] text-ink-faint">{when(m.at)}</span>
                    {m.error && m.status !== "sent" && <p className="w-full pl-7 text-xs text-bad">{m.error}</p>}
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}

function Stat({ label, value, note }: { label: string; value: number; note: string }) {
  return <div className="panel p-4"><p className="text-xs font-medium text-ink-soft">{label}</p><p className="num mt-1 text-2xl font-semibold">{value}</p><p className="truncate text-[11px] text-ink-faint">{note}</p></div>;
}

function TemplateBox({ title, name, value, text }: { title: string; name: string; value: string; text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="rounded-xl border border-rule p-4">
      <p className="text-sm font-semibold">{title}</p>
      <div className="mt-2"><TextField label="Template name" name={name} defaultValue={value} /></div>
      <div className="mt-1 flex items-center justify-between">
        <span className="label mb-0">Template text to paste</span>
        <button type="button" className="text-xs font-medium text-pine hover:underline" onClick={() => { navigator.clipboard?.writeText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }).catch(() => {}); }}>{copied ? "Copied" : "Copy"}</button>
      </div>
      <pre className="mt-1 whitespace-pre-wrap rounded-lg bg-[#e7f5ee] p-3 font-sans text-[13px] leading-relaxed text-ink">{text}</pre>
    </div>
  );
}

function EmailBox({ title, sKey, bKey, subject, body, defSubject, defBody }: { title: string; sKey: string; bKey: string; subject: string; body: string; defSubject: string; defBody: string }) {
  const [k, setK] = useState(0);
  const [vals, setVals] = useState({ subject, body });
  return (
    <div className="rounded-xl border border-rule p-4" key={k}>
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold">{title}</p>
        <button type="button" className="text-xs font-medium text-pine hover:underline" onClick={() => { setVals({ subject: defSubject, body: defBody }); setK(k + 1); }}>Use default text</button>
      </div>
      <div className="mt-2"><TextField label="Subject" name={sKey} defaultValue={vals.subject} /></div>
      <label className="block"><span className="label">Message</span>
        <textarea name={bKey} defaultValue={vals.body} rows={12} className="input text-sm leading-relaxed" />
      </label>
    </div>
  );
}

function EmailPreview({ d }: { d: ReturnType<typeof useLoaderData<typeof loader>> }) {
  const [tab, setTab] = useState<"lead" | "signup">("lead");
  const [wide, setWide] = useState(true);
  const p = d.preview[tab];
  return (
    <section className="panel overflow-hidden">
      <div className="flex flex-wrap items-center gap-3 border-b border-rule px-5 py-3">
        <h2 className="mr-auto text-sm font-semibold">Email preview</h2>
        <div className="flex rounded-lg bg-paper-sunk p-0.5 text-xs font-medium">
          {(["lead", "signup"] as const).map((k) => <button key={k} type="button" onClick={() => setTab(k)} className={`rounded-md px-3 py-1.5 ${tab === k ? "bg-white text-ink shadow-sm" : "text-ink-soft"}`}>{k === "lead" ? "For leads" : "For signups"}</button>)}
        </div>
        <div className="flex rounded-lg bg-paper-sunk p-0.5 text-xs font-medium">
          {([[true, "Computer"], [false, "Phone"]] as const).map(([v, l]) => <button key={l} type="button" onClick={() => setWide(v)} className={`rounded-md px-3 py-1.5 ${wide === v ? "bg-white text-ink shadow-sm" : "text-ink-soft"}`}>{l}</button>)}
        </div>
      </div>
      <div className="border-b border-rule bg-paper px-5 py-2.5 text-sm"><span className="text-ink-soft">Subject:</span> <b>{p.subject}</b> <span className="text-xs text-ink-faint">· from {d.s.fromName} &lt;{d.s.fromEmail}&gt;</span></div>
      <div className="flex justify-center bg-[#e9ecea] p-4">
        <iframe title="Email preview" srcDoc={p.html} className="h-[900px] rounded-lg border border-rule bg-white transition-all" style={{ width: wide ? 680 : 390, maxWidth: "100%" }} />
      </div>
      <Form method="post" className="flex flex-wrap items-end gap-2 border-t border-rule px-5 py-4">
        <div className="min-w-0 flex-1"><TextField label="Send both emails to yourself as a test" name="testTo" type="email" placeholder="you@gmail.com" /></div>
        <SubmitButton intent="test" className="btn-secondary mb-[22px]" busyText="Sending"><Icon name="send" className="h-4 w-4" />Send test</SubmitButton>
      </Form>
    </section>
  );
}
