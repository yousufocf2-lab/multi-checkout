import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { Form, useActionData, useLoaderData, useNavigation } from "@remix-run/react";
import { useEffect, useState } from "react";
import { Card, Dialog, Field, RowButton } from "~/components/settings-ui";
import { Icon } from "~/components/Icons";
import { INDIAN_STATES } from "~/lib/states";
import {
  addressLines, BUSINESS_TYPES, businessTypeLabel, cleanAffix, countryOf, COUNTRIES, CURRENCIES, currencyOf, GSTIN_RE, orderName, PAN_RE, TIMEZONES,
} from "~/lib/store-profile";
import type { BusinessProfile, EntityType } from "~/db.server";
import { env } from "~/lib/env.server";
import { and, asc, eq, ne } from "drizzle-orm";
import { StoreSettingsForm } from "~/components/StoreSettingsForm";
import { Notice, Section, SelectField, SubmitButton } from "~/components/ui";
import { db, stores, users } from "~/db.server";
import { kycGate, requireStore, requireViewer } from "~/lib/auth.server";
import { clearTokenCache } from "~/lib/platform.server";
import { parseStoreForm } from "~/lib/store-form.server";
import { storeForClient } from "~/lib/store-view.server";
import { forgetProxyCheck } from "~/lib/proxy-checkout.server";
import { profitStart, resetNativeOrders, syncNativeOrders } from "~/lib/native-orders.server";
import { forgetProfitCache } from "~/lib/profit.server";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const viewer = await requireViewer(request);
  const store = await requireStore(viewer, params.id);
  const owners = viewer.role === "admin" ? await db.select({ id: users.id, name: users.name, email: users.email }).from(users).orderBy(asc(users.name)) : null;
  // Admin-only fields (storeForClient leaves them out so they never reach the store owner)
  const profit = viewer.role === "admin" ? { dropship: store.dropshipEnabled, shareBps: store.profitShareBps, start: profitStart(store), startSet: Boolean(store.profitStartDate) } : null;
  const profile = {
    business: store.business ?? {}, contactEmail: store.contactEmail, supportPhone: store.supportPhone, name: store.name, logoUrl: store.logoUrl,
    country: store.country, currency: store.currency, timezone: store.timezone, unitSystem: store.unitSystem, weightUnit: store.weightUnit,
    orderPrefix: store.orderPrefix, orderSuffix: store.orderSuffix, orderStart: store.orderStart, orderSeq: store.orderSeq,
    ownOrders: store.platform === "growpefy" || store.storefrontEnabled, platform: store.platform,
    address: store.storefrontDomain && store.storefrontDomainStatus === "live" ? store.storefrontDomain : `${new URL(env.appUrl).host}/s/${store.slug}`,
  };
  return json({ store: storeForClient(store), owners, isAdmin: viewer.role === "admin", profit, profile });
}

export async function action({ request, params }: ActionFunctionArgs) {
  const viewer = await requireViewer(request);
  const store = await requireStore(viewer, params.id);
  const fd = await request.formData();
  const intent = fd.get("intent");

  const str = (k: string, max = 120) => String(fd.get(k) ?? "").trim().slice(0, max);
  if (intent === "business") {
    const errors: Record<string, string> = {};
    const type = str("type") as EntityType;
    if (!BUSINESS_TYPES.some((b) => b.id === type)) errors.type = "Choose your business type.";
    const country = COUNTRIES.some((c) => c.code === str("bCountry")) ? str("bCountry") : "IN";
    const gstin = str("gstin", 20).toUpperCase().replace(/\s/g, "");
    const pan = str("pan", 12).toUpperCase().replace(/\s/g, "");
    if (gstin && !GSTIN_RE.test(gstin)) errors.gstin = "Enter a valid 15-character GSTIN, like 09ABCDE1234F1Z5.";
    if (pan && !PAN_RE.test(pan)) errors.pan = "Enter a valid PAN, like ABCDE1234F.";
    const pincode = str("pincode", 12);
    if (country === "IN" && pincode && !/^\d{6}$/.test(pincode)) errors.pincode = "PIN code has 6 digits.";
    const legalName = str("legalName");
    if (!legalName) errors.legalName = type === "individual" ? "Enter your full name." : "Enter the registered business name.";
    if (Object.keys(errors).length) return json({ ok: null, errors, intent }, { status: 400 });
    const business: BusinessProfile = {
      type, legalName, gstin: gstin || undefined, pan: pan || undefined, phone: str("bPhone", 20) || undefined, email: str("bEmail") || undefined,
      address: { line1: str("line1", 160), line2: str("line2", 160), city: str("city", 80), state: str("state", 80), pincode, country },
    };
    await db.update(stores).set({ business }).where(eq(stores.id, store.id));
    return json({ ok: "Business details saved", errors: null, intent });
  }
  if (intent === "contact") {
    const name = str("name", 80);
    const email = str("contactEmail");
    const errors: Record<string, string> = {};
    if (!name) errors.name = "Enter your store name.";
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.contactEmail = "Enter a valid email.";
    if (Object.keys(errors).length) return json({ ok: null, errors, intent }, { status: 400 });
    await db.update(stores).set({ name, contactEmail: email || null, supportPhone: str("supportPhone", 20) || null }).where(eq(stores.id, store.id));
    return json({ ok: "Store contact saved", errors: null, intent });
  }
  if (intent === "defaults") {
    const country = COUNTRIES.find((c) => c.code === str("country"));
    const currency = CURRENCIES.find((c) => c.code === str("currency"));
    const tz = TIMEZONES.includes(str("timezone")) ? str("timezone") : store.timezone;
    if (!country || !currency) return json({ ok: null, errors: { defaults: "Choose a country and a currency." }, intent }, { status: 400 });
    const unitSystem = str("unitSystem") === "imperial" ? "imperial" as const : "metric" as const;
    const w = str("weightUnit");
    const weightUnit = (["kg", "g", "lb", "oz"] as const).find((x) => x === w) ?? (unitSystem === "imperial" ? "lb" : "kg");
    await db.update(stores).set({ country: country.code, currency: currency.code, timezone: tz, unitSystem, weightUnit }).where(eq(stores.id, store.id));
    return json({ ok: "Store defaults saved", errors: null, intent });
  }
  if (intent === "orderId") {
    const start = Math.floor(Number(fd.get("orderStart")));
    if (!Number.isFinite(start) || start < 1 || start > 999_999_999) return json({ ok: null, errors: { orderStart: "Use a number from 1 to 999999999." }, intent }, { status: 400 });
    await db.update(stores).set({ orderPrefix: cleanAffix(str("orderPrefix", 20)), orderSuffix: cleanAffix(str("orderSuffix", 20)), orderStart: start }).where(eq(stores.id, store.id));
    return json({ ok: "Order ID format saved", errors: null, intent });
  }

  if (intent === "assignOwner" && viewer.role === "admin") {
    const id = Number(fd.get("ownerId")) || null;
    await db.update(stores).set({ ownerId: id }).where(eq(stores.id, store.id));
    return json({ ok: "Owner updated", errors: null });
  }
  if (intent === "profitDashboard" && viewer.role !== "admin") {
    throw new Response("Forbidden", { status: 403 });
  }
  if (intent === "profitDashboard") {
    const enabled = fd.get("profitEnabled") === "on";
    const pct = Number(fd.get("profitSharePct"));
    if (!Number.isFinite(pct) || pct < 0 || pct > 100) {
      return json({ ok: null, errors: { profitSharePct: "Enter a share from 0 to 100 percent." } }, { status: 400 });
    }
    const today = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
    const rawStart = String(fd.get("profitStartDate") ?? "").trim();
    if (rawStart && (!/^\d{4}-\d{2}-\d{2}$/.test(rawStart) || rawStart > today || new Date(`${rawStart}T00:00:00Z`).toISOString().slice(0, 10) !== rawStart)) {
      return json({ ok: null, errors: { profitStartDate: "Choose a real date, today or earlier." } }, { status: 400 });
    }
    const startDate = rawStart || store.profitStartDate || today;
    const startChanged = startDate !== profitStart(store);
    const [updated] = await db.update(stores).set({
      profitEnabled: enabled,
      profitShareBps: Math.round(pct * 100),
      profitEnabledAt: enabled ? (store.profitEnabledAt ?? new Date()) : store.profitEnabledAt,
      profitStartDate: startDate,
      ...(startChanged ? { profitSettledFrom: null } : {}),
    }).where(eq(stores.id, store.id)).returning();
    forgetProfitCache(store.id);
    // New start date: copy the store's Shopify-checkout orders again from that date (in the background)
    if (startChanged || (enabled && !store.profitEnabled)) await resetNativeOrders(store.id);
    if (updated?.profitEnabled) void syncNativeOrders(updated, { force: true }).catch(() => {});
    return json({ ok: enabled ? "Sales and profit dashboard enabled for this store." : "Sales and profit dashboard disabled for this store.", errors: null });
  }
  if (intent === "deleteStore") {
    if (String(fd.get("confirm") ?? "").trim() !== store.slug) return json({ ok: null, errors: { confirm: `Type ${store.slug} to confirm` } }, { status: 400 });
    await db.delete(stores).where(eq(stores.id, store.id));
    return redirect("/dashboard/stores");
  }

  const { data, errors } = parseStoreForm(fd, store);
  // New payment gateway keys need KYC first
  {
    const before = new Set((store.gateways ?? []).map((g) => g.id));
    const g = data.gateways.some((x) => !before.has(x.id)) ? kycGate(viewer, "adding a payment gateway") : null;
    if (g) errors.form = g;
  }
  if (!errors.slug) {
    const [d] = await db.select({ id: stores.id }).from(stores).where(and(eq(stores.slug, data.slug), ne(stores.id, store.id))).limit(1);
    if (d) errors.slug = "This store ID is taken. Try another.";
  }
  if (data.checkoutDomain && !errors.checkoutDomain) {
    const [d] = await db.select({ id: stores.id }).from(stores).where(and(eq(stores.checkoutDomain, data.checkoutDomain), ne(stores.id, store.id))).limit(1);
    if (d) errors.checkoutDomain = "This domain is already used by another store";
  }
  if (Object.keys(errors).length) return json({ ok: null, errors }, { status: 400 });
  await db.update(stores).set(data).where(eq(stores.id, store.id));
  clearTokenCache(store.id);
  forgetProxyCheck(store.id); // a new Client secret or the toggle: check the App Proxy again
  return json({ ok: "Settings saved", errors: null });
}

export default function StoreSettings() {
  const { store, owners, isAdmin, profit, profile } = useLoaderData<typeof loader>();
  const res = useActionData<typeof action>();
  const errors = (res?.errors ?? {}) as Record<string, string>;
  const resIntent = (res as { intent?: string } | undefined)?.intent;
  const profileIntent = resIntent && ["business", "contact", "defaults", "orderId"].includes(resIntent);
  return (
    <div className="max-w-3xl space-y-4">
      {res?.ok && <Notice tone="success">{res.ok}</Notice>}
      {errors.form && <Notice tone="error">{errors.form} <a href="/onboarding" className="font-semibold underline">Complete KYC</a></Notice>}
      {Object.keys(errors).length > 0 && !errors.confirm && !errors.form && !profileIntent && <Notice tone="error">Fix the highlighted fields and save again.</Notice>}

      <ProfileCards p={profile} errors={profileIntent ? errors : {}} openWith={profileIntent && !res?.ok ? resIntent : null} okIntent={res?.ok ? resIntent ?? null : null} />

      <div className="pt-4">
        <h2 className="text-[13.5px] font-semibold">Connections</h2>
        <p className="text-[12.5px] text-ink-soft">Store platform, payment gateways and ad accounts.</p>
      </div>
      <StoreSettingsForm key={JSON.stringify(store)} values={store} errors={profileIntent ? {} : errors} submitLabel="Save settings" isAdmin={isAdmin} />

      {owners && (
        <Section title="Store owner" description="The owner can log in and manage this store.">
          <Form method="post" className="flex flex-wrap items-end gap-3">
            <SelectField label="Owner" name="ownerId" defaultValue={store.ownerId ?? ""} wrap="min-w-[240px] flex-1">
              <option value="">No owner (admin only)</option>
              {owners.map((o) => <option key={o.id} value={o.id}>{o.name} ({o.email})</option>)}
            </SelectField>
            <SubmitButton intent="assignOwner" className="btn-secondary" busyText="Saving">Save owner</SubmitButton>
          </Form>
        </Section>
      )}

      {isAdmin && profit && (
        <Section title="Sales and profit dashboard" description="Off by default. When enabled, the store owner can see the available checkout orders, revenue, PayU settlements, ad costs and profit share.">
          <Form method="post" className="space-y-4">
            <label className="flex cursor-pointer items-start gap-2 text-sm">
              <input type="checkbox" name="profitEnabled" defaultChecked={store.profitEnabled} className="mt-0.5 h-4 w-4" />
              <span><b>Enable dashboard for this store</b><span className="block text-xs text-ink-faint">When off, the store owner only sees the regular Growpefy checkout dashboard and its orders.</span></span>
            </label>
            <label className="block max-w-xs">
              <span className="label">Partnership start date</span>
              <input name="profitStartDate" type="date" max={new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10)} defaultValue={profit.start} className="input" />
              <span className="mt-1 block text-xs text-ink-faint">Can be in the past. Profit, PayU settlements and orders from the store's own Shopify checkout count from this date (Shopify gives the last 60 days of its orders).</span>
              {errors.profitStartDate && <span className="error-text">{errors.profitStartDate}</span>}
            </label>
            <label className="block max-w-xs"><span className="label">Growpefy profit share (%)</span><input name="profitSharePct" type="number" min="0" max="100" step="0.01" className="input" defaultValue={(profit.shareBps / 100).toFixed(2)} />
              <span className="mt-1 block text-xs text-ink-faint">Growpefy's share of the net profit after every cost{profit.dropship ? " (ads, dropship product, shipping, packing, RTO)" : ""}. Same setting as on the Dropshipping page.</span>
              {errors.profitSharePct && <span className="error-text">{errors.profitSharePct}</span>}</label>
            <SubmitButton intent="profitDashboard" className="btn-primary" busyText="Saving">Save dashboard access</SubmitButton>
          </Form>
        </Section>
      )}

      <Section title="Delete store" description="Removes the store, its coupons, discounts and order history from this checkout. Orders already in Shopify stay there.">
        <Form method="post" className="flex flex-wrap items-end gap-3" onSubmit={(e) => { if (!window.confirm(`Delete ${store.name}? This can't be undone.`)) e.preventDefault(); }}>
          <label className="block min-w-[240px] flex-1">
            <span className="label">Type <b className="text-ink">{store.slug}</b> to confirm</span>
            <input name="confirm" className="input" autoComplete="off" />
            {errors.confirm && <span className="error-text">{errors.confirm}</span>}
          </label>
          <SubmitButton intent="deleteStore" className="btn border border-red-200 bg-white text-bad hover:bg-red-50" busyText="Deleting">Delete store</SubmitButton>
        </Form>
      </Section>
    </div>
  );
}

type Profile = ReturnType<typeof useLoaderData<typeof loader>>["profile"];

function ProfileCards({ p, errors, openWith, okIntent }: { p: Profile; errors: Record<string, string>; openWith: string | null | undefined; okIntent: string | null }) {
  const [dialog, setDialog] = useState<"business" | "contact" | null>(openWith === "business" || openWith === "contact" ? openWith : null);
  const nav = useNavigation();
  const busy = (i: string) => nav.state !== "idle" && nav.formData?.get("intent") === i;
  useEffect(() => { if (okIntent) setDialog(null); }, [okIntent]);
  useEffect(() => { if (openWith === "business" || openWith === "contact") setDialog(openWith); }, [openWith]);
  const b = p.business as BusinessProfile;
  const c = countryOf(p.country);
  const lines = addressLines(b.address);

  return (
    <>
      {/* Identity */}
      <section className="panel flex items-center gap-3 px-4 py-3.5">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-[#f1f1f1] text-[15px] font-semibold text-ink-soft shadow-[inset_0_0_0_1px_rgba(0,0,0,.06)]">
          {p.logoUrl ? <img src={p.logoUrl} alt="" className="h-full w-full object-contain" /> : p.name.slice(0, 1).toUpperCase()}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[15px] font-semibold tracking-tight">{p.name}</p>
          <p className="truncate text-[12.5px] text-ink-soft">{p.address}</p>
        </div>
        <span className="hidden items-center gap-1.5 rounded-lg bg-[#f1f1f1] px-2 py-1 text-[12px] text-ink-soft sm:inline-flex">{c.flag} {c.name} · {currencyOf(p.currency).code}</span>
      </section>

      <Card title="Business details" description="The legal business behind this store. Used on invoices, tax reports and payouts.">
        <RowButton icon={<span>{countryOf(b.address?.country ?? p.country).flag}</span>} onClick={() => setDialog("business")}
          title={b.legalName || "Add business details"}
          detail={b.legalName ? [businessTypeLabel(b.type), b.gstin ? `GSTIN ${b.gstin}` : "No GSTIN added"].filter(Boolean).join(" · ") : "Business type, legal name, GSTIN and registered address"} />
      </Card>

      <Card title="Store contact" description="How customers and Growpefy reach you. Shown on order emails and invoices.">
        <div className="space-y-2">
          <RowButton icon={<Icon name="stores" className="h-4 w-4" />} onClick={() => setDialog("contact")} title={p.name}
            detail={[p.contactEmail ?? "No email added", p.supportPhone].filter(Boolean).join(" · ")} />
          <RowButton icon={<Icon name="route" className="h-4 w-4" />} onClick={() => setDialog("business")} title="Store address"
            detail={lines.length ? lines.join(", ") : "Add the address customers see on invoices"} />
        </div>
      </Card>

      <DefaultsCard p={p} busy={busy("defaults")} error={errors.defaults} />
      <OrderIdCard p={p} busy={busy("orderId")} error={errors.orderStart} />

      <Dialog open={dialog === "business"} onClose={() => setDialog(null)} title="Business details" wide
        footer={<><button type="button" className="btn-secondary btn" onClick={() => setDialog(null)}>Cancel</button><button form="gp-biz" name="intent" value="business" className="btn-primary btn" disabled={busy("business")}>{busy("business") ? "Saving" : "Save"}</button></>}>
        <BusinessForm b={b} fallbackCountry={p.country} errors={errors} />
      </Dialog>

      <Dialog open={dialog === "contact"} onClose={() => setDialog(null)} title="Store contact"
        footer={<><button type="button" className="btn-secondary btn" onClick={() => setDialog(null)}>Cancel</button><button form="gp-contact" name="intent" value="contact" className="btn-primary btn" disabled={busy("contact")}>{busy("contact") ? "Saving" : "Save"}</button></>}>
        <Form method="post" id="gp-contact" className="space-y-3">
          <Field label="Store name" error={errors.name}><input name="name" defaultValue={p.name} className="input" placeholder="Your brand" required /></Field>
          <Field label="Store email" hint="Order updates to customers come from your store name; replies go to this email." error={errors.contactEmail}>
            <input name="contactEmail" type="email" defaultValue={p.contactEmail ?? ""} className="input" placeholder="hello@yourbrand.com" />
          </Field>
          <Field label="Store phone" hint="Shown at checkout for help."><input name="supportPhone" defaultValue={p.supportPhone ?? ""} className="input" placeholder="+91 98765 43210" /></Field>
        </Form>
      </Dialog>
    </>
  );
}

function BusinessForm({ b, fallbackCountry, errors }: { b: BusinessProfile; fallbackCountry: string; errors: Record<string, string> }) {
  const [country, setCountry] = useState(b.address?.country ?? fallbackCountry ?? "IN");
  const [type, setType] = useState<string>(b.type ?? "");
  const india = country === "IN";
  const individual = type === "individual";
  return (
    <Form method="post" id="gp-biz" className="space-y-4">
      <div>
        <p className="mb-2 text-[12.5px] font-semibold">About your business</p>
        <div className="grid gap-3 sm:grid-cols-[150px_minmax(0,1fr)]">
          <Field label="Country"><select name="bCountry" value={country} onChange={(e) => setCountry(e.target.value)} className="input">
            {COUNTRIES.map((c) => <option key={c.code} value={c.code}>{c.flag} {c.name}</option>)}
          </select></Field>
          <Field label="Business type" error={errors.type}><select name="type" value={type} onChange={(e) => setType(e.target.value)} className="input">
            <option value="" disabled>Select business type</option>
            {(["Individual", "Company", "Other"] as const).map((g) => (
              <optgroup key={g} label={g}>{BUSINESS_TYPES.filter((x) => x.group === g).map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}</optgroup>
            ))}
          </select></Field>
        </div>
        <Field className="mt-3" label={individual ? "Full name" : "Registered business name"} hint={individual ? undefined : "Exactly as on your registration or GST certificate."} error={errors.legalName}>
          <input name="legalName" defaultValue={b.legalName ?? ""} className="input" placeholder={individual ? "Your full name" : "Your brand Pvt. Ltd."} />
        </Field>
        {india && (
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <Field label="GSTIN (optional)" error={errors.gstin}><input name="gstin" defaultValue={b.gstin ?? ""} className="input uppercase" placeholder="09ABCDE1234F1Z5" maxLength={15} /></Field>
            <Field label="PAN (optional)" error={errors.pan}><input name="pan" defaultValue={b.pan ?? ""} className="input uppercase" placeholder="ABCDE1234F" maxLength={10} /></Field>
          </div>
        )}
      </div>
      <div className="border-t border-rule pt-4">
        <p className="mb-2 text-[12.5px] font-semibold">Registered address</p>
        <div className="space-y-3">
          <Field label="Address"><input name="line1" defaultValue={b.address?.line1 ?? ""} className="input" placeholder="House, building, street" /></Field>
          <Field label="Apartment, suite, landmark (optional)"><input name="line2" defaultValue={b.address?.line2 ?? ""} className="input" /></Field>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="City"><input name="city" defaultValue={b.address?.city ?? ""} className="input" /></Field>
            <Field label="State">
              {india ? (
                <select name="state" defaultValue={b.address?.state ?? ""} className="input"><option value="">Select a state</option>{INDIAN_STATES.map((s) => <option key={s.code} value={s.name}>{s.name}</option>)}</select>
              ) : <input name="state" defaultValue={b.address?.state ?? ""} className="input" />}
            </Field>
            <Field label={india ? "PIN code" : "Postal code"} error={errors.pincode}><input name="pincode" defaultValue={b.address?.pincode ?? ""} className="input" inputMode={india ? "numeric" : undefined} /></Field>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Business phone"><input name="bPhone" defaultValue={b.phone ?? ""} className="input" placeholder={`${countryOf(country).dial} `} /></Field>
            <Field label="Business email"><input name="bEmail" type="email" defaultValue={b.email ?? ""} className="input" placeholder="accounts@yourbrand.com" /></Field>
          </div>
        </div>
      </div>
    </Form>
  );
}

function DefaultsCard({ p, busy, error }: { p: Profile; busy: boolean; error?: string }) {
  const [country, setCountry] = useState(p.country);
  const [currency, setCurrency] = useState(p.currency);
  const [tz, setTz] = useState(p.timezone);
  const [units, setUnits] = useState(p.unitSystem);
  const changed = country !== p.country || currency !== p.currency || tz !== p.timezone || units !== p.unitSystem;
  const pickCountry = (code: string) => {
    const c = countryOf(code);
    setCountry(code); setCurrency(c.currency); setTz(c.timezone); setUnits(c.imperial ? "imperial" : "metric");
  };
  return (
    <Card title="Store defaults" description="Country, currency and units used across your store, checkout and reports.">
      <Form method="post" className="space-y-3">
        <input type="hidden" name="intent" value="defaults" />
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Country / region"><select name="country" value={country} onChange={(e) => pickCountry(e.target.value)} className="input">
            {COUNTRIES.map((c) => <option key={c.code} value={c.code}>{c.flag} {c.name}</option>)}
          </select></Field>
          <Field label="Store currency" hint={currency !== "INR" ? "Payment gateways must support this currency to take payments." : undefined}>
            <select name="currency" value={currency} onChange={(e) => setCurrency(e.target.value)} className="input">
              {CURRENCIES.map((c) => <option key={c.code} value={c.code}>{c.name} ({c.code} {c.symbol})</option>)}
            </select>
          </Field>
          <Field label="Time zone" hint="Reports, order dates and day boundaries follow this."><select name="timezone" value={tz} onChange={(e) => setTz(e.target.value)} className="input">
            {TIMEZONES.map((t) => <option key={t} value={t}>{t.replace(/_/g, " ")}</option>)}
          </select></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Unit system"><select name="unitSystem" value={units} onChange={(e) => setUnits(e.target.value as typeof units)} className="input">
              <option value="metric">Metric</option><option value="imperial">Imperial</option>
            </select></Field>
            <Field label="Weight unit"><select name="weightUnit" key={units} defaultValue={units === p.unitSystem ? p.weightUnit : units === "imperial" ? "lb" : "kg"} className="input">
              {(units === "imperial" ? ["lb", "oz"] : ["kg", "g"]).map((w) => <option key={w} value={w}>{w}</option>)}
            </select></Field>
          </div>
        </div>
        {error && <p className="error-text">{error}</p>}
        <div className="flex justify-end"><button className="btn-secondary btn" disabled={busy}>{busy ? "Saving" : changed ? "Save changes" : "Save"}</button></div>
      </Form>
    </Card>
  );
}

function OrderIdCard({ p, busy, error }: { p: Profile; busy: boolean; error?: string }) {
  const [prefix, setPrefix] = useState(p.orderPrefix);
  const [suffix, setSuffix] = useState(p.orderSuffix);
  const [start, setStart] = useState(String(p.orderStart));
  const clean = (v: string) => v.replace(/[^A-Za-z0-9\-_/]/g, "").slice(0, 12);
  const startN = Math.max(1, Math.floor(Number(start)) || 1001);
  const next = Math.max((p.orderSeq ?? startN - 1) + 1, startN);
  return (
    <Card title="Order ID" description="Add a prefix or suffix to your order numbers, like #YB1001 or #1001-IN. Leave both empty for plain numbers."
      action={<span className="num shrink-0 rounded-lg bg-[#f1f1f1] px-2 py-1 text-[12.5px] font-semibold">{orderName(prefix, next, suffix)}</span>}>
      {p.ownOrders ? (
        <Form method="post" className="space-y-3">
          <input type="hidden" name="intent" value="orderId" />
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Prefix"><input name="orderPrefix" value={prefix} onChange={(e) => setPrefix(clean(e.target.value))} className="input" placeholder="e.g. YB" /></Field>
            <Field label="Suffix"><input name="orderSuffix" value={suffix} onChange={(e) => setSuffix(clean(e.target.value))} className="input" placeholder="e.g. -IN" /></Field>
            <Field label="First order number" error={error} hint={p.orderSeq ? `Last order was ${orderName(p.orderPrefix, p.orderSeq, p.orderSuffix)}. Numbers never go back.` : "Starts at 1001 unless you change it."}>
              <input name="orderStart" value={start} onChange={(e) => setStart(e.target.value.replace(/\D/g, "").slice(0, 9))} className="input num" inputMode="numeric" />
            </Field>
          </div>
          <div className="flex items-center justify-between gap-3">
            <p className="text-[12px] text-ink-faint">Your next order will be <b className="num text-ink">{orderName(prefix, next, suffix)}</b>. Letters, numbers, - _ and / only.</p>
            <button className="btn-secondary btn shrink-0" disabled={busy}>{busy ? "Saving" : "Save"}</button>
          </div>
        </Form>
      ) : (
        <p className="text-[12.5px] text-ink-soft">Orders for this store are numbered by {p.platform === "woocommerce" ? "WooCommerce" : "Shopify"}. Change the prefix and suffix there; Growpefy shows the same numbers.</p>
      )}
    </Card>
  );
}
