import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Form, Link, useActionData, useLoaderData, useNavigation, useSearchParams } from "@remix-run/react";
import { useEffect, useRef, useState } from "react";
import { Icon, type IconName } from "~/components/Icons";
import { OtpStep } from "~/components/OtpAuth";
import { Spinner } from "~/components/ui";
import { SiteLayout, crumbLd, rv, siteMeta } from "~/components/site/SiteLayout";
import { fireLead } from "~/components/site/AdsTag";
import { requireAppHost } from "~/lib/host.server";
import { clientIp } from "~/lib/orders.server";
import { ownerWidget, sendOwnerOtp, verifyOwnerOtp } from "~/lib/owner-otp.server";
import { siteData } from "~/lib/site.server";
import { CALL_TIMES, SUPPORT_EMAIL, SUPPORT_HOURS, WEBSITE_REASONS } from "~/lib/support";
import { checkCallback, createCallback } from "~/lib/support.server";
import { getViewer } from "~/lib/auth.server";
import { startWelcomeWatcher, welcomeNow } from "~/lib/welcome.server";

export const meta: MetaFunction = () => siteMeta("Contact us · Request a callback · Growpefy", "Request a callback from the Growpefy team about sales, onboarding, your account, payments, RTO Suite or your wallet. Or write to support@growpefy.com.", "/contact", { ld: [crumbLd("Contact", "/contact")] });
export const loader = async ({ request }: LoaderFunctionArgs) => json(await siteData(request));

const FIELDS = ["name", "phone", "email", "reason", "time", "message"] as const;
type Fields = Record<(typeof FIELDS)[number], string>;
type Result = {
  ok: boolean; stage: "form" | "otp" | "done";
  message?: string; id?: number; errors?: Record<string, string>;
  fields?: Fields; resendIn?: number; widget?: Awaited<ReturnType<typeof ownerWidget>>; phone?: string;
};

/** Step 1 checks the form and sends an OTP to the mobile number. Step 2 checks the OTP, then saves the request. */
export async function action({ request }: ActionFunctionArgs) {
  requireAppHost(request);
  const fd = await request.formData();
  const intent = String(fd.get("intent") ?? "send");
  const fields = Object.fromEntries(FIELDS.map((k) => [k, String(fd.get(k) ?? "").slice(0, k === "message" ? 1000 : 120)])) as Fields;
  const check = await checkCallback(request, fd, "website");
  if (!check.ok) return json<Result>({ ok: false, stage: "form", errors: check.errors, fields }, { status: 400 });
  if (check.bot) return json<Result>({ ok: true, stage: "done", message: "Thanks! We'll call you back soon." });
  const c = { channel: "phone" as const, target: check.phone };
  const widget = await ownerWidget(c);

  if (intent === "send") {
    const r = await sendOwnerOtp(c, "callback", clientIp(request));
    if (!r.ok && !r.resendIn) return json<Result>({ ok: false, stage: "form", errors: { phone: r.error }, fields }, { status: 400 });
    return json<Result>({ ok: true, stage: "otp", fields: { ...fields, phone: check.phone }, resendIn: r.resendIn, widget, phone: check.phone, errors: r.ok ? {} : { code: r.error } });
  }
  const v = await verifyOwnerOtp(c, "callback", String(fd.get("code") ?? ""), String(fd.get("token") ?? "") || undefined);
  if (!v.ok) return json<Result>({ ok: false, stage: "otp", fields, widget, phone: check.phone, errors: { code: v.error } }, { status: 400 });
  const r = await createCallback(request, fd, { source: "website", viewer: await getViewer(request), verified: true });
  if (!r.ok) return json<Result>({ ok: false, stage: "form", errors: r.errors, fields }, { status: 400 });
  startWelcomeWatcher();
  welcomeNow(); // welcome WhatsApp + email, if switched on
  return json<Result>({ ok: true, stage: "done", message: r.message, id: r.id });
}

export default function Contact() {
  const d = useLoaderData<typeof loader>();
  const a = useActionData<typeof action>() as Result | undefined;
  const [sp] = useSearchParams();
  const nav = useNavigation();
  const busy = nav.state === "submitting";
  const [stage, setStage] = useState<Result["stage"]>(a?.stage ?? "form");
  useEffect(() => { if (a?.stage) setStage(a.stage); }, [a]);
  const errors = (stage === "form" ? a?.errors ?? {} : {}) as Record<string, string | undefined>;
  const done = stage === "done" && a?.ok ? a : null;
  const f = a?.fields;
  const top = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!done) return;
    top.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    fireLead(`callback_${done.id ?? Date.now()}`); // Google Ads lead
  }, [done]);
  const preset = WEBSITE_REASONS.some((r) => r.id === sp.get("reason")) ? sp.get("reason")! : "";
  const wa = d.company.phone.replace(/\D/g, "");
  return (
    <SiteLayout loggedIn={d.loggedIn} company={d.company}>
      <section className="relative overflow-hidden border-b border-rule">
        <div aria-hidden className="pointer-events-none absolute inset-0 bg-[radial-gradient(50%_70%_at_20%_0%,rgba(11,93,75,.10),transparent_70%),radial-gradient(40%_60%_at_90%_10%,rgba(45,212,150,.10),transparent_70%)]" />
        <div className="relative mx-auto max-w-6xl px-4 pb-12 pt-14 sm:px-6 sm:pt-20">
          <p className="text-xs font-semibold uppercase tracking-[.14em] text-pine">Contact us</p>
          <h1 className="mt-3 max-w-2xl text-4xl font-semibold tracking-tight sm:text-[52px] sm:leading-[1.08]">Talk to a person, not a ticket queue.</h1>
          <p className="mt-4 max-w-xl text-lg text-ink-soft">Leave your number and what it's about. Someone from our team calls you back, usually within one working day.</p>
        </div>
      </section>

      <section className="mx-auto grid max-w-6xl gap-8 px-4 py-14 sm:px-6 lg:grid-cols-[1.35fr_1fr]">
        <div ref={top}>
          {done ? (
            <div className="rounded-3xl border border-emerald-200 bg-gradient-to-b from-emerald-50 to-white p-8 text-center shadow-lift sm:p-12" role="status">
              <span className="pop mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-emerald-500 text-white shadow-[0_12px_30px_-10px_rgba(16,185,129,.7)]"><Icon name="check" className="h-8 w-8" strokeWidth={2.6} /></span>
              <h2 className="mt-6 text-2xl font-semibold tracking-tight">Thanks, we've got it.</h2>
              <p className="mx-auto mt-2 max-w-md text-ink-soft">{done.message}</p>
              <p className="mt-1 text-sm text-ink-faint">We call {SUPPORT_HOURS}.</p>
              <div className="mt-7 flex flex-wrap justify-center gap-3">
                <Link to="/" className="btn-secondary px-5 py-3">Back to home</Link>
                <Link to="/pricing" className="btn-primary px-5 py-3">See pricing<Icon name="arrow" className="nudge h-4 w-4" /></Link>
              </div>
            </div>
          ) : stage === "otp" && f ? (
            <div className="rounded-3xl border border-rule bg-white p-6 shadow-lift sm:p-8">
              <div className="flex items-center gap-3">
                <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-pine text-white shadow-[0_8px_20px_-10px_rgba(11,93,75,.9)]"><Icon name="lock" className="h-5 w-5" /></span>
                <div><h2 className="text-lg font-semibold">Confirm your number</h2><p className="text-sm text-ink-soft">We sent a code to <b className="num text-ink">+91 {f.phone}</b> so we call the right person.</p></div>
              </div>
              <div className="mt-6">
                <OtpStep hidden={f} error={a?.errors?.code} resendIn={a?.resendIn} onChange={() => setStage("form")} submitLabel="Verify and request callback" widget={a?.widget} phone={a?.phone} />
              </div>
            </div>
          ) : (
            <Form method="post" className="rounded-3xl border border-rule bg-white p-6 shadow-lift sm:p-8" noValidate {...rv()}>
              <input type="hidden" name="intent" value="send" />
              <div className="flex items-center gap-3">
                <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-pine text-white shadow-[0_8px_20px_-10px_rgba(11,93,75,.9)]"><Icon name="phone" className="h-5 w-5" /></span>
                <div><h2 className="text-lg font-semibold">Request a callback</h2><p className="text-sm text-ink-soft">Takes 30 seconds. No spam, ever.</p></div>
              </div>
              {errors.form && <p role="alert" className="mt-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900">{errors.form}</p>}
              {/* hidden from people; bots fill it */}
              <div aria-hidden className="absolute -left-[9999px] h-0 w-0 overflow-hidden"><label>Company website<input name="company_site" tabIndex={-1} autoComplete="off" /></label></div>
              <div className="mt-6 grid gap-4 sm:grid-cols-2">
                <Field label="Your name" error={errors.name}>
                  <input name="name" defaultValue={f?.name} className="input py-3" autoComplete="name" required maxLength={80} aria-invalid={Boolean(errors.name) || undefined} />
                </Field>
                <Field label="Mobile number" error={errors.phone}>
                  <span className="relative block">
                    <span className="pointer-events-none absolute inset-y-0 left-3.5 flex items-center gap-2 text-[15px] font-medium text-ink-soft">+91<span className="h-5 w-px bg-rule-strong" /></span>
                    <input name="phone" defaultValue={f?.phone} className="input num py-3 pl-[60px] tracking-wide" inputMode="numeric" autoComplete="tel-national" maxLength={10} required
                      onInput={(e) => { const t = e.currentTarget; t.value = t.value.replace(/\D/g, "").slice(0, 10); }} aria-invalid={Boolean(errors.phone) || undefined} />
                  </span>
                </Field>
                <Field label="Email" optional error={errors.email} className="sm:col-span-2">
                  <input name="email" defaultValue={f?.email} type="email" className="input py-3" autoComplete="email" maxLength={120} aria-invalid={Boolean(errors.email) || undefined} />
                </Field>
                <Field label="How can we help?" error={errors.reason}>
                  <span className="relative block">
                    <select name="reason" className="input appearance-none py-3 pr-10" defaultValue={f?.reason || preset} required aria-invalid={Boolean(errors.reason) || undefined}>
                      <option value="" disabled>Choose a reason</option>
                      {WEBSITE_REASONS.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
                    </select>
                    <Icon name="chevron" className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-faint" />
                  </span>
                </Field>
                <Field label="Best time to call">
                  <span className="relative block">
                    <select name="time" className="input appearance-none py-3 pr-10" defaultValue={f?.time || "anytime"}>
                      {CALL_TIMES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
                    </select>
                    <Icon name="chevron" className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-faint" />
                  </span>
                </Field>
                <Field label="Anything we should know?" optional className="sm:col-span-2">
                  <textarea name="message" defaultValue={f?.message} rows={4} className="input" maxLength={1000} placeholder="Your store website and roughly how many orders you get a month." />
                </Field>
              </div>
              <button type="submit" className="btn-primary mt-6 w-full py-3.5 text-[15px]" disabled={busy}>
                {busy ? <><Spinner />Sending code…</> : <>Request a callback<Icon name="arrow" className="nudge h-4 w-4" /></>}
              </button>
              <p className="mt-3 text-center text-xs text-ink-faint">We'll send a one-time code to confirm your number. By sending this you agree that we may call or WhatsApp you about your request. See our <Link to="/privacy" className="underline underline-offset-2 hover:text-ink">privacy policy</Link>.</p>
            </Form>
          )}
        </div>

        <aside className="space-y-4">
          <Card icon="mail" tone="blue" title="Email" i={1}>
            <a href={`mailto:${SUPPORT_EMAIL}`} className="group inline-flex items-center gap-1.5 text-[17px] font-semibold text-ink hover:text-pine-dark">{SUPPORT_EMAIL}<Icon name="arrow" className="nudge h-4 w-4 text-ink-faint" /></a>
            <p className="mt-1 text-sm text-ink-soft">Support, billing, partnerships. We reply within one working day.</p>
          </Card>
          {wa.length >= 10 && (
            <Card icon="chat" tone="mint" title="WhatsApp" i={2}>
              <a href={`https://wa.me/${wa.length === 10 ? `91${wa}` : wa}`} target="_blank" rel="noreferrer" className="group inline-flex items-center gap-1.5 text-[17px] font-semibold text-ink hover:text-emerald-700">Chat with us<Icon name="arrow" className="nudge h-4 w-4 text-ink-faint" /></a>
              <p className="mt-1 text-sm text-ink-soft">Quick questions during working hours.</p>
            </Card>
          )}
          <Card icon="clock" tone="amber" title="Support hours" i={3}>
            <p className="text-[17px] font-semibold">{SUPPORT_HOURS}</p>
            <p className="mt-1 text-sm text-ink-soft">Requests sent outside these hours are picked up the next working morning.</p>
          </Card>
          <div className="relative overflow-hidden rounded-2xl bg-[#0B1A16] p-6 text-white" {...rv(4)}>
            <div aria-hidden className="pointer-events-none absolute -right-10 -top-10 h-40 w-40 rounded-full bg-pine-tint0/30 blur-2xl" />
            <p className="relative flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-emerald-300"><Icon name="flag" className="h-3.5 w-3.5" />Already a Growpefy store?</p>
            <p className="relative mt-2 text-sm text-slate-300">Raise a complaint or ask for a callback from <span className="font-medium text-white">Help & support</span> in your dashboard. You can follow every reply there.</p>
            <Link to={d.loggedIn ? "/dashboard/support" : "/login?next=%2Fdashboard%2Fsupport"} className="group relative mt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-white">Open Help & support<Icon name="arrow" className="nudge h-4 w-4" /></Link>
          </div>
        </aside>
      </section>
    </SiteLayout>
  );
}

function Field({ label, optional, error, className = "", children }: { label: string; optional?: boolean; error?: string; className?: string; children: React.ReactNode }) {
  return (
    <label className={`block ${className}`}>
      <span className="mb-1.5 block text-[13px] font-medium text-ink-soft">{label}{optional && <span className="font-normal text-ink-faint"> · optional</span>}</span>
      {children}
      {error && <span className="mt-1.5 flex items-center gap-1 text-xs font-medium text-bad"><Icon name="alert" className="h-3.5 w-3.5" />{error}</span>}
    </label>
  );
}

function Card({ icon, tone, title, i, children }: { icon: IconName; tone: "blue" | "mint" | "amber"; title: string; i: number; children: React.ReactNode }) {
  const t = { blue: "bg-pine-tint text-pine", mint: "bg-emerald-50 text-emerald-700", amber: "bg-amber-50 text-amber-700" }[tone];
  return (
    <div className="spot group rounded-2xl border border-rule bg-white p-6" {...rv(i)}>
      <div className="flex items-center gap-3">
        <span className={`flex h-10 w-10 items-center justify-center rounded-xl transition-transform duration-300 group-hover:scale-110 ${t}`}><Icon name={icon} className="h-5 w-5" /></span>
        <p className="text-xs font-semibold uppercase tracking-wider text-ink-faint">{title}</p>
      </div>
      <div className="mt-4">{children}</div>
    </div>
  );
}
