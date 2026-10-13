import { Form } from "@remix-run/react";

export type StoreFormValues = {
  name?: string; slug?: string; shopDomain?: string; storefrontUrl?: string;
  clientId?: string | null; apiVersion?: string; logoUrl?: string | null; primaryColor?: string;
  supportPhone?: string | null; prepaidDiscountPct?: number; codDiscountPct?: number; codEnabled?: boolean;
  payuKey?: string | null; payuMode?: string; active?: boolean;
  hasAdminToken?: boolean; hasClientSecret?: boolean; hasPayuSalt?: boolean;
};

export function StoreForm({ values = {}, errors = {}, submitLabel, busy }: {
  values?: StoreFormValues; errors?: Record<string, string>; submitLabel: string; busy?: boolean;
}) {
  const v = values;
  return (
    <Form method="post" className="space-y-5">
      <input type="hidden" name="intent" value="saveStore" />
      <Section title="Store">
        <F label="Store name" name="name" defaultValue={v.name} error={errors.name} required />
        <F label="Slug (embed script mein use hoga)" name="slug" defaultValue={v.slug} error={errors.slug} placeholder="fusion-prime" required />
        <F label="Shopify domain" name="shopDomain" defaultValue={v.shopDomain} error={errors.shopDomain} placeholder="xyz.myshopify.com" required />
        <F label="Storefront URL" name="storefrontUrl" defaultValue={v.storefrontUrl} error={errors.storefrontUrl} placeholder="https://brand.com" required />
        <Check name="active" label="Checkout live hai" defaultChecked={v.active ?? true} />
      </Section>

      <Section title="Shopify API access" hint="Option A: Admin API access token (shpat_…). Option B: Dev Dashboard app ka Client ID + Secret. Scopes: read_products, write_orders.">
        <F label={`Admin API token ${v.hasAdminToken ? "(saved — naya daalo toh replace hoga)" : ""}`} name="adminToken" type="password" error={errors.adminToken} placeholder="shpat_…" />
        {v.hasAdminToken && <Check name="clearAdminToken" label="Saved admin token hata do" />}
        <F label="Client ID" name="clientId" defaultValue={v.clientId ?? ""} />
        <F label={`Client secret ${v.hasClientSecret ? "(saved)" : ""}`} name="clientSecret" type="password" />
        <F label="API version" name="apiVersion" defaultValue={v.apiVersion ?? "2025-07"} />
      </Section>

      <Section title="Discounts">
        <F label="Prepaid discount %" name="prepaidDiscountPct" type="number" min={0} max={100} defaultValue={String(v.prepaidDiscountPct ?? 70)} />
        <F label="COD discount %" name="codDiscountPct" type="number" min={0} max={100} defaultValue={String(v.codDiscountPct ?? 10)} />
        <Check name="codEnabled" label="Cash on Delivery on" defaultChecked={v.codEnabled ?? true} />
      </Section>

      <Section title="PayU">
        <F label="Merchant key" name="payuKey" defaultValue={v.payuKey ?? ""} />
        <F label={`Salt ${v.hasPayuSalt ? "(saved)" : ""}`} name="payuSalt" type="password" />
        <label className="block">
          <span className="label">Mode</span>
          <select name="payuMode" defaultValue={v.payuMode ?? "test"} className="input">
            <option value="test">Test</option>
            <option value="live">Live</option>
          </select>
        </label>
      </Section>

      <Section title="Branding">
        <F label="Logo URL" name="logoUrl" defaultValue={v.logoUrl ?? ""} placeholder="https://cdn.shopify.com/…/logo.png" />
        <label className="block">
          <span className="label">Brand color</span>
          <input name="primaryColor" type="color" defaultValue={v.primaryColor ?? "#111827"} className="h-11 w-full cursor-pointer rounded-xl border border-gray-300 bg-white p-1" />
        </label>
        <F label="Support phone" name="supportPhone" defaultValue={v.supportPhone ?? ""} placeholder="+91…" />
      </Section>

      <button className="btn-primary w-full py-3 sm:w-auto sm:px-8" disabled={busy}>{busy ? "Saving…" : submitLabel}</button>
    </Form>
  );
}

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="card">
      <h2 className="font-semibold">{title}</h2>
      {hint && <p className="mt-1 text-xs text-gray-500">{hint}</p>}
      <div className="mt-4 grid gap-3 sm:grid-cols-2">{children}</div>
    </section>
  );
}

export function F({ label, error, wrap, ...rest }: { label: string; error?: string; wrap?: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className={`block ${wrap ?? ""}`}>
      <span className="label">{label}</span>
      <input className="input" {...rest} />
      {error && <span className="mt-1 block text-xs text-red-600">{error}</span>}
    </label>
  );
}

export function Check({ label, ...rest }: { label: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="flex items-center gap-2 self-end py-2 text-sm">
      <input type="checkbox" className="h-4 w-4 accent-gray-900" {...rest} />
      {label}
    </label>
  );
}
