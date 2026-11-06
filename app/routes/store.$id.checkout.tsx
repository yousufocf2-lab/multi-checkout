// Settings → Checkout: Smart Checkout (activate with consent), customer fields, OTP, tipping, and links to design and payment offers.
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Form, Link, useActionData, useLoaderData, useNavigation, useSearchParams } from "@remix-run/react";
import { eq } from "drizzle-orm";
import { useEffect, useState } from "react";
import { Icon } from "~/components/Icons";
import { Card, Dialog } from "~/components/settings-ui";
import { Notice } from "~/components/ui";
import { db, stores, type FieldMode } from "~/db.server";
import { requireStore, requireViewer, type Viewer } from "~/lib/auth.server";
import { clientIp } from "~/lib/orders.server";
import { feePct, PLANS, rupeesLabel } from "~/lib/plans";
import { otpReady, messaging } from "~/lib/rto.server";
import { SMART_FEATURES, SMART_TERMS, SMART_TERMS_VERSION, resolveRules, resolveTipping } from "~/lib/smart-checkout";
import { storePath } from "~/lib/store-code";
import { resolveTheme } from "~/lib/theme";
import { accountFor } from "~/lib/subscription-billing.server";

const actor = (v: Viewer) => (v.role === "admin" ? v.staff?.name ?? "Growpefy team" : v.member?.name ?? v.name);

export async function loader({ request, params }: LoaderFunctionArgs) {
  const store = await requireStore(await requireViewer(request), params.id);
  const theme = resolveTheme(store.theme);
  const account = await accountFor(store.id);
  return json({
    storeId: store.id, name: store.name,
    billingPlan: account ? account.planId : null,
    smart: store.smartCheckout, activatedAt: store.smartActivatedAt?.toISOString() ?? null, consent: store.smartConsent ?? null,
    fields: resolveRules(store.checkoutRules, theme.showEmail),
    tipping: resolveTipping(store.tipping),
    otp: { on: store.otpEnabled, prepaid: store.otpPrepaid, cod: store.otpCod, timing: store.otpTiming === "start" ? "start" as const : "end" as const, ready: otpReady(await messaging()) },
  });
}

export async function action({ request, params }: ActionFunctionArgs) {
  const viewer = await requireViewer(request);
  const store = await requireStore(viewer, params.id);
  const fd = await request.formData();
  const intent = String(fd.get("intent") ?? "");
  const on = (k: string) => fd.get(k) === "on";

  if (intent === "activate") {
    if (!await accountFor(store.id)) return json({ ok: null, error: "Choose a monthly plan in Plan & billing before activating Smart Checkout.", intent }, { status: 400 });
    if (!on("agree")) return json({ ok: null, error: "Tick “I agree” to activate Smart Checkout.", intent }, { status: 400 });
    await db.update(stores).set({
      smartCheckout: true, smartActivatedAt: new Date(),
      smartConsent: { by: actor(viewer), at: new Date().toISOString(), ip: clientIp(request) ?? null, terms: SMART_TERMS_VERSION },
    }).where(eq(stores.id, store.id));
    return json({ ok: "Smart Checkout is active. Set up OTP, payment offers and Partial COD below.", error: null, intent });
  }
  if (intent === "deactivate") {
    await db.update(stores).set({
      smartCheckout: false,
      smartConsent: { ...(store.smartConsent ?? { by: "", at: "", terms: SMART_TERMS_VERSION }), deactivatedBy: actor(viewer), deactivatedAt: new Date().toISOString() },
    }).where(eq(stores.id, store.id));
    return json({ ok: "Smart Checkout is off. Your store now uses the standard checkout. Your settings are kept if you turn it on again.", error: null, intent });
  }
  if (intent === "fields") {
    const mode = (k: string): FieldMode => (["hidden", "optional", "required"].includes(String(fd.get(k))) ? String(fd.get(k)) as FieldMode : "optional");
    await db.update(stores).set({ checkoutRules: { email: mode("email"), landmark: mode("landmark") } }).where(eq(stores.id, store.id));
    return json({ ok: "Customer details saved. New checkouts use them right away.", error: null, intent });
  }
  if (intent === "otp") {
    if (!store.smartCheckout) return json({ ok: null, error: "OTP verification is part of Smart Checkout.", intent }, { status: 403 });
    const prepaid = on("otpPrepaid"), cod = on("otpCod");
    const enabled = on("otpOn") && (prepaid || cod);
    await db.update(stores).set({ otpEnabled: enabled, otpPrepaid: prepaid, otpCod: cod, otpTiming: fd.get("otpTiming") === "start" ? "start" : "end" }).where(eq(stores.id, store.id));
    return json({ ok: enabled ? "OTP verification is on." : "OTP verification is off.", error: null, intent });
  }
  if (intent === "tipping") {
    const presets = [0, 1, 2].map((i) => Math.round(Number(fd.get(`p${i}`)))).filter((n) => Number.isFinite(n) && n > 0 && n <= 50);
    if (on("on") && !presets.length) return json({ ok: null, error: "Add at least one tip percentage from 1 to 50.", intent }, { status: 400 });
    await db.update(stores).set({ tipping: { on: on("on"), presets: [...new Set(presets)].sort((a, b) => a - b), custom: on("custom"), label: String(fd.get("label") ?? "").trim().slice(0, 40) || "Add a tip" } }).where(eq(stores.id, store.id));
    return json({ ok: on("on") ? "Tipping is on at checkout." : "Tipping is off.", error: null, intent });
  }
  return json({ ok: null, error: "Unknown action", intent }, { status: 400 });
}

const when = (iso: string) => new Date(iso).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", year: "numeric" });

function Switch({ name, checked, onChange, label }: { name: string; checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="relative inline-flex shrink-0 cursor-pointer items-center">
      <input type="checkbox" name={name} checked={checked} onChange={(e) => onChange(e.target.checked)} className="peer sr-only" aria-label={label} />
      <span className="h-5 w-9 rounded-full bg-[#d4d4d4] transition peer-checked:bg-[#303030]" />
      <span className="absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white shadow transition peer-checked:translate-x-4" />
    </label>
  );
}

export default function CheckoutSettings() {
  const d = useLoaderData<typeof loader>();
  const a = useActionData<typeof action>();
  const [params, setParams] = useSearchParams();
  const nav = useNavigation();
  const busy = (i: string) => nav.state !== "idle" && nav.formData?.get("intent") === i;
  const [open, setOpen] = useState(params.get("activate") === "1" && !d.smart);
  useEffect(() => { if (a?.ok && a.intent === "activate") setOpen(false); }, [a]);
  const close = () => { setOpen(false); if (params.has("activate")) { const p = new URLSearchParams(params); p.delete("activate"); setParams(p, { replace: true, preventScrollReset: true }); } };
  const base = storePath(d.storeId);

  return (
    <div className="max-w-3xl space-y-4">
      {a?.ok && <Notice tone="success">{a.ok}</Notice>}
      {a?.error && a.intent !== "activate" && <Notice tone="error">{a.error}</Notice>}
      {!d.smart && !d.billingPlan && <Notice tone="warning">Choose a monthly plan before activating Smart Checkout. <Link className="ml-1 underline" to={`${storePath(d.storeId)}/wallet`}>Open Plan & billing</Link></Notice>}

      {/* Smart Checkout */}
      <section className={`panel overflow-hidden ${d.smart ? "" : "shadow-[0_0_0_1.5px_#303030]"}`} id="smart">
        <div className="flex flex-wrap items-start gap-3 px-4 py-4">
          <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${d.smart ? "bg-[#cdfee1] text-[#0c5132]" : "bg-[#303030] text-white"}`}><Icon name="zap" className="h-5 w-5" /></span>
          <div className="min-w-0 flex-1">
            <p className="flex flex-wrap items-center gap-2 text-[14px] font-semibold">Smart Checkout
              <span className={`rounded-md px-1.5 py-px text-[11.5px] font-medium ${d.smart ? "bg-[#cdfee1] text-[#0c5132]" : "bg-[#f1f1f1] text-ink-soft"}`}>{d.smart ? "Active" : "Not active"}</span>
            </p>
            <p className="mt-0.5 text-[12.5px] text-ink-soft">
              {d.smart
                ? <>OTP-verified COD, prepaid discounts, COD fees, Partial COD and offers by payment method are on for {d.name}.{d.activatedAt ? ` Active since ${when(d.activatedAt)}.` : ""}</>
                : "Turn your checkout into a COD-proof, higher-converting checkout: OTP for COD, prepaid discounts, COD fees, Partial COD and offers by payment method. Your store uses the standard checkout until you activate it."}
            </p>
          </div>
          {d.smart
            ? <Form method="post" onSubmit={(e) => { if (!confirm("Turn off Smart Checkout? OTP, payment discounts and fees, Partial COD and method-only offers stop on new checkouts.")) e.preventDefault(); }}>
                <button name="intent" value="deactivate" className="btn-secondary btn" disabled={busy("deactivate")}>Turn off</button>
              </Form>
            : <button type="button" className="btn-primary btn" onClick={() => setOpen(true)}>Activate</button>}
        </div>
        {d.smart && (
          <div className="grid gap-px border-t border-rule bg-rule sm:grid-cols-3">
            {[
              { to: `${base}/payment-rules`, title: "Payment offers & fees", text: "Prepaid discount, COD fee, Partial COD" },
              { to: `${base}/rto`, title: "RTO Suite", text: "COD rules, blocks and confirmations" },
              { to: `${base}/promotions`, title: "Discounts by method", text: "Coupons and gifts for COD or prepaid" },
            ].map((x) => (
              <Link key={x.to} to={x.to} className="flex items-center gap-2 bg-white px-4 py-2.5 hover:bg-[#fafafa]">
                <span className="min-w-0 flex-1"><span className="block text-[12.5px] font-medium">{x.title}</span><span className="block truncate text-[11.5px] text-ink-faint">{x.text}</span></span>
                <Icon name="chevron" className="h-3 w-3 -rotate-90 text-ink-faint" />
              </Link>
            ))}
          </div>
        )}
        {d.smart && d.consent?.auto && <p className="border-t border-rule px-4 py-2 text-[11.5px] text-ink-faint">Turned on automatically because this store already used these features.</p>}
      </section>

      <FieldsCard d={d} busy={busy("fields")} />
      <OtpCard d={d} busy={busy("otp")} />
      <TippingCard d={d} busy={busy("tipping")} />

      <Card title="Checkout design" description="Logo, colours, fonts, the order of sections and the button text."
        action={<Link to={`${base}/design`} className="btn-secondary btn shrink-0">Customize</Link>} />

      <Dialog open={open} onClose={close} title="Activate Smart Checkout" wide>
        <ActivateForm error={a?.intent === "activate" ? a.error : null} busy={busy("activate")} onCancel={close} />
      </Dialog>
    </div>
  );
}

function ActivateForm({ error, busy, onCancel }: { error: string | null; busy: boolean; onCancel: () => void }) {
  const [agree, setAgree] = useState(false);
  return (
    <Form method="post" className="space-y-5">
      <div>
        <p className="text-[13px] font-semibold">What you get</p>
        <ul className="mt-2 space-y-2">
          {SMART_FEATURES.map((f) => (
            <li key={f.title} className="flex gap-2.5">
              <Icon name="check" className="mt-0.5 h-4 w-4 shrink-0 text-[#0c5132]" strokeWidth={2.2} />
              <span className="text-[12.5px]"><b className="font-medium">{f.title}.</b> <span className="text-ink-soft">{f.text}</span></span>
            </li>
          ))}
        </ul>
      </div>

      <div>
        <p className="text-[13px] font-semibold">How it works</p>
        <ol className="mt-2 grid gap-2 sm:grid-cols-3">
          {["Activate here and agree to the terms.", "Choose OTP, prepaid discount, COD fee and Partial COD.", "Your plan fee and Smart Checkout transaction fees appear on your monthly invoice."].map((t, i) => (
            <li key={t} className="rounded-lg bg-[#f7f7f7] px-3 py-2.5 text-[12.5px]"><span className="num mb-1 flex h-5 w-5 items-center justify-center rounded-full bg-[#303030] text-[11px] font-semibold text-white">{i + 1}</span>{t}</li>
          ))}
        </ol>
      </div>

      <div>
        <p className="text-[13px] font-semibold">Fees</p>
        <div className="mt-2 overflow-hidden rounded-lg shadow-[0_0_0_1px_#ebebeb]">
          <table className="w-full text-[12.5px]">
            <thead><tr className="bg-[#f7f7f7] text-left text-ink-soft"><th className="px-3 py-1.5 font-medium">Plan</th><th className="px-3 py-1.5 font-medium">Monthly</th><th className="px-3 py-1.5 text-right font-medium">Smart Checkout fee</th></tr></thead>
            <tbody className="divide-y divide-rule">
              {PLANS.map((p) => (
                <tr key={p.id}><td className="px-3 py-2 font-medium">{p.name}</td><td className="num px-3 py-2">{rupeesLabel(p.monthlyRupees)}/month</td><td className="num px-3 py-2 text-right font-semibold">{feePct(p)}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-1.5 text-[11.5px] text-ink-faint">Example on the Starter plan: a ₹1,000 order costs ₹20 in Smart Checkout fee. GST applies on fees.</p>
      </div>

      <div>
        <p className="text-[13px] font-semibold">Terms and conditions</p>
        <ol className="mt-2 max-h-48 list-decimal space-y-1.5 overflow-y-auto rounded-lg bg-[#f7f7f7] py-2.5 pl-8 pr-3 text-[12px] text-ink-soft">
          {SMART_TERMS.map((t) => <li key={t}>{t}</li>)}
        </ol>
      </div>

      <label className="flex cursor-pointer items-start gap-2.5 rounded-lg px-3 py-2.5 shadow-[inset_0_0_0_1px_#c9c9c9]">
        <input type="checkbox" name="agree" checked={agree} onChange={(e) => setAgree(e.target.checked)} className="mt-0.5 h-4 w-4" />
        <span className="text-[12.5px]"><b className="font-medium">I agree</b> to the Smart Checkout terms and fees above, on behalf of my business.</span>
      </label>
      {error && <p className="error-text">{error}</p>}

      <div className="flex justify-end gap-2 border-t border-rule pt-3">
        <button type="button" onClick={onCancel} className="btn-secondary btn">Cancel</button>
        <button name="intent" value="activate" className="btn-primary btn" disabled={!agree || busy}>{busy ? "Activating" : "Activate Smart Checkout"}</button>
      </div>
    </Form>
  );
}

type D = ReturnType<typeof useLoaderData<typeof loader>>;

function ModeSelect({ name, value, label, hint }: { name: string; value: FieldMode; label: string; hint: string }) {
  return (
    <div className="flex flex-wrap items-center gap-3 py-2.5">
      <div className="min-w-0 flex-1"><p className="text-[13px] font-medium">{label}</p><p className="text-[12px] text-ink-soft">{hint}</p></div>
      <select name={name} defaultValue={value} className="input w-[150px]">
        <option value="hidden">Don't ask</option><option value="optional">Optional</option><option value="required">Required</option>
      </select>
    </div>
  );
}

function FieldsCard({ d, busy }: { d: D; busy: boolean }) {
  return (
    <Card title="Customer details" description="Mobile number, name and address are always asked. Choose what else the checkout asks for.">
      <Form method="post">
        <input type="hidden" name="intent" value="fields" />
        <div className="divide-y divide-rule">
          <div className="flex items-center gap-3 pb-2.5">
            <div className="min-w-0 flex-1"><p className="text-[13px] font-medium">Mobile number</p><p className="text-[12px] text-ink-soft">Used for delivery, order updates on WhatsApp and OTP.</p></div>
            <span className="w-[150px] rounded-lg bg-[#f7f7f7] px-2.5 py-1.5 text-[12.5px] text-ink-soft">Always required</span>
          </div>
          <ModeSelect name="email" value={d.fields.email} label="Email" hint="For order confirmation emails." />
          <ModeSelect name="landmark" value={d.fields.landmark} label="Area or landmark" hint="Second address line. Helps couriers find the address." />
        </div>
        <div className="mt-2 flex justify-end"><button className="btn-secondary btn" disabled={busy}>{busy ? "Saving" : "Save"}</button></div>
      </Form>
    </Card>
  );
}

function OtpCard({ d, busy }: { d: D; busy: boolean }) {
  const [on, setOn] = useState(d.otp.on);
  const [prepaid, setPrepaid] = useState(d.otp.prepaid);
  const [cod, setCod] = useState(d.otp.cod);
  if (!d.smart) {
    return (
      <Card title="OTP verification" description="Customers confirm their mobile number with a code before ordering."
        action={<Link to="?activate=1" className="flex shrink-0 items-center gap-1 text-[12.5px] font-medium text-[#005bd3] hover:underline"><Icon name="lock" className="h-3.5 w-3.5" />Smart Checkout</Link>} />
    );
  }
  return (
    <Card title="OTP verification" description="Customers confirm their mobile number with a code. Cuts fake numbers and prank COD orders."
      action={<span className={`shrink-0 rounded-md px-1.5 py-px text-[11.5px] font-medium ${d.otp.on ? "bg-[#cdfee1] text-[#0c5132]" : "bg-[#f1f1f1] text-ink-soft"}`}>{d.otp.on ? "On" : "Off"}</span>}>
      <Form method="post" className="space-y-3">
        <input type="hidden" name="intent" value="otp" />
        {!d.otp.ready && <p className="rounded-lg bg-[#fff1e3] px-3 py-2 text-[12.5px] text-[#5e4200]">OTP sending isn't set up for your account yet. Contact Growpefy support.</p>}
        <div className="flex items-center gap-3"><p className="flex-1 text-[13px] font-medium">Ask for an OTP at checkout</p><Switch name="otpOn" checked={on} onChange={setOn} label="OTP verification" /></div>
        {on && (
          <div className="grid gap-2 sm:grid-cols-3">
            <label className="flex items-center gap-2 rounded-lg px-3 py-2 text-[13px] shadow-[inset_0_0_0_1px_#ebebeb]"><input type="checkbox" name="otpCod" checked={cod} onChange={(e) => setCod(e.target.checked)} className="h-4 w-4" />COD orders</label>
            <label className="flex items-center gap-2 rounded-lg px-3 py-2 text-[13px] shadow-[inset_0_0_0_1px_#ebebeb]"><input type="checkbox" name="otpPrepaid" checked={prepaid} onChange={(e) => setPrepaid(e.target.checked)} className="h-4 w-4" />Prepaid orders</label>
            <select name="otpTiming" defaultValue={d.otp.timing} className="input"><option value="end">Before placing the order</option><option value="start">Right after the mobile number</option></select>
          </div>
        )}
        {!on && <><input type="hidden" name="otpCod" value={cod ? "on" : ""} /><input type="hidden" name="otpPrepaid" value={prepaid ? "on" : ""} /><input type="hidden" name="otpTiming" value={d.otp.timing} /></>}
        <p className="text-[12px] text-ink-faint">Each OTP is billed at the rate in Plan & billing. More COD rules are in <Link to={`${storePath(d.storeId)}/rto`} className="text-[#005bd3] hover:underline">RTO Suite</Link>.</p>
        <div className="flex justify-end"><button className="btn-secondary btn" disabled={busy}>{busy ? "Saving" : "Save"}</button></div>
      </Form>
    </Card>
  );
}

function TippingCard({ d, busy }: { d: D; busy: boolean }) {
  const [on, setOn] = useState(d.tipping.on);
  const p = d.tipping.presets;
  return (
    <Card title="Tipping" description="Let customers add a tip at checkout. Popular with restaurants, cafés, bakeries and delivery businesses. Tips go into the order total."
      action={<span className={`shrink-0 rounded-md px-1.5 py-px text-[11.5px] font-medium ${d.tipping.on ? "bg-[#cdfee1] text-[#0c5132]" : "bg-[#f1f1f1] text-ink-soft"}`}>{d.tipping.on ? "On" : "Off"}</span>}>
      <Form method="post" className="space-y-3">
        <input type="hidden" name="intent" value="tipping" />
        <div className="flex items-center gap-3"><p className="flex-1 text-[13px] font-medium">Show tipping options at checkout</p><Switch name="on" checked={on} onChange={setOn} label="Tipping" /></div>
        <div className={`space-y-3 ${on ? "" : "pointer-events-none opacity-50"}`}>
          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
            <label className="block"><span className="label block">Heading</span><input name="label" defaultValue={d.tipping.label} maxLength={40} className="input" placeholder="Add a tip" /></label>
            <div><span className="label block">Tip choices (% of items)</span>
              <div className="flex gap-2">{[0, 1, 2].map((i) => <input key={i} name={`p${i}`} defaultValue={p[i] ?? ""} inputMode="numeric" className="input num w-16 text-center" aria-label={`Tip choice ${i + 1}`} />)}</div>
            </div>
          </div>
          <label className="flex items-center gap-2 text-[13px]"><input type="checkbox" name="custom" defaultChecked={d.tipping.custom} className="h-4 w-4" />Let customers type their own amount</label>
        </div>
        <div className="flex justify-end"><button className="btn-secondary btn" disabled={busy}>{busy ? "Saving" : "Save"}</button></div>
      </Form>
    </Card>
  );
}
