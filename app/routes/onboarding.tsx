import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { Form, Link, useActionData, useFetcher, useLoaderData, useNavigation } from "@remix-run/react";
import { and, eq, inArray, ne } from "drizzle-orm";
import { useEffect, useMemo, useRef, useState } from "react";
import { BrandLockup } from "~/components/Brand";
import { Icon } from "~/components/Icons";
import { codeLength, widgetSend, widgetVerify, type WidgetConfig } from "~/components/msg91-widget";
import { Notice, Spinner } from "~/components/ui";
import { VerifiedBadge } from "~/components/VerifiedBadge";
import { db, kycDocuments, stores, users, wallets } from "~/db.server";
import { requireViewer } from "~/lib/auth.server";
import { requireAppHost } from "~/lib/host.server";
import {
  BUSINESS_TYPES, CATEGORIES, DOC_KINDS, DOC_MAX_BYTES, DOC_TYPES, EMAIL_RE, GSTIN_RE, KYC_LAST, KYC_STEPS, MOBILE_RE, PAN_RE,
  gstVerified, gstinChecksumOk, kycIncomplete, panFromGstin, panHolder, panNameMatches, panTypeWarning, stateFromGstin, validateStep,
  type BusinessType, type DocKind, type KycData, type KycErrors,
} from "~/lib/kyc";
import { clientIp } from "~/lib/orders.server";
import { channelReady, ownerWidget, sendOwnerOtp, verifyOwnerOtp } from "~/lib/owner-otp.server";
import { INDIAN_STATES } from "~/lib/states";
import { getWallet } from "~/lib/wallet.server";

export const meta: MetaFunction = () => [{ title: "Complete your KYC · Growpefy" }, { name: "robots", content: "noindex" }];

async function loadOwner(request: Request) {
  requireAppHost(request);
  const viewer = await requireViewer(request);
  if (viewer.role !== "owner") throw redirect("/dashboard");
  const [u] = await db.select().from(users).where(eq(users.id, viewer.userId)).limit(1);
  return u;
}

/** KYC with the contact used to sign up counted as verified (that login already proved it with an OTP). */
function withSignupVerified(u: typeof users.$inferSelect): KycData {
  const k: KycData = { ...u.kyc };
  k.phone = k.phone || u.phone || "";
  k.email = k.email || u.email || "";
  k.contactName = k.contactName ?? "";
  k.brandName = k.brandName ?? u.name;
  if (u.signupWith === "phone" && u.phone && k.phone === u.phone && !k.phoneVerified) k.phoneVerified = u.phone;
  if (u.signupWith === "email" && u.email && k.email === u.email && !k.emailVerified) k.emailVerified = u.email;
  return k;
}

export async function loader({ request }: LoaderFunctionArgs) {
  const u = await loadOwner(request);
  const done = !kycIncomplete(u);
  const k = withSignupVerified(u);
  const lastDone = Math.min(KYC_LAST, k.v2Step ?? 0);
  const asked = Number(new URL(request.url).searchParams.get("step"));
  const step = done && (!asked || asked > KYC_LAST) ? KYC_LAST + 1 : Math.max(1, Math.min(done ? KYC_LAST : lastDone + 1, asked || lastDone + 1));
  const [docs, owned, phoneReady, emailReady, widget] = await Promise.all([
    db.select({ kind: kycDocuments.kind, filename: kycDocuments.filename, size: kycDocuments.size, createdAt: kycDocuments.createdAt }).from(kycDocuments).where(eq(kycDocuments.userId, u.id)),
    db.select({ id: stores.id }).from(stores).where(eq(stores.ownerId, u.id)).limit(1),
    channelReady("phone"), channelReady("email"), ownerWidget({ channel: "phone" }),
  ]);
  return json({
    step, done, hasStore: owned.length > 0, redo: (u.kyc.v ?? 1) < 2 && u.kycStatus === "approved",
    kyc: k, ready: { phone: phoneReady, email: emailReady }, widget,
    docs: docs.map((d) => ({ ...d, kind: d.kind as DocKind, createdAt: d.createdAt.toISOString() })),
  });
}

const clean = (v: FormDataEntryValue | null, max = 200) => String(v ?? "").trim().replace(/\s+/g, " ").slice(0, max);
const digits10 = (v: FormDataEntryValue | null) => clean(v, 15).replace(/\D/g, "").replace(/^(91|0)(?=\d{10}$)/, "");

/** Checks the first bytes so a renamed file can't pass as a PDF or image. */
function sniff(buf: Buffer): string | null {
  if (buf.subarray(0, 4).toString("latin1") === "%PDF") return "application/pdf";
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (buf.subarray(0, 4).toString("latin1") === "RIFF" && buf.subarray(8, 12).toString("latin1") === "WEBP") return "image/webp";
  return null;
}

type OtpResult = { ok: boolean; error?: string; resendIn?: number; verified?: string; channel?: "phone" | "email" };

export async function action({ request }: ActionFunctionArgs) {
  const u = await loadOwner(request);
  if (Number(request.headers.get("content-length") ?? 0) > 3 * DOC_MAX_BYTES + 100_000) {
    return json({ errors: { docs: "Files are too large. Each file can be up to 5 MB." } as KycErrors }, { status: 413 });
  }
  const fd = await request.formData();
  const intent = String(fd.get("intent") ?? "save");
  const k: KycData = withSignupVerified(u);

  // ----- OTP for mobile / email -----
  if (intent === "otp_send" || intent === "otp_verify") {
    const channel = fd.get("channel") === "email" ? "email" as const : "phone" as const;
    const target = channel === "email" ? clean(fd.get("target"), 160).toLowerCase() : digits10(fd.get("target"));
    if (channel === "phone" ? !MOBILE_RE.test(target) : !EMAIL_RE.test(target)) return json<OtpResult>({ ok: false, channel, error: channel === "phone" ? "Enter a valid 10-digit mobile number" : "Enter a valid email address" });
    const [other] = await db.select({ id: users.id }).from(users).where(and(channel === "phone" ? eq(users.phone, target) : eq(users.email, target), ne(users.id, u.id))).limit(1);
    if (other) return json<OtpResult>({ ok: false, channel, error: `This ${channel === "phone" ? "number" : "email"} is already used by another Growpefy account` });
    if (intent === "otp_send") {
      const r = await sendOwnerOtp({ channel, target }, "verify", clientIp(request));
      return json<OtpResult>({ ok: r.ok, channel, error: r.ok ? undefined : r.error, resendIn: r.resendIn });
    }
    const v = await verifyOwnerOtp({ channel, target }, "verify", String(fd.get("code") ?? ""), String(fd.get("token") ?? "") || undefined);
    if (!v.ok) return json<OtpResult>({ ok: false, channel, error: v.error });
    const next: KycData = { ...k, ...(channel === "phone" ? { phone: target, phoneVerified: target } : { email: target, emailVerified: target }) };
    await db.update(users).set({ kyc: next, ...(channel === "phone" ? { phone: target } : { email: target }) }).where(eq(users.id, u.id));
    return json<OtpResult>({ ok: true, channel, verified: target });
  }

  const step = Number(fd.get("step"));
  if (!(step >= 1 && step <= KYC_LAST)) return json({ errors: { form: "Something went wrong. Reload the page." } as KycErrors }, { status: 400 });
  const ready = { phone: await channelReady("phone"), email: await channelReady("email") };

  if (step === 1) {
    k.contactName = clean(fd.get("contactName"), 120);
    k.phone = digits10(fd.get("phone"));
    k.altPhone = digits10(fd.get("altPhone"));
    k.email = clean(fd.get("email"), 160).toLowerCase();
    k.altEmail = clean(fd.get("altEmail"), 160).toLowerCase();
    k.whatsapp = k.whatsapp || k.phone;
  }
  if (step === 2) {
    k.brandName = clean(fd.get("brandName"), 120);
    k.businessType = String(fd.get("businessType") ?? "") as BusinessType;
    if (!BUSINESS_TYPES.some((b) => b.value === k.businessType)) k.businessType = undefined;
    k.category = clean(fd.get("category"), 60);
    k.website = clean(fd.get("website"), 200).replace(/^https?:\/\//i, "").replace(/\/+$/, "");
  }
  if (step === 3) {
    k.pan = clean(fd.get("pan"), 10).toUpperCase().replace(/[^A-Z0-9]/g, "");
    k.legalName = clean(fd.get("legalName"), 160);
    k.gstin = fd.get("hasGst") === "on" ? clean(fd.get("gstin"), 15).toUpperCase().replace(/[^A-Z0-9]/g, "") : "";
  }
  if (step === 4) {
    k.address = clean(fd.get("address"), 300);
    k.landmark = clean(fd.get("landmark"), 120);
    k.city = clean(fd.get("city"), 80);
    k.state = clean(fd.get("state"), 80);
    k.pincode = clean(fd.get("pincode"), 6).replace(/\D/g, "");
    const lat = Number(fd.get("lat")), lng = Number(fd.get("lng"));
    if (Number.isFinite(lat) && Number.isFinite(lng) && (lat || lng)) k.geo = { lat: Math.round(lat * 1e5) / 1e5, lng: Math.round(lng * 1e5) / 1e5 };
  }

  const errors: KycErrors = validateStep(step, k, ready);
  if (step === 1) {
    for (const [col, val, key] of [[users.phone, k.phone, "phone"], [users.email, k.email, "email"]] as const) {
      if (errors[key] || !val) continue;
      const [other] = await db.select({ id: users.id }).from(users).where(and(eq(col, val), ne(users.id, u.id))).limit(1);
      if (other) errors[key] = `This ${key === "phone" ? "number" : "email"} is already used by another Growpefy account`;
    }
  }

  if (step === 5) {
    const have = new Set((await db.select({ kind: kycDocuments.kind }).from(kycDocuments).where(eq(kycDocuments.userId, u.id))).map((d) => d.kind));
    for (const kind of Object.keys(DOC_KINDS) as DocKind[]) {
      const f = fd.get(`${kind}Doc`);
      if (!(f instanceof File) || f.size === 0) continue;
      const key = kind === "pan" ? "panDoc" : kind === "gst" ? "gstDoc" : "docs";
      if (f.size > DOC_MAX_BYTES) { errors[key] = "This file is over 5 MB. Upload a smaller photo or PDF."; continue; }
      const buf = Buffer.from(await f.arrayBuffer());
      const mime = sniff(buf);
      if (!mime || !DOC_TYPES.includes(mime)) { errors[key] = "Upload a PDF, JPG, PNG or WEBP file."; continue; }
      const row = { userId: u.id, kind, filename: f.name.slice(0, 120) || `${kind}.${mime.split("/")[1]}`, mime, size: buf.length, data: buf, createdAt: new Date() };
      await db.insert(kycDocuments).values(row).onConflictDoUpdate({ target: [kycDocuments.userId, kycDocuments.kind], set: row });
      have.add(kind);
    }
    if (!have.has("pan") && !errors.panDoc) errors.panDoc = "Upload a photo or PDF of your PAN card";
    if (k.gstin && !have.has("gst") && !errors.gstDoc) errors.gstDoc = "Upload your GST registration certificate";
  }

  if (step === KYC_LAST) {
    if (fd.get("declare") !== "on") errors.declare = "Please confirm the details are correct";
    // Every earlier step must still pass
    for (let s = 1; s <= 4; s++) {
      const e = validateStep(s, k, ready);
      if (Object.keys(e).length) { errors.form = `Some details in “${KYC_STEPS[s - 1].title}” need fixing.`; break; }
    }
    const have = new Set((await db.select({ kind: kycDocuments.kind }).from(kycDocuments).where(eq(kycDocuments.userId, u.id))).map((d) => d.kind));
    if (!errors.form && (!have.has("pan") || (k.gstin && !have.has("gst")))) errors.form = "Upload the required documents first.";
  }

  if (Object.keys(errors).length) return json({ errors, values: k }, { status: 400 });

  k.v2Step = Math.max(k.v2Step ?? 0, step);
  const patch: Partial<typeof users.$inferInsert> = { kyc: k };
  if (step === 1) { patch.phone = k.phone || null; patch.email = k.email || null; }
  if (step === 2 && k.brandName) patch.name = k.brandName;
  if (step === KYC_LAST) {
    k.v = 2;
    k.submittedAt = new Date().toISOString();
    // All checks passed (OTP, PAN/GST format and checksum, documents): approve right away
    patch.kycStatus = "approved";
    patch.kycSubmittedAt = new Date();
  }
  await db.update(users).set(patch).where(eq(users.id, u.id));

  if (step === KYC_LAST) {
    // Invoice details for every wallet of this owner
    const owned = await db.select({ id: stores.id }).from(stores).where(eq(stores.ownerId, u.id));
    await Promise.all(owned.map((s) => getWallet(s.id)));
    if (owned.length) {
      const ws = await db.select().from(wallets).where(inArray(wallets.storeId, owned.map((s) => s.id)));
      const billing = { name: k.legalName, gstin: k.gstin || "", address: [k.address, k.landmark, k.city, k.pincode].filter(Boolean).join(", "), state: k.state, email: k.email, phone: k.phone };
      for (const w of ws) if (!w.billing?.name || !w.billing?.gstin) await db.update(wallets).set({ billing, updatedAt: new Date() }).where(eq(wallets.id, w.id));
    }
    return redirect(`/onboarding?step=${KYC_LAST + 1}`);
  }
  return redirect(`/onboarding?step=${step + 1}`);
}

// ================= UI =================

type L = ReturnType<typeof useLoaderData<typeof loader>>;

export default function Onboarding() {
  const d = useLoaderData<typeof loader>();
  const a = useActionData<typeof action>();
  const nav = useNavigation();
  const errors = (a && "errors" in a ? a.errors : {}) as KycErrors;
  const k: KycData = { ...(d.kyc as KycData), ...((a && "values" in a ? a.values : {}) as KycData) };
  const busy = nav.state !== "idle" && nav.formData?.get("intent") !== "otp_send" && nav.formData?.get("intent") !== "otp_verify";
  const finished = d.step > KYC_LAST;
  const pct = finished ? 100 : Math.round(((d.step - 1) / KYC_LAST) * 100);
  const current = KYC_STEPS[Math.min(d.step, KYC_LAST) - 1];

  return (
    <main className="min-h-screen bg-paper">
      <header className="sticky top-0 z-20 border-b border-rule bg-surface/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <BrandLockup className="h-7" />
          <div className="hidden items-center gap-2 text-xs text-ink-soft sm:flex"><Icon name="shield" className="h-4 w-4 text-pine" />Secure KYC · 256-bit encrypted</div>
          <Form method="post" action="/logout"><button className="text-sm text-ink-soft hover:text-ink">Log out</button></Form>
        </div>
        <div className="h-1 bg-paper-sunk"><div className="h-full bg-brand transition-all duration-500" style={{ width: `${pct}%` }} /></div>
      </header>

      <div className="mx-auto grid max-w-6xl gap-6 px-4 pb-20 pt-6 sm:px-6 lg:grid-cols-[280px_minmax(0,1fr)] lg:gap-10 lg:pt-10">
        <aside>
          {!finished && (
            <div className="mb-4 lg:hidden">
              <p className="text-xs font-semibold uppercase tracking-wider text-pine">Step {d.step} of {KYC_LAST}</p>
              <p className="text-lg font-semibold">{current.title}</p>
            </div>
          )}
          <ol className="hidden space-y-1 lg:block">
            {KYC_STEPS.map((s) => {
              const state = d.step > s.n ? "done" : d.step === s.n ? "now" : "next";
              const inner = (
                <span className={`flex items-center gap-3 rounded-xl px-3 py-2.5 transition ${state === "now" ? "bg-surface shadow-sm ring-1 ring-rule" : state === "done" ? "hover:bg-surface/60" : ""}`}>
                  <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-semibold transition ${state === "done" ? "bg-brand text-white" : state === "now" ? "bg-ink text-white" : "border border-rule-strong text-ink-faint"}`}>
                    {state === "done" ? <Icon name="check" className="h-4 w-4" strokeWidth={3} /> : s.n}
                  </span>
                  <span className="min-w-0">
                    <span className={`block text-sm font-medium ${state === "next" ? "text-ink-faint" : "text-ink"}`}>{s.title}</span>
                    <span className="block text-xs text-ink-faint">{s.note}</span>
                  </span>
                </span>
              );
              return <li key={s.n}>{state !== "next" && !finished ? <Link to={`?step=${s.n}`} preventScrollReset>{inner}</Link> : inner}</li>;
            })}
          </ol>
          <div className="mt-6 hidden space-y-3 lg:block">
            <Badges k={k} />
            <div className="rounded-xl border border-rule bg-surface p-4 text-xs leading-relaxed text-ink-soft">
              <p className="mb-1 flex items-center gap-2 text-sm font-medium text-ink"><Icon name="shield" className="h-4 w-4 text-pine" />Why we ask</p>
              KYC keeps Growpefy safe for every brand and lets us issue GST invoices for your wallet recharges. Your documents are stored securely and never shared.
            </div>
          </div>
        </aside>

        <section className="panel overflow-hidden">
          {d.redo && d.step === 1 && !finished && (
            <div className="border-b border-amber-200 bg-amber-50 px-5 py-3 text-sm text-amber-900 sm:px-8">
              <b>One-time update:</b> we've upgraded KYC for all Growpefy stores. Please verify your mobile and email and add your documents to keep using your dashboard. Takes about 3 minutes.
            </div>
          )}
          <div className="p-5 sm:p-8">
            {errors.form && <div className="mb-5"><Notice tone="error">{errors.form}</Notice></div>}
            {d.step === 1 && <StepPersonal k={k} errors={errors} busy={busy} ready={d.ready} widget={d.widget} />}
            {d.step === 2 && <StepBusiness k={k} errors={errors} busy={busy} />}
            {d.step === 3 && <StepTax k={k} errors={errors} busy={busy} />}
            {d.step === 4 && <StepAddress k={k} errors={errors} busy={busy} />}
            {d.step === 5 && <StepDocs k={k} errors={errors} busy={busy} docs={d.docs} />}
            {d.step === 6 && <StepReview k={k} errors={errors} busy={busy} docs={d.docs} ready={d.ready} />}
            {finished && <Done k={k} hasStore={d.hasStore} />}
          </div>
        </section>
      </div>
    </main>
  );
}

// ---------- shared bits ----------

function StepHead({ n, title, text }: { n: number; title: string; text: string }) {
  return (
    <div className="mb-7">
      <p className="hidden text-xs font-semibold uppercase tracking-wider text-pine lg:block">Step {n} of {KYC_LAST}</p>
      <h1 className="mt-1 text-2xl font-semibold tracking-tight">{title}</h1>
      <p className="mt-1 text-sm text-ink-soft">{text}</p>
    </div>
  );
}

const Err = ({ m }: { m?: string }) => (m ? <span className="error-text" role="alert">{m}</span> : null);
const Opt = () => <span className="font-normal text-ink-faint"> (optional)</span>;
const Req = () => <span className="text-bad" aria-hidden> *</span>;

function Footer({ busy, back, label }: { busy: boolean; back?: number; label: string }) {
  return (
    <div className="mt-9 flex items-center justify-between gap-3 border-t border-rule pt-5">
      {back ? <Link to={`?step=${back}`} className="btn-secondary" preventScrollReset>← Back</Link> : <span />}
      <button type="submit" className="btn-primary min-w-[170px] py-3" disabled={busy}>{busy ? <><Spinner /> Saving</> : label}</button>
    </div>
  );
}

function Badges({ k }: { k: KycData }) {
  const items = [
    { on: Boolean(k.phone && k.phoneVerified === k.phone), label: "Mobile verified" },
    { on: Boolean(k.email && k.emailVerified === k.email), label: "Email verified" },
    { on: gstVerified(k), label: "Verified business" },
  ];
  return (
    <div className="rounded-xl border border-rule bg-surface p-4">
      <p className="mb-2 text-sm font-medium">Your badges</p>
      <ul className="space-y-1.5 text-xs">
        {items.map((i) => (
          <li key={i.label} className="flex items-center justify-between gap-2">
            <span className={i.on ? "text-ink" : "text-ink-faint"}>{i.label}</span>
            {i.on ? <VerifiedBadge label="Done" /> : <span className="text-ink-faint">—</span>}
          </li>
        ))}
      </ul>
      <p className="mt-2 text-[11px] text-ink-faint">“Verified business” appears when you add a valid GSTIN.</p>
    </div>
  );
}

// ---------- step 1: personal ----------

function StepPersonal({ k, errors, busy, ready, widget }: { k: KycData; errors: KycErrors; busy: boolean; ready: L["ready"]; widget: WidgetConfig | null }) {
  const [phone, setPhone] = useState(k.phone ?? "");
  const [email, setEmail] = useState(k.email ?? "");
  const [verified, setVerified] = useState({ phone: k.phoneVerified ?? "", email: k.emailVerified ?? "" });
  return (
    <Form method="post" noValidate>
      <input type="hidden" name="step" value="1" />
      <StepHead n={1} title="Personal details" text="Verify your mobile and email with a one-time code. We use them for login, alerts and invoices." />
      <div className="grid gap-5">
        <label className="block">
          <span className="label">Full name<Req /></span>
          <input name="contactName" className="input" autoComplete="name" defaultValue={k.contactName} placeholder="Your full name" aria-invalid={Boolean(errors.contactName) || undefined} />
          <Err m={errors.contactName} />
        </label>

        <div className="grid gap-5 sm:grid-cols-2">
          <VerifyField channel="phone" label="Mobile number" value={phone} setValue={setPhone} verified={verified.phone === phone && Boolean(phone)}
            onVerified={(v) => setVerified((x) => ({ ...x, phone: v }))} error={errors.phone} ready={ready.phone} widget={widget} />
          <label className="block">
            <span className="label">Alternate mobile<Opt /></span>
            <div className="flex">
              <span className="flex items-center rounded-l-lg border border-r-0 border-rule-strong bg-paper px-3 text-[15px] text-ink-soft">+91</span>
              <input name="altPhone" inputMode="numeric" maxLength={10} className="input rounded-l-none" defaultValue={k.altPhone} placeholder="10-digit number" aria-invalid={Boolean(errors.altPhone) || undefined} />
            </div>
            <Err m={errors.altPhone} />
          </label>
        </div>

        <div className="grid gap-5 sm:grid-cols-2">
          <VerifyField channel="email" label="Email" value={email} setValue={setEmail} verified={verified.email === email && Boolean(email)}
            onVerified={(v) => setVerified((x) => ({ ...x, email: v }))} error={errors.email} ready={ready.email} widget={null} />
          <label className="block">
            <span className="label">Alternate email<Opt /></span>
            <input name="altEmail" type="email" className="input" defaultValue={k.altEmail} placeholder="accounts@yourbrand.com" aria-invalid={Boolean(errors.altEmail) || undefined} />
            <Err m={errors.altEmail} />
          </label>
        </div>
      </div>
      <Footer busy={busy} label="Continue →" />
    </Form>
  );
}

/** Field with a Verify button that sends an OTP and checks it inline. */
function VerifyField({ channel, label, value, setValue, verified, onVerified, error, ready, widget }: {
  channel: "phone" | "email"; label: string; value: string; setValue: (v: string) => void; verified: boolean;
  onVerified: (v: string) => void; error?: string; ready: boolean; widget: WidgetConfig | null;
}) {
  const send = useFetcher<OtpResult>();
  const check = useFetcher<OtpResult>();
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState("");
  const [wait, setWait] = useState(0);
  const [w, setW] = useState<{ reqId: string | null; error: string | null; busy: boolean }>({ reqId: null, error: null, busy: false });
  const codeRef = useRef<HTMLInputElement>(null);
  const useWidget = channel === "phone" && Boolean(widget);
  const len = useWidget ? codeLength(widget) : 6;
  const valid = channel === "phone" ? MOBILE_RE.test(value) : EMAIL_RE.test(value);

  useEffect(() => { if (wait <= 0) return; const t = setTimeout(() => setWait((x) => x - 1), 1000); return () => clearTimeout(t); }, [wait]);
  useEffect(() => {
    const r = send.data;
    if (!r) return;
    if (r.ok) {
      setOpen(true); setWait(r.resendIn ?? 30); setTimeout(() => codeRef.current?.focus(), 50);
      if (useWidget) {
        setW({ reqId: null, error: null, busy: true });
        widgetSend(widget!, value).then((reqId) => setW({ reqId, error: null, busy: false })).catch((e: Error) => setW({ reqId: null, error: e.message, busy: false }));
      }
    } else if (r.resendIn) { setOpen(true); setWait(r.resendIn); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [send.data]);
  useEffect(() => { if (check.data?.ok && check.data.verified) { onVerified(check.data.verified); setOpen(false); setCode(""); } }, [check.data]); // eslint-disable-line react-hooks/exhaustive-deps
  // Changing the value closes the code box
  useEffect(() => { setOpen(false); setCode(""); }, [value]);

  const start = () => send.submit({ intent: "otp_send", channel, target: value }, { method: "post" });
  const submitCode = (c = code) => {
    if (c.length !== len) return;
    if (!useWidget) { check.submit({ intent: "otp_verify", channel, target: value, code: c }, { method: "post" }); return; }
    if (!w.reqId) return;
    setW((x) => ({ ...x, busy: true, error: null }));
    widgetVerify(widget!, c, w.reqId, value)
      .then((token) => { setW((x) => ({ ...x, busy: false })); check.submit({ intent: "otp_verify", channel, target: value, token }, { method: "post" }); })
      .catch((e: Error) => setW((x) => ({ ...x, busy: false, error: e.message })));
  };
  const otpError = w.error ?? (send.data && !send.data.ok && !send.data.resendIn ? send.data.error : null) ?? (check.data && !check.data.ok ? check.data.error : null);
  const sending = send.state !== "idle";
  const checking = check.state !== "idle" || w.busy;

  return (
    <div>
      <span className="label flex items-center gap-2">{label}<Req />{verified && <VerifiedBadge />}</span>
      <div className="flex gap-2">
        <div className="flex min-w-0 flex-1">
          {channel === "phone" && <span className="flex items-center rounded-l-lg border border-r-0 border-rule-strong bg-paper px-3 text-[15px] text-ink-soft">+91</span>}
          <input name={channel} type={channel === "email" ? "email" : "text"} inputMode={channel === "phone" ? "numeric" : "email"} maxLength={channel === "phone" ? 10 : 160}
            autoComplete={channel === "phone" ? "tel-national" : "email"} value={value}
            onChange={(e) => setValue(channel === "phone" ? e.target.value.replace(/\D/g, "").slice(0, 10) : e.target.value.trim().toLowerCase())}
            className={`input ${channel === "phone" ? "rounded-l-none" : ""} ${verified ? "border-emerald-300 bg-emerald-50/40" : ""}`} aria-invalid={Boolean(error) || undefined} />
        </div>
        {!verified && ready && (
          <button type="button" className="btn-secondary shrink-0 px-4" disabled={!valid || sending || (open && wait > 0)} onClick={start}>
            {sending ? <Spinner /> : open ? (wait > 0 ? `${wait}s` : "Resend") : "Verify"}
          </button>
        )}
      </div>
      {!ready && !verified && <span className="hint">Verification codes for {channel === "phone" ? "SMS" : "email"} aren't switched on yet. You can continue; we'll ask you to verify later.</span>}
      {open && !verified && (
        <div className="mt-2 rounded-xl border border-brand/30 bg-pine-tint/40 p-3">
          <p className="text-xs text-ink-soft">Enter the {len}-digit code sent to <b className="text-ink">{channel === "phone" ? `+91 ${value}` : value}</b></p>
          <div className="mt-2 flex gap-2">
            <input ref={codeRef} value={code} inputMode="numeric" autoComplete="one-time-code" maxLength={len} placeholder={"•".repeat(len)} aria-label={`${label} code`}
              onChange={(e) => { const v = e.target.value.replace(/\D/g, "").slice(0, len); setCode(v); if (v.length === len) submitCode(v); }}
              className="input num flex-1 text-center text-lg font-semibold tracking-[0.4em]" />
            <button type="button" className="btn-primary shrink-0 px-4" disabled={code.length !== len || checking} onClick={() => submitCode()}>{checking ? <Spinner /> : "Confirm"}</button>
          </div>
          {otpError && <p className="mt-1.5 text-xs font-medium text-bad" role="alert">{otpError}</p>}
        </div>
      )}
      {!open && otpError && <p className="mt-1.5 text-xs font-medium text-bad" role="alert">{otpError}</p>}
      <Err m={!verified ? error : undefined} />
    </div>
  );
}

// ---------- step 2: business ----------

function StepBusiness({ k, errors, busy }: { k: KycData; errors: KycErrors; busy: boolean }) {
  const [type, setType] = useState<BusinessType | undefined>(k.businessType);
  const [cat, setCat] = useState(k.category ?? "");
  return (
    <Form method="post" noValidate>
      <input type="hidden" name="step" value="2" />
      <StepHead n={2} title="Business details" text="This is how your brand appears across Growpefy." />
      <div className="grid gap-5 sm:grid-cols-2">
        <label className="block">
          <span className="label">Brand name<Req /></span>
          <input name="brandName" className="input" defaultValue={k.brandName} placeholder="e.g. Fusion Prime" aria-invalid={Boolean(errors.brandName) || undefined} />
          <Err m={errors.brandName} />
        </label>
        <label className="block">
          <span className="label">Store website<Opt /></span>
          <input name="website" className="input" placeholder="yourbrand.com" defaultValue={k.website} aria-invalid={Boolean(errors.website) || undefined} />
          <Err m={errors.website} />
        </label>
      </div>
      <fieldset className="mt-6">
        <legend className="label">Business type<Req /></legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {BUSINESS_TYPES.map((b) => (
            <label key={b.value} className={`flex cursor-pointer items-center gap-3 rounded-xl border px-3.5 py-3 text-sm transition ${type === b.value ? "border-brand bg-pine-tint font-medium text-ink" : "border-rule hover:border-rule-strong"}`}>
              <input type="radio" name="businessType" value={b.value} checked={type === b.value} onChange={() => setType(b.value)} className="sr-only" />
              <span aria-hidden className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2 ${type === b.value ? "border-brand" : "border-rule-strong"}`}>{type === b.value && <span className="h-2 w-2 rounded-full bg-brand" />}</span>
              {b.label}
            </label>
          ))}
        </div>
        <Err m={errors.businessType} />
      </fieldset>
      <fieldset className="mt-6">
        <legend className="label">What do you sell?<Req /></legend>
        <input type="hidden" name="category" value={cat} />
        <div className="flex flex-wrap gap-2">
          {CATEGORIES.map((c) => (
            <button type="button" key={c} onClick={() => setCat(c)} aria-pressed={cat === c}
              className={`rounded-full border px-3.5 py-1.5 text-sm transition ${cat === c ? "border-brand bg-pine-tint font-medium text-pine" : "border-rule-strong text-ink-soft hover:border-ink-faint"}`}>{c}</button>
          ))}
        </div>
        <Err m={errors.category} />
      </fieldset>
      <Footer busy={busy} back={1} label="Continue →" />
    </Form>
  );
}

// ---------- step 3: PAN & GST ----------

function StepTax({ k, errors, busy }: { k: KycData; errors: KycErrors; busy: boolean }) {
  const [pan, setPan] = useState(k.pan ?? "");
  const [name, setName] = useState(k.legalName ?? "");
  const [hasGst, setHasGst] = useState(Boolean(k.gstin));
  const [gstin, setGstin] = useState(k.gstin ?? "");
  // A server error belongs to the value that was sent; once the field is edited the live check takes over
  const [edited, setEdited] = useState({ pan: false, name: false, gstin: false });
  useEffect(() => setEdited({ pan: false, name: false, gstin: false }), [errors]);
  useEffect(() => { if (gstin.length === 15 && GSTIN_RE.test(gstin) && !pan) setPan(panFromGstin(gstin)); }, [gstin]); // eslint-disable-line react-hooks/exhaustive-deps

  const panLive = useMemo(() => {
    if (!pan) return null;
    if (pan.length < 10) return { ok: false, text: `${10 - pan.length} more character${pan.length === 9 ? "" : "s"}` };
    if (!/^[A-Z]{5}\d{4}[A-Z]$/.test(pan)) return { ok: false, text: "Format is 5 letters, 4 digits, 1 letter" };
    if (!PAN_RE.test(pan)) return { ok: false, text: /0000/.test(pan.slice(5, 9)) ? "The 4 digits can't be 0000" : `The 4th letter (${pan[3]}) isn't a valid PAN type` };
    return { ok: true, text: `${(panHolder(pan) ?? "").replace(/^./, (c) => c.toUpperCase())} PAN` };
  }, [pan]);
  const nameWarn = PAN_RE.test(pan) && name.length > 2 && !panNameMatches(pan, name) ? `Name should have a word starting with “${pan[4]}” (5th letter of the PAN)` : null;
  const typeWarn = panTypeWarning(pan, k.businessType);
  const gstLive = useMemo(() => {
    if (!hasGst || !gstin) return null;
    if (gstin.length < 15) return { ok: false, text: `${15 - gstin.length} more character${gstin.length === 14 ? "" : "s"}` };
    if (!GSTIN_RE.test(gstin)) return { ok: false, text: "Format: 2 digits, PAN (10), 1 digit/letter, Z, 1 digit/letter" };
    if (!stateFromGstin(gstin)) return { ok: false, text: "First 2 digits aren't a GST state code" };
    if (!PAN_RE.test(panFromGstin(gstin))) return { ok: false, text: "The PAN inside this GSTIN isn't valid" };
    if (!gstinChecksumOk(gstin)) return { ok: false, text: "Check character doesn't match. Re-check your GSTIN." };
    if (PAN_RE.test(pan) && panFromGstin(gstin) !== pan) return { ok: false, text: "This GSTIN is for a different PAN" };
    return { ok: true, text: `Valid · registered in ${stateFromGstin(gstin)}` };
  }, [gstin, hasGst, pan]);

  return (
    <Form method="post" noValidate>
      <input type="hidden" name="step" value="3" />
      <StepHead n={3} title="PAN & GST" text="Enter them exactly as on your PAN card and GST certificate. We check every character." />
      <div className="grid gap-5 sm:grid-cols-2">
        <label className="block">
          <span className="label">PAN<Req /></span>
          <input name="pan" className="input num uppercase tracking-[0.2em]" maxLength={10} placeholder="ABCPK1234F" value={pan} autoComplete="off"
            onChange={(e) => { setPan(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 10)); setEdited((x) => ({ ...x, pan: true })); }} aria-invalid={Boolean(errors.pan && !edited.pan) || undefined} />
          {errors.pan && !edited.pan ? <Err m={errors.pan} /> : panLive ? <span className={`hint ${panLive.ok ? "text-pine" : "text-bad"}`}>{panLive.ok ? "✓ " : ""}{panLive.text}</span> : <span className="hint">5 letters · 4 digits · 1 letter</span>}
          {typeWarn && panLive?.ok && <span className="mt-1 block text-xs text-warn">{typeWarn}</span>}
        </label>
        <label className="block">
          <span className="label">Name as per PAN<Req /></span>
          <input name="legalName" className="input" value={name} onChange={(e) => { setName(e.target.value); setEdited((x) => ({ ...x, name: true })); }} placeholder="Exactly as printed on the PAN card" aria-invalid={Boolean(errors.legalName && !edited.name) || undefined} />
          {errors.legalName && !edited.name && !edited.pan ? <Err m={errors.legalName} /> : nameWarn ? <span className="hint text-warn">{nameWarn}</span> : <span className="hint">Goes on your GST invoices</span>}
        </label>
      </div>

      <div className="mt-6 rounded-xl border border-rule p-4">
        <label className="flex cursor-pointer items-center justify-between gap-3">
          <span>
            <span className="flex items-center gap-2 text-sm font-medium">GST registration<Opt />{gstLive?.ok && <VerifiedBadge label="Verified business" />}</span>
            <span className="block text-xs text-ink-faint">Add your GSTIN to claim input credit on recharges and get the Verified business badge.</span>
          </span>
          <input type="checkbox" name="hasGst" checked={hasGst} onChange={(e) => setHasGst(e.target.checked)} className="peer sr-only" />
          <span aria-hidden className={`relative h-6 w-10 shrink-0 rounded-full transition ${hasGst ? "bg-brand" : "bg-rule-strong"}`}><span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${hasGst ? "left-[18px]" : "left-0.5"}`} /></span>
        </label>
        {hasGst && (
          <label className="mt-4 block">
            <span className="label">GSTIN</span>
            <input name="gstin" className="input num uppercase tracking-[0.15em]" maxLength={15} placeholder="09ABCPK1234F1Z5" value={gstin} autoComplete="off"
              onChange={(e) => { setGstin(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 15)); setEdited((x) => ({ ...x, gstin: true })); }} aria-invalid={Boolean(errors.gstin && !edited.gstin) || undefined} />
            {errors.gstin && !edited.gstin ? <Err m={errors.gstin} /> : gstLive ? <span className={`hint ${gstLive.ok ? "text-pine" : "text-bad"}`}>{gstLive.ok ? "✓ " : ""}{gstLive.text}</span> : <span className="hint">15 characters, from your GST certificate</span>}
          </label>
        )}
      </div>
      <Footer busy={busy} back={2} label="Continue →" />
    </Form>
  );
}

// ---------- step 4: address ----------

const norm = (s: string) => s.toLowerCase().replace(/[^a-z]/g, "").replace(/^nctof/, "");
const stateByName = (name: string) => INDIAN_STATES.find((s) => norm(s.name) === norm(name))?.name ?? "";

function StepAddress({ k, errors, busy }: { k: KycData; errors: KycErrors; busy: boolean }) {
  const [addr, setAddr] = useState(k.address ?? "");
  const [landmark, setLandmark] = useState(k.landmark ?? "");
  const [city, setCity] = useState(k.city ?? "");
  const [state, setState] = useState(k.state ?? (k.gstin ? stateFromGstin(k.gstin) ?? "" : ""));
  const [pin, setPin] = useState(k.pincode ?? "");
  const [geo, setGeo] = useState(k.geo ?? null);
  const [loc, setLoc] = useState<{ busy: boolean; msg: string | null; bad?: boolean }>({ busy: false, msg: null });

  useEffect(() => {
    if (!/^\d{6}$/.test(pin)) return;
    const ctrl = new AbortController();
    fetch(`/api/pincode/${pin}`, { signal: ctrl.signal }).then((r) => r.json()).then((d: { city: string | null; state: string | null }) => {
      if (d.city && !city) setCity(d.city);
      const name = INDIAN_STATES.find((s) => s.code === d.state)?.name;
      if (name && !state) setState(name);
    }).catch(() => {});
    return () => ctrl.abort();
  }, [pin]); // eslint-disable-line react-hooks/exhaustive-deps

  const locate = () => {
    if (!("geolocation" in navigator)) { setLoc({ busy: false, msg: "Your browser can't share location. Enter the address below.", bad: true }); return; }
    setLoc({ busy: true, msg: "Finding your location…" });
    navigator.geolocation.getCurrentPosition(async (pos) => {
      const { latitude: lat, longitude: lng } = pos.coords;
      setGeo({ lat, lng });
      try {
        const r = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&addressdetails=1&zoom=18&lat=${lat}&lon=${lng}`, { headers: { "Accept-Language": "en" } });
        const j = (await r.json()) as { address?: Record<string, string> };
        const a = j.address ?? {};
        const line = [a.house_number, a.building, a.road, a.neighbourhood, a.suburb ?? a.quarter, a.city_district].filter(Boolean).join(", ");
        if (line) setAddr(line);
        const c = a.city ?? a.town ?? a.village ?? a.county ?? a.state_district ?? "";
        if (c) setCity(c);
        const st = stateByName(a.state ?? "");
        if (st) setState(st);
        if (a.postcode && /^\d{6}$/.test(a.postcode.replace(/\s/g, ""))) setPin(a.postcode.replace(/\s/g, ""));
        setLoc({ busy: false, msg: "Address filled from your location. Add your house / shop number and check it." });
      } catch {
        setLoc({ busy: false, msg: "Got your location but couldn't look up the address. Please type it.", bad: true });
      }
    }, (e) => setLoc({ busy: false, msg: e.code === 1 ? "Location permission was denied. Allow it in the browser, or type the address." : "Couldn't get your location. Please type the address.", bad: true }), { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 });
  };

  return (
    <Form method="post" noValidate>
      <input type="hidden" name="step" value="4" />
      <input type="hidden" name="lat" value={geo?.lat ?? ""} />
      <input type="hidden" name="lng" value={geo?.lng ?? ""} />
      <StepHead n={4} title="Business address" text={k.gstin ? "Use the address of your GST registration." : "Where your business operates from. It appears on your invoices."} />
      <button type="button" onClick={locate} disabled={loc.busy}
        className="group flex w-full items-center gap-3 rounded-xl border-2 border-dashed border-brand/40 bg-pine-tint/30 px-4 py-3.5 text-left transition hover:border-brand hover:bg-pine-tint/60 disabled:opacity-70">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand text-white">
          {loc.busy ? <Spinner /> : <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden><circle cx="12" cy="12" r="3" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3" /><circle cx="12" cy="12" r="7" /></svg>}
        </span>
        <span><span className="block text-sm font-semibold text-ink">Auto-locate my location</span><span className="block text-xs text-ink-soft">Fill the address from your current location in one tap</span></span>
      </button>
      {loc.msg && <p className={`mt-2 text-xs ${loc.bad ? "text-warn" : "text-pine"}`} role="status">{loc.msg}</p>}

      <div className="mt-6 grid gap-5 sm:grid-cols-6">
        <label className="block sm:col-span-6">
          <span className="label">House / shop no., building, street, area<Req /></span>
          <input name="address" className="input" autoComplete="street-address" value={addr} onChange={(e) => setAddr(e.target.value)} placeholder="Shop 12, Green Park, MG Road" aria-invalid={Boolean(errors.address) || undefined} />
          <Err m={errors.address} />
        </label>
        <label className="block sm:col-span-6">
          <span className="label">Landmark<Opt /></span>
          <input name="landmark" className="input" value={landmark} onChange={(e) => setLandmark(e.target.value)} placeholder="Near City Mall" />
        </label>
        <label className="block sm:col-span-2">
          <span className="label">Pincode<Req /></span>
          <input name="pincode" inputMode="numeric" maxLength={6} className="input num" value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 6))} aria-invalid={Boolean(errors.pincode) || undefined} />
          <Err m={errors.pincode} />
        </label>
        <label className="block sm:col-span-2">
          <span className="label">City<Req /></span>
          <input name="city" className="input" value={city} onChange={(e) => setCity(e.target.value)} aria-invalid={Boolean(errors.city) || undefined} />
          <Err m={errors.city} />
        </label>
        <label className="block sm:col-span-2">
          <span className="label">State<Req /></span>
          <select name="state" className="input" value={state} onChange={(e) => setState(e.target.value)} aria-invalid={Boolean(errors.state) || undefined}>
            <option value="">Select</option>
            {INDIAN_STATES.map((s) => <option key={s.code} value={s.name}>{s.name}</option>)}
          </select>
          <Err m={errors.state} />
        </label>
      </div>
      <Footer busy={busy} back={3} label="Continue →" />
    </Form>
  );
}

// ---------- step 5: documents ----------

function StepDocs({ k, errors, busy, docs }: { k: KycData; errors: KycErrors; busy: boolean; docs: L["docs"] }) {
  const has = (kind: DocKind) => docs.find((d) => d.kind === kind);
  return (
    <Form method="post" encType="multipart/form-data" noValidate>
      <input type="hidden" name="step" value="5" />
      <StepHead n={5} title="Documents" text="Upload clear photos or PDFs. Up to 5 MB each (PDF, JPG, PNG, WEBP)." />
      <div className="grid gap-4">
        <DocUpload kind="pan" required existing={has("pan")} error={errors.panDoc} hint="Front side, all 10 characters readable" />
        {k.gstin
          ? <DocUpload kind="gst" required existing={has("gst")} error={errors.gstDoc} hint={`GST registration certificate (Form REG-06) for ${k.gstin}`} />
          : <p className="rounded-xl border border-dashed border-rule-strong px-4 py-3 text-xs text-ink-soft">No GSTIN added, so no GST certificate is needed. <Link to="?step=3" className="font-medium text-pine underline">Add GSTIN</Link></p>}
        <DocUpload kind="other" existing={has("other")} error={errors.docs} hint="Cancelled cheque, shop license, Udyam certificate… (optional)" />
      </div>
      <Footer busy={busy} back={4} label={busy ? "Uploading" : "Continue →"} />
    </Form>
  );
}

function DocUpload({ kind, required, existing, error, hint }: { kind: DocKind; required?: boolean; existing?: L["docs"][number]; error?: string; hint: string }) {
  const [file, setFile] = useState<File | null>(null);
  const [local, setLocal] = useState<string | null>(null);
  const [drag, setDrag] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const pick = (f: File | null) => {
    if (!f) return;
    if (f.size > DOC_MAX_BYTES) { setLocal("This file is over 5 MB"); setFile(null); return; }
    if (!DOC_TYPES.includes(f.type)) { setLocal("Use a PDF, JPG, PNG or WEBP file"); setFile(null); return; }
    setLocal(null); setFile(f);
    const dt = new DataTransfer(); dt.items.add(f);
    if (input.current) input.current.files = dt.files;
  };
  const kb = (n: number) => (n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
  return (
    <div>
      <div onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)} onDrop={(e) => { e.preventDefault(); setDrag(false); pick(e.dataTransfer.files[0] ?? null); }}
        className={`flex flex-wrap items-center gap-4 rounded-xl border-2 border-dashed px-4 py-4 transition ${drag ? "border-brand bg-pine-tint/40" : (error && !file) || local ? "border-red-300 bg-red-50/40" : existing || file ? "border-emerald-300 bg-emerald-50/30" : "border-rule-strong"}`}>
        <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-lg ${existing || file ? "bg-emerald-100" : "bg-paper-sunk"}`} aria-hidden>{existing || file ? "✓" : "📄"}</span>
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-2 text-sm font-semibold">{DOC_KINDS[kind]}{required ? <Req /> : <Opt />}</p>
          <p className="truncate text-xs text-ink-soft">
            {file ? `${file.name} · ${kb(file.size)} · will upload on Continue`
              : existing ? <>Uploaded: {existing.filename} · {kb(existing.size)} · <a href={`/onboarding/doc/${kind}`} target="_blank" rel="noreferrer" className="font-medium text-pine underline">View</a></>
              : hint}
          </p>
        </div>
        <input ref={input} type="file" name={`${kind}Doc`} accept=".pdf,.jpg,.jpeg,.png,.webp,application/pdf,image/jpeg,image/png,image/webp" className="sr-only" id={`doc-${kind}`} onChange={(e) => pick(e.target.files?.[0] ?? null)} />
        <label htmlFor={`doc-${kind}`} className="btn-secondary cursor-pointer px-4">{existing || file ? "Replace" : "Choose file"}</label>
      </div>
      <Err m={local ?? (file ? undefined : error)} />
    </div>
  );
}

// ---------- step 6: review ----------

function StepReview({ k, errors, busy, docs, ready }: { k: KycData; errors: KycErrors; busy: boolean; docs: L["docs"]; ready: L["ready"] }) {
  const type = BUSINESS_TYPES.find((b) => b.value === k.businessType)?.label;
  const Row = ({ label, value, badge }: { label: string; value?: string | null; badge?: React.ReactNode }) => (
    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-2 text-sm">
      <dt className="text-ink-soft">{label}</dt>
      <dd className="flex items-center gap-2 text-right font-medium">{value || <span className="font-normal text-ink-faint">—</span>}{badge}</dd>
    </div>
  );
  const Block = ({ title, step, children }: { title: string; step: number; children: React.ReactNode }) => (
    <section className="rounded-xl border border-rule">
      <header className="flex items-center justify-between border-b border-rule px-4 py-2.5"><h3 className="text-sm font-semibold">{title}</h3><Link to={`?step=${step}`} className="text-xs font-medium text-pine hover:underline">Edit</Link></header>
      <dl className="divide-y divide-rule px-4">{children}</dl>
    </section>
  );
  return (
    <Form method="post" noValidate>
      <input type="hidden" name="step" value={KYC_LAST} />
      <StepHead n={6} title="Review & submit" text="Check everything once. You can edit any section." />
      <div className="grid gap-4">
        <Block title="Personal details" step={1}>
          <Row label="Name" value={k.contactName} />
          <Row label="Mobile" value={k.phone ? `+91 ${k.phone}` : ""} badge={k.phoneVerified === k.phone && k.phone ? <VerifiedBadge /> : !ready.phone ? <span className="text-[11px] text-ink-faint">verify later</span> : null} />
          {k.altPhone && <Row label="Alternate mobile" value={`+91 ${k.altPhone}`} />}
          <Row label="Email" value={k.email} badge={k.emailVerified === k.email && k.email ? <VerifiedBadge /> : !ready.email ? <span className="text-[11px] text-ink-faint">verify later</span> : null} />
          {k.altEmail && <Row label="Alternate email" value={k.altEmail} />}
        </Block>
        <Block title="Business details" step={2}>
          <Row label="Brand" value={k.brandName} />
          <Row label="Type" value={type} />
          <Row label="Category" value={k.category} />
          {k.website && <Row label="Website" value={k.website} />}
        </Block>
        <Block title="PAN & GST" step={3}>
          <Row label="PAN" value={k.pan} />
          <Row label="Name as per PAN" value={k.legalName} />
          <Row label="GSTIN" value={k.gstin || "Not registered"} badge={gstVerified(k) ? <VerifiedBadge label="Verified business" /> : null} />
        </Block>
        <Block title="Address" step={4}>
          <Row label="Address" value={[k.address, k.landmark].filter(Boolean).join(", ")} />
          <Row label="City / State" value={`${k.city ?? ""}${k.state ? `, ${k.state}` : ""} ${k.pincode ?? ""}`} />
        </Block>
        <Block title="Documents" step={5}>
          {(Object.keys(DOC_KINDS) as DocKind[]).filter((kind) => kind !== "gst" || k.gstin || docs.some((d) => d.kind === "gst")).map((kind) => {
            const doc = docs.find((d) => d.kind === kind);
            return <Row key={kind} label={DOC_KINDS[kind]} value={doc ? doc.filename : kind === "other" ? "Not added" : "Missing"} badge={doc ? <a href={`/onboarding/doc/${kind}`} target="_blank" rel="noreferrer" className="text-xs font-medium text-pine underline">View</a> : null} />;
          })}
        </Block>
      </div>
      <label className="mt-6 flex cursor-pointer items-start gap-3 rounded-xl bg-paper px-4 py-3 text-sm">
        <input type="checkbox" name="declare" className="mt-0.5 h-4 w-4 accent-[var(--brand,#059669)]" />
        <span>I confirm these details and documents are correct and belong to my business. I agree to the <Link to="/terms" target="_blank" className="underline">Terms</Link> and <Link to="/privacy" target="_blank" className="underline">Privacy policy</Link>.</span>
      </label>
      <Err m={errors.declare} />
      <Footer busy={busy} back={5} label="Submit KYC ✓" />
    </Form>
  );
}

function Done({ k, hasStore }: { k: KycData; hasStore: boolean }) {
  const [show, setShow] = useState(false);
  useEffect(() => { const t = setTimeout(() => setShow(true), 60); return () => clearTimeout(t); }, []);
  return (
    <div className="py-8 text-center">
      <div className={`mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-pine-tint text-4xl transition-all duration-500 ${show ? "scale-100 opacity-100" : "scale-50 opacity-0"}`} aria-hidden>🎉</div>
      <h1 className="mt-5 text-2xl font-semibold tracking-tight">KYC complete{k.brandName ? `, ${k.brandName} is ready` : ""}</h1>
      <div className="mt-3 flex flex-wrap justify-center gap-2">
        {k.phone && k.phoneVerified === k.phone && <VerifiedBadge label="Mobile verified" />}
        {k.email && k.emailVerified === k.email && <VerifiedBadge label="Email verified" />}
        {gstVerified(k) && <VerifiedBadge label="Verified business" />}
      </div>
      <p className="mx-auto mt-3 max-w-md text-sm text-ink-soft">Your dashboard is unlocked. {hasStore ? "Pick up where you left off." : "Connect your store to switch on your checkout, RTO protection and ad tracking."}</p>
      <Link to={hasStore ? "/dashboard" : "/dashboard/stores/new"} className="btn-primary mt-8 px-8 py-3">{hasStore ? "Go to dashboard →" : "Connect your store →"}</Link>
    </div>
  );
}
