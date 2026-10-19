import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { Form, Link, useActionData, useLoaderData, useNavigation } from "@remix-run/react";
import { eq, inArray } from "drizzle-orm";
import { useEffect, useMemo, useState } from "react";
import { BrandLockup } from "~/components/Brand";
import { Icon } from "~/components/Icons";
import { Notice, Spinner } from "~/components/ui";
import { db, stores, users, wallets } from "~/db.server";
import { requireViewer } from "~/lib/auth.server";
import { requireAppHost } from "~/lib/host.server";
import {
  BUSINESS_TYPES, CATEGORIES, KYC_STEPS, PAN_RE, GSTIN_RE, gstinChecksumOk, panFromGstin, panHolder, panTypeWarning, stateFromGstin,
  validateStep, type BusinessType, type KycData, type KycErrors,
} from "~/lib/kyc";
import { INDIAN_STATES } from "~/lib/states";
import { getWallet } from "~/lib/wallet.server";

export const meta: MetaFunction = () => [{ title: "Set up your account · Growpefy" }, { name: "robots", content: "noindex" }];

export async function loader({ request }: LoaderFunctionArgs) {
  requireAppHost(request);
  const viewer = await requireViewer(request);
  if (viewer.role !== "owner") throw redirect("/dashboard");
  const [u] = await db.select().from(users).where(eq(users.id, viewer.userId)).limit(1);
  const url = new URL(request.url);
  const done = u.kycStatus === "approved";
  const lastDone = Math.min(3, u.kyc.step ?? 0);
  const asked = Number(url.searchParams.get("step"));
  // Can open any step already done, or the next one
  const step = done && (!asked || asked >= 4) ? 4 : Math.max(1, Math.min(done ? 3 : lastDone + 1, asked || lastDone + 1));
  const [{ n } = { n: 0 }] = await db.select({ n: stores.id }).from(stores).where(eq(stores.ownerId, u.id)).limit(1);
  return json({
    step, done, hasStore: Boolean(n),
    signupWith: u.signupWith as "phone" | "email",
    kyc: { ...u.kyc, brandName: u.kyc.brandName ?? u.name, email: u.kyc.email ?? u.email ?? "", phone: u.kyc.phone ?? u.phone ?? "" } as KycData,
  });
}

const clean = (v: FormDataEntryValue | null, max = 200) => String(v ?? "").trim().replace(/\s+/g, " ").slice(0, max);

export async function action({ request }: ActionFunctionArgs) {
  requireAppHost(request);
  const viewer = await requireViewer(request);
  if (viewer.role !== "owner") throw redirect("/dashboard");
  const [u] = await db.select().from(users).where(eq(users.id, viewer.userId)).limit(1);
  const fd = await request.formData();
  const step = Number(fd.get("step"));
  if (![1, 2, 3].includes(step)) return json({ errors: { form: "Something went wrong. Reload the page." } as KycErrors }, { status: 400 });

  const k: KycData = { ...u.kyc };
  if (step === 1) {
    k.brandName = clean(fd.get("brandName"), 120);
    k.legalName = clean(fd.get("legalName"), 160);
    k.businessType = String(fd.get("businessType") ?? "") as BusinessType;
    if (!BUSINESS_TYPES.some((b) => b.value === k.businessType)) k.businessType = undefined;
    k.category = clean(fd.get("category"), 60);
    k.website = clean(fd.get("website"), 200).replace(/^https?:\/\//i, "").replace(/\/+$/, "");
  }
  if (step === 2) {
    k.contactName = clean(fd.get("contactName"), 120);
    // The field used to sign up can't be changed here
    k.phone = u.signupWith === "phone" ? u.phone ?? "" : clean(fd.get("phone"), 15).replace(/\D/g, "").replace(/^(91|0)(?=\d{10}$)/, "");
    k.email = u.signupWith === "email" ? u.email ?? "" : clean(fd.get("email"), 160).toLowerCase();
    k.whatsapp = fd.get("sameWhatsapp") === "on" ? k.phone : clean(fd.get("whatsapp"), 15).replace(/\D/g, "").replace(/^(91|0)(?=\d{10}$)/, "");
  }
  if (step === 3) {
    k.pan = clean(fd.get("pan"), 10).toUpperCase().replace(/\s/g, "");
    k.gstin = fd.get("hasGst") === "on" ? clean(fd.get("gstin"), 15).toUpperCase().replace(/\s/g, "") : "";
    k.address = clean(fd.get("address"), 300);
    k.city = clean(fd.get("city"), 80);
    k.state = clean(fd.get("state"), 80);
    k.pincode = clean(fd.get("pincode"), 6).replace(/\D/g, "");
  }

  const errors = validateStep(step, k);
  // Mobile / email must be unique across owners
  if (step === 2 && !errors.phone && u.signupWith !== "phone") {
    const [other] = await db.select({ id: users.id }).from(users).where(eq(users.phone, k.phone!)).limit(1);
    if (other && other.id !== u.id) errors.phone = "This number is already used by another account";
  }
  if (step === 2 && !errors.email && u.signupWith !== "email") {
    const [other] = await db.select({ id: users.id }).from(users).where(eq(users.email, k.email!)).limit(1);
    if (other && other.id !== u.id) errors.email = "This email is already used by another account";
  }
  if (Object.keys(errors).length) return json({ errors, values: k }, { status: 400 });

  k.step = Math.max(u.kyc.step ?? 0, step);
  const patch: Partial<typeof users.$inferInsert> = { kyc: k };
  if (step === 1 && k.brandName) patch.name = k.brandName;
  if (step === 2) {
    if (u.signupWith === "phone") patch.email = k.email || null;
    else patch.phone = k.phone || null;
  }
  if (step === 3) {
    // Format checks passed: approve right away (no paid verification)
    patch.kycStatus = "approved";
    patch.kycSubmittedAt = new Date();
  }
  await db.update(users).set(patch).where(eq(users.id, u.id));

  if (step === 3) {
    // Invoice details for every wallet of this owner that doesn't have them yet
    const owned = await db.select({ id: stores.id }).from(stores).where(eq(stores.ownerId, u.id));
    await Promise.all(owned.map((s) => getWallet(s.id)));
    if (owned.length) {
      const ws = await db.select().from(wallets).where(inArray(wallets.storeId, owned.map((s) => s.id)));
      const billing = { name: k.legalName, gstin: k.gstin || "", address: [k.address, k.city, k.pincode].filter(Boolean).join(", "), state: k.state, email: k.email, phone: k.phone };
      for (const w of ws) if (!w.billing?.name) await db.update(wallets).set({ billing, updatedAt: new Date() }).where(eq(wallets.id, w.id));
    }
    return redirect("/onboarding?step=4");
  }
  return redirect(`/onboarding?step=${step + 1}`);
}

// ================= UI =================

export default function Onboarding() {
  const d = useLoaderData<typeof loader>();
  const a = useActionData<typeof action>();
  const nav = useNavigation();
  const errors = (a && "errors" in a ? a.errors : {}) as KycErrors;
  const k: KycData = { ...(d.kyc as KycData), ...((a && "values" in a ? a.values : {}) as KycData) };
  const busy = nav.state !== "idle";
  const pct = d.step >= 4 ? 100 : Math.round(((d.step - 1) / 3) * 100);

  return (
    <main className="min-h-screen bg-paper">
      <header className="flex items-center justify-between px-5 py-4 sm:px-8">
        <BrandLockup className="h-8" />
        <Form method="post" action="/logout"><button className="text-sm text-ink-soft hover:text-ink">Log out</button></Form>
      </header>

      <div className="mx-auto grid max-w-5xl gap-6 px-4 pb-16 pt-2 lg:grid-cols-[260px_minmax(0,1fr)] lg:gap-10">
        {/* Progress rail */}
        <aside className="lg:pt-6">
          <div className="mb-4 h-1.5 overflow-hidden rounded-full bg-paper-sunk lg:hidden"><div className="h-full rounded-full bg-brand transition-all duration-500" style={{ width: `${pct}%` }} /></div>
          <ol className="flex gap-2 overflow-x-auto lg:flex-col lg:gap-1">
            {KYC_STEPS.map((s) => {
              const state = d.step > s.n ? "done" : d.step === s.n ? "now" : "next";
              const reachable = state !== "next";
              const inner = (
                <span className={`flex min-w-[150px] items-center gap-3 rounded-xl px-3 py-2.5 transition lg:min-w-0 ${state === "now" ? "bg-surface shadow-sm ring-1 ring-rule" : ""}`}>
                  <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-semibold ${state === "done" ? "bg-brand text-white" : state === "now" ? "bg-ink text-white" : "bg-paper-sunk text-ink-faint"}`}>
                    {state === "done" ? <Icon name="check" className="h-4 w-4" strokeWidth={3} /> : s.n}
                  </span>
                  <span className="min-w-0">
                    <span className={`block text-sm font-medium ${state === "next" ? "text-ink-faint" : "text-ink"}`}>{s.title}</span>
                    <span className="block text-xs text-ink-faint">{s.note}</span>
                  </span>
                </span>
              );
              return <li key={s.n}>{reachable && d.step < 4 ? <Link to={`?step=${s.n}`} preventScrollReset>{inner}</Link> : inner}</li>;
            })}
          </ol>
          <div className="mt-6 hidden rounded-xl border border-rule bg-surface p-4 text-sm text-ink-soft lg:block">
            <p className="flex items-center gap-2 font-medium text-ink"><Icon name="shield" className="h-4 w-4 text-pine" />Why we ask</p>
            <p className="mt-1.5 text-xs leading-relaxed">PAN and GST go on your wallet recharge invoices so you can claim GST input credit. We never share them.</p>
          </div>
        </aside>

        <section className="panel p-5 sm:p-8">
          {d.step === 1 && <StepBusiness k={k} errors={errors} busy={busy} />}
          {d.step === 2 && <StepContact k={k} errors={errors} busy={busy} signupWith={d.signupWith} />}
          {d.step === 3 && <StepTax k={k} errors={errors} busy={busy} />}
          {d.step >= 4 && <Done brand={k.brandName ?? ""} hasStore={d.hasStore} />}
        </section>
      </div>
    </main>
  );
}

function StepHead({ n, title, text }: { n: number; title: string; text: string }) {
  return (
    <div className="mb-6">
      <p className="text-xs font-semibold uppercase tracking-wider text-pine">Step {n} of 3</p>
      <h1 className="mt-1 text-2xl font-semibold tracking-tight">{title}</h1>
      <p className="mt-1 text-sm text-ink-soft">{text}</p>
    </div>
  );
}

function Err({ m }: { m?: string }) {
  return m ? <span className="error-text">{m}</span> : null;
}

function Footer({ busy, back, label }: { busy: boolean; back?: number; label: string }) {
  return (
    <div className="mt-8 flex items-center justify-between gap-3 border-t border-rule pt-5">
      {back ? <Link to={`?step=${back}`} className="btn-secondary" preventScrollReset>← Back</Link> : <span />}
      <button type="submit" className="btn-primary min-w-[160px] py-3" disabled={busy}>{busy ? <><Spinner /> Saving</> : label}</button>
    </div>
  );
}

function StepBusiness({ k, errors, busy }: { k: KycData; errors: KycErrors; busy: boolean }) {
  const [type, setType] = useState<BusinessType | undefined>(k.businessType);
  const [cat, setCat] = useState(k.category ?? "");
  return (
    <Form method="post" noValidate>
      <input type="hidden" name="step" value="1" />
      <StepHead n={1} title="Tell us about your business" text="This is how your brand will appear across Growpefy." />
      {errors.form && <div className="mb-4"><Notice tone="error">{errors.form}</Notice></div>}
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className="label">Brand name</span>
          <input name="brandName" className="input" defaultValue={k.brandName} aria-invalid={Boolean(errors.brandName) || undefined} />
          <Err m={errors.brandName} />
        </label>
        <label className="block">
          <span className="label">Legal business name</span>
          <input name="legalName" className="input" placeholder="As on PAN / GST certificate" defaultValue={k.legalName} aria-invalid={Boolean(errors.legalName) || undefined} />
          <Err m={errors.legalName} />
        </label>
      </div>

      <fieldset className="mt-5">
        <legend className="label">Business type</legend>
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

      <fieldset className="mt-5">
        <legend className="label">What do you sell?</legend>
        <input type="hidden" name="category" value={cat} />
        <div className="flex flex-wrap gap-2">
          {CATEGORIES.map((c) => (
            <button type="button" key={c} onClick={() => setCat(c)} aria-pressed={cat === c}
              className={`rounded-full border px-3.5 py-1.5 text-sm transition ${cat === c ? "border-brand bg-pine-tint font-medium text-pine" : "border-rule-strong text-ink-soft hover:border-ink-faint"}`}>{c}</button>
          ))}
        </div>
        <Err m={errors.category} />
      </fieldset>

      <label className="mt-5 block">
        <span className="label">Store website <span className="font-normal text-ink-faint">(optional)</span></span>
        <input name="website" className="input" placeholder="yourbrand.com" defaultValue={k.website} aria-invalid={Boolean(errors.website) || undefined} />
        <Err m={errors.website} />
      </label>
      <Footer busy={busy} label="Continue →" />
    </Form>
  );
}

function StepContact({ k, errors, busy, signupWith }: { k: KycData; errors: KycErrors; busy: boolean; signupWith: "phone" | "email" }) {
  const [phone, setPhone] = useState(k.phone ?? "");
  const [same, setSame] = useState(!k.whatsapp || k.whatsapp === k.phone);
  const lockPhone = signupWith === "phone";
  const lockEmail = signupWith === "email";
  return (
    <Form method="post" noValidate>
      <input type="hidden" name="step" value="2" />
      <StepHead n={2} title="How can we reach you?" text="We send OTP alerts, low wallet balance warnings and invoices here." />
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block sm:col-span-2">
          <span className="label">Your name</span>
          <input name="contactName" className="input" autoComplete="name" defaultValue={k.contactName} aria-invalid={Boolean(errors.contactName) || undefined} />
          <Err m={errors.contactName} />
        </label>
        <label className="block">
          <span className="label">Mobile number {lockPhone && <LockTag />}</span>
          <div className="flex">
            <span className="flex items-center rounded-l-lg border border-r-0 border-rule-strong bg-paper px-3 text-[15px] text-ink-soft">+91</span>
            <input name="phone" inputMode="numeric" maxLength={10} className={`input rounded-l-none ${lockPhone ? "cursor-not-allowed bg-paper text-ink-soft" : ""}`}
              value={phone} readOnly={lockPhone} onChange={(e) => setPhone(e.target.value.replace(/\D/g, "").slice(0, 10))} aria-invalid={Boolean(errors.phone) || undefined} />
          </div>
          {lockPhone ? <span className="hint">You signed up with this number, so it can't be changed.</span> : <Err m={errors.phone} />}
        </label>
        <label className="block">
          <span className="label">Email {lockEmail && <LockTag />}</span>
          <input name="email" type="email" className={`input ${lockEmail ? "cursor-not-allowed bg-paper text-ink-soft" : ""}`} defaultValue={k.email} readOnly={lockEmail} autoComplete="email" aria-invalid={Boolean(errors.email) || undefined} />
          {lockEmail ? <span className="hint">You signed up with this email, so it can't be changed.</span> : <Err m={errors.email} />}
        </label>
      </div>
      <div className="mt-5 rounded-xl border border-rule bg-paper/60 p-4">
        <label className="flex cursor-pointer items-center gap-3 text-sm font-medium">
          <input type="checkbox" name="sameWhatsapp" checked={same} onChange={(e) => setSame(e.target.checked)} className="h-4 w-4 accent-[var(--brand,#059669)]" />
          WhatsApp is on the same number
        </label>
        {!same && (
          <label className="mt-3 block">
            <span className="label">WhatsApp number</span>
            <input name="whatsapp" inputMode="numeric" maxLength={10} className="input" defaultValue={k.whatsapp !== k.phone ? k.whatsapp : ""} aria-invalid={Boolean(errors.whatsapp) || undefined} />
            <Err m={errors.whatsapp} />
          </label>
        )}
      </div>
      <Footer busy={busy} back={1} label="Continue →" />
    </Form>
  );
}

function LockTag() {
  return <span className="ml-1 inline-flex items-center gap-1 rounded bg-paper-sunk px-1.5 py-px text-[10px] font-semibold uppercase text-ink-soft">🔒 Locked</span>;
}

function StepTax({ k, errors, busy }: { k: KycData; errors: KycErrors; busy: boolean }) {
  const [pan, setPan] = useState(k.pan ?? "");
  const [hasGst, setHasGst] = useState(Boolean(k.gstin) || (k.businessType !== undefined && k.businessType !== "individual"));
  const [gstin, setGstin] = useState(k.gstin ?? "");
  const [state, setState] = useState(k.state ?? "");
  const [city, setCity] = useState(k.city ?? "");
  const [pin, setPin] = useState(k.pincode ?? "");

  // GSTIN fills PAN and state
  useEffect(() => {
    if (gstin.length === 15 && GSTIN_RE.test(gstin)) {
      const p = panFromGstin(gstin);
      if (!pan) setPan(p);
      const st = stateFromGstin(gstin);
      if (st) setState(st);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gstin]);
  // Pincode fills city and state
  useEffect(() => {
    if (!/^\d{6}$/.test(pin)) return;
    const ctrl = new AbortController();
    fetch(`/api/pincode/${pin}`, { signal: ctrl.signal }).then((r) => r.json()).then((d: { city: string | null; state: string | null }) => {
      if (d.city && !city) setCity(d.city);
      const name = INDIAN_STATES.find((s) => s.code === d.state)?.name;
      if (name && !(hasGst && gstin.length === 15)) setState(name);
    }).catch(() => {});
    return () => ctrl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pin]);

  const panOk = PAN_RE.test(pan);
  const holder = panOk ? panHolder(pan) : null;
  const warn = panTypeWarning(pan, k.businessType);
  const gstLive = useMemo(() => {
    if (!hasGst || gstin.length < 15) return null;
    if (!gstinChecksumOk(gstin)) return { ok: false, text: "This GSTIN doesn't look valid" };
    if (panOk && panFromGstin(gstin) !== pan) return { ok: false, text: "This GSTIN is for a different PAN" };
    return { ok: true, text: `Registered in ${stateFromGstin(gstin) ?? "—"}` };
  }, [gstin, hasGst, pan, panOk]);

  return (
    <Form method="post" noValidate>
      <input type="hidden" name="step" value="3" />
      <StepHead n={3} title="Tax & billing details" text="Used on your wallet recharge invoices. GST is optional." />
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className="label">PAN</span>
          <input name="pan" className="input num uppercase tracking-wider" maxLength={10} placeholder="ABCDE1234F" value={pan}
            onChange={(e) => setPan(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 10))} aria-invalid={Boolean(errors.pan) || undefined} />
          {errors.pan ? <Err m={errors.pan} /> : holder ? <span className="hint text-pine">✓ {holder[0].toUpperCase() + holder.slice(1)} PAN</span> : <span className="hint">10 characters, on your PAN card</span>}
          {warn && !errors.pan && <span className="mt-1 block text-xs text-warn">{warn}</span>}
        </label>
        <div>
          <label className="mb-1.5 flex cursor-pointer items-center justify-between gap-3">
            <span className="label mb-0">GSTIN</span>
            <span className="flex items-center gap-2 text-xs text-ink-soft">
              I have GST
              <input type="checkbox" name="hasGst" checked={hasGst} onChange={(e) => setHasGst(e.target.checked)} className="sr-only peer" />
              <span aria-hidden className={`relative h-5 w-9 rounded-full transition ${hasGst ? "bg-brand" : "bg-rule-strong"}`}><span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all ${hasGst ? "left-[18px]" : "left-0.5"}`} /></span>
            </span>
          </label>
          {hasGst ? (
            <>
              <input name="gstin" className="input num uppercase tracking-wider" maxLength={15} placeholder="09ABCDE1234F1Z5" value={gstin}
                onChange={(e) => setGstin(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 15))} aria-invalid={Boolean(errors.gstin) || undefined} />
              {errors.gstin ? <Err m={errors.gstin} /> : gstLive ? <span className={`hint ${gstLive.ok ? "text-pine" : "text-bad"}`}>{gstLive.ok ? "✓ " : ""}{gstLive.text}</span> : <span className="hint">We'll fill your PAN and state from it</span>}
            </>
          ) : (
            <p className="rounded-lg border border-dashed border-rule-strong px-3 py-2.5 text-xs text-ink-soft">No problem. Invoices will be made without GSTIN. You can add it later in Wallet → Billing.</p>
          )}
        </div>
      </div>

      <h3 className="mt-7 text-sm font-semibold">Billing address</h3>
      <div className="mt-3 grid gap-4 sm:grid-cols-6">
        <label className="block sm:col-span-6">
          <span className="label">Address</span>
          <input name="address" className="input" autoComplete="street-address" placeholder="Building, street, area" defaultValue={k.address} aria-invalid={Boolean(errors.address) || undefined} />
          <Err m={errors.address} />
        </label>
        <label className="block sm:col-span-2">
          <span className="label">Pincode</span>
          <input name="pincode" inputMode="numeric" maxLength={6} className="input" value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 6))} aria-invalid={Boolean(errors.pincode) || undefined} />
          <Err m={errors.pincode} />
        </label>
        <label className="block sm:col-span-2">
          <span className="label">City</span>
          <input name="city" className="input" value={city} onChange={(e) => setCity(e.target.value)} aria-invalid={Boolean(errors.city) || undefined} />
          <Err m={errors.city} />
        </label>
        <label className="block sm:col-span-2">
          <span className="label">State</span>
          <select name="state" className="input" value={state} onChange={(e) => setState(e.target.value)} aria-invalid={Boolean(errors.state) || undefined}>
            <option value="">Select</option>
            {INDIAN_STATES.map((s) => <option key={s.code} value={s.name}>{s.name}</option>)}
          </select>
          <Err m={errors.state} />
        </label>
      </div>
      <Footer busy={busy} back={2} label="Finish setup ✓" />
    </Form>
  );
}

function Done({ brand, hasStore }: { brand: string; hasStore: boolean }) {
  const [show, setShow] = useState(false);
  useEffect(() => { const t = setTimeout(() => setShow(true), 60); return () => clearTimeout(t); }, []);
  return (
    <div className="py-6 text-center">
      <div className={`mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-pine-tint text-4xl transition-all duration-500 ${show ? "scale-100 opacity-100" : "scale-50 opacity-0"}`} aria-hidden>🎉</div>
      <h1 className="mt-5 text-2xl font-semibold tracking-tight">{brand ? `${brand} is ready to go` : "You're all set"}</h1>
      <p className="mx-auto mt-2 max-w-md text-sm text-ink-soft">Your dashboard is unlocked. Connect your store to switch on your checkout, RTO protection and ad tracking.</p>
      <div className="mx-auto mt-7 grid max-w-md gap-3 text-left sm:grid-cols-3">
        {[["stores", "Connect store"], ["shipping", "Connect courier"], ["wallet", "Recharge wallet"]].map(([icon, label], i) => (
          <div key={label} className={`rounded-xl border border-rule bg-surface p-3 transition-all duration-500 ${show ? "translate-y-0 opacity-100" : "translate-y-2 opacity-0"}`} style={{ transitionDelay: `${150 + i * 90}ms` }}>
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-paper-sunk"><Icon name={icon as "stores"} className="h-4 w-4" /></span>
            <p className="mt-2 text-xs font-medium">{i + 1}. {label}</p>
          </div>
        ))}
      </div>
      <Link to={hasStore ? "/dashboard" : "/dashboard/stores/new"} className="btn-primary mt-8 px-8 py-3">{hasStore ? "Go to dashboard →" : "Connect your store →"}</Link>
    </div>
  );
}
