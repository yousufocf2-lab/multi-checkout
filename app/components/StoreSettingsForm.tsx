import { Form } from "@remix-run/react";
import { useState } from "react";
import { Section, SelectField, SubmitButton, TextField, Toggle } from "./ui";

export type StoreFormValues = {
  name?: string; slug?: string; shopDomain?: string; storefrontUrl?: string; checkoutDomain?: string | null; active?: boolean;
  clientId?: string | null; apiVersion?: string; hasAdminToken?: boolean; hasClientSecret?: boolean;
  payuKey?: string | null; payuMode?: string; hasPayuSalt?: boolean;
  codEnabled?: boolean; codCooldownHours?: number; codBlockAfterPrepaid?: boolean;
  metaAdAccountId?: string | null; metaPixelId?: string | null; metaApiVersion?: string; metaFireCodPurchase?: boolean;
  hasMetaToken?: boolean; hasCapiToken?: boolean;
  logoUrl?: string | null; primaryColor?: string; supportPhone?: string | null;
};

function splitHours(h: number) {
  if (h >= 730 && h % 730 === 0) return { value: h / 730, unit: "months" };
  if (h >= 24 && h % 24 === 0) return { value: h / 24, unit: "days" };
  return { value: h, unit: "hours" };
}

const saved = (yes?: boolean) => (yes ? "Saved. Leave blank to keep it." : undefined);

export function StoreSettingsForm({ values = {}, errors = {}, submitLabel, isNew }: {
  values?: StoreFormValues; errors?: Record<string, string>; submitLabel: string; isNew?: boolean;
}) {
  const v = values;
  const cd = splitHours(v.codCooldownHours ?? 6);
  const [codOn, setCodOn] = useState(v.codEnabled ?? true);
  const [color, setColor] = useState(v.primaryColor ?? "#0B5D4B");

  return (
    <Form method="post" className="space-y-5" noValidate>

      <Section title="Store details" description="How this store is identified on your checkout.">
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField label="Store name" name="name" defaultValue={v.name} error={errors.name} placeholder="Budverse" required />
          <TextField label="Store ID" name="slug" defaultValue={v.slug} error={errors.slug} placeholder="budverse" hint="Lowercase letters, numbers and dashes. Used in the theme script." required />
          <TextField label="Shopify domain" name="shopDomain" defaultValue={v.shopDomain} error={errors.shopDomain} placeholder="budverse.myshopify.com" hint="Settings → Domains in Shopify admin" required />
          <TextField label="Store website" name="storefrontUrl" defaultValue={v.storefrontUrl} error={errors.storefrontUrl} placeholder="https://budverse.in" required />
          <TextField label="Checkout domain" name="checkoutDomain" defaultValue={v.checkoutDomain ?? ""} error={errors.checkoutDomain} placeholder="checkout.budverse.in" wrap="sm:col-span-2"
            hint="Recommended. Customers and PayU see your own domain instead of the platform URL." />
        </div>
        {!isNew && <div className="mt-4 border-t border-rule pt-4"><Toggle name="active" label="Checkout is live" description="When off, the theme script stops opening this checkout." defaultChecked={v.active ?? true} /></div>}
        {isNew && <input type="hidden" name="active" value="on" />}
      </Section>

      <Section title="Shopify app" description="Create an app in the Shopify Dev Dashboard, then paste its credentials here. You'll connect it in the next step.">
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField label="Client ID" name="clientId" defaultValue={v.clientId ?? ""} error={errors.clientId} autoComplete="off" />
          <TextField label="Client secret" name="clientSecret" type="password" autoComplete="new-password" hint={saved(v.hasClientSecret)} />
          <TextField label="Admin API token (optional)" name="adminToken" type="password" autoComplete="new-password" placeholder="shpat_…"
            hint={v.hasAdminToken ? "Connected. Leave blank to keep it." : "Only for older custom apps. Most stores use Connect with Shopify."} />
          <TextField label="API version" name="apiVersion" defaultValue={v.apiVersion ?? "2025-07"} />
        </div>
        {v.hasAdminToken && <div className="mt-4 border-t border-rule pt-4"><Toggle name="clearAdminToken" label="Disconnect Shopify" description="Removes the saved access token on save." /></div>}
      </Section>

      <Section title="Online payments" description="Your PayU merchant account. Payments go straight to you.">
        <div className="grid gap-4 sm:grid-cols-3">
          <TextField label="PayU merchant key" name="payuKey" defaultValue={v.payuKey ?? ""} autoComplete="off" />
          <TextField label="PayU salt" name="payuSalt" type="password" autoComplete="new-password" hint={saved(v.hasPayuSalt)} />
          <SelectField label="Mode" name="payuMode" defaultValue={v.payuMode ?? "test"}>
            <option value="test">Test (no real money)</option>
            <option value="live">Live</option>
          </SelectField>
        </div>
      </Section>

      <Section title="Cash on Delivery" description="Prepaid checkout is always available. These rules only limit COD.">
        <div className="space-y-4">
          <label className="flex items-start justify-between gap-4">
            <span><span className="block text-sm font-medium">Offer Cash on Delivery</span><span className="block text-xs text-ink-faint">Customers can choose to pay when the order arrives.</span></span>
            <input type="checkbox" name="codEnabled" checked={codOn} onChange={(e) => setCodOn(e.target.checked)} className="peer sr-only" />
            <span aria-hidden className={`relative mt-0.5 h-6 w-10 shrink-0 cursor-pointer rounded-full transition peer-focus-visible:ring-2 peer-focus-visible:ring-brand ${codOn ? "bg-brand" : "bg-rule-strong"}`}>
              <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${codOn ? "left-[18px]" : "left-0.5"}`} />
            </span>
          </label>
          <fieldset disabled={!codOn} className="space-y-4 border-t border-rule pt-4 disabled:opacity-50">
            <div>
              <span className="label">Wait time between COD orders</span>
              <div className="flex max-w-sm gap-2">
                <input type="number" name="codCooldownValue" min={1} defaultValue={cd.value} className="input w-28" aria-label="Wait time" />
                <select name="codCooldownUnit" defaultValue={cd.unit} className="input" aria-label="Unit">
                  <option value="hours">hours</option>
                  <option value="days">days</option>
                  <option value="months">months</option>
                </select>
              </div>
              {errors.codCooldown ? <span className="error-text">{errors.codCooldown}</span>
                : <span className="hint">After a COD order, the same phone number can't order on COD again for this long. Default 6 hours, up to 1 year (12 months).</span>}
            </div>
            <Toggle name="codBlockAfterPrepaid" label="Turn off COD for customers who have paid online" description="Once a phone number completes a prepaid order, it can only pay online from then on." defaultChecked={v.codBlockAfterPrepaid ?? true} />
          </fieldset>
        </div>
      </Section>

      <Section id="meta" title="Meta ads" description="Shows ad spend, ROAS and cost per order on your dashboard, and sends purchases to your pixel.">
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField label="Ad account ID" name="metaAdAccountId" defaultValue={v.metaAdAccountId ?? ""} placeholder="Digits after act_" />
          <TextField label="System user access token" name="metaAccessToken" type="password" autoComplete="new-password" placeholder="EAA…" hint={v.hasMetaToken ? "Saved. Leave blank to keep it." : "Needs ads_read, ads_management and business_management."} />
          <TextField label="Pixel ID" name="metaPixelId" defaultValue={v.metaPixelId ?? ""} />
          <TextField label="Conversions API token (optional)" name="metaCapiToken" type="password" autoComplete="new-password" hint={v.hasCapiToken ? "Saved. Leave blank to keep it." : "Leave blank to use the token above."} />
          <TextField label="Graph API version" name="metaApiVersion" defaultValue={v.metaApiVersion ?? "v23.0"} />
        </div>
        <div className="mt-4 space-y-3 border-t border-rule pt-4">
          <Toggle name="metaFireCodPurchase" label="Count COD orders as purchases" description="Sends a Purchase event when a COD order is placed, not only when paid online." defaultChecked={v.metaFireCodPurchase ?? true} />
          {v.hasMetaToken && <Toggle name="clearMetaToken" label="Remove saved Meta token" />}
        </div>
      </Section>

      <Section title="Branding" description="Your checkout uses these so it looks like your store.">
        <div className="grid gap-4 sm:grid-cols-3">
          <TextField label="Logo URL" name="logoUrl" defaultValue={v.logoUrl ?? ""} placeholder="https://cdn.shopify.com/…/logo.png" wrap="sm:col-span-3" hint="Shopify admin → Content → Files → copy link" />
          <div>
            <span className="label">Brand color</span>
            <div className="flex items-center gap-2">
              <input type="color" value={color} onChange={(e) => setColor(e.target.value)} className="h-11 w-12 cursor-pointer rounded-lg border border-rule-strong bg-white p-1" aria-label="Pick brand color" />
              <input name="primaryColor" value={color} onChange={(e) => setColor(e.target.value)} className="input num" />
            </div>
          </div>
          <TextField label="Support phone" name="supportPhone" defaultValue={v.supportPhone ?? ""} placeholder="+91 98765 43210" />
        </div>
      </Section>

      <div className="sticky bottom-0 -mx-4 flex justify-end border-t border-rule bg-paper/95 px-4 py-3 backdrop-blur sm:mx-0 sm:rounded-xl sm:border sm:px-5">
        <SubmitButton intent="saveStore" busyText="Saving">{submitLabel}</SubmitButton>
      </div>
    </Form>
  );
}
