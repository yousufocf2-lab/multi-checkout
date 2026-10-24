import { Form } from "@remix-run/react";
import { Section, SelectField, SubmitButton, TextField, Toggle } from "./ui";
import { GatewaysEditor, type GatewayView } from "./GatewaysEditor";

export type StoreFormValues = {
  name?: string; slug?: string; shopDomain?: string; storefrontUrl?: string; checkoutDomain?: string | null; active?: boolean;
  clientId?: string | null; apiVersion?: string; hasAdminToken?: boolean; hasClientSecret?: boolean;
  payuViaStorefront?: boolean; gatewayViews?: GatewayView[]; webhookBase?: string;
  codEnabled?: boolean; codCooldownHours?: number; codBlockAfterPrepaid?: boolean;
  metaAdAccountId?: string | null; metaPixelId?: string | null; metaApiVersion?: string; metaFireCodPurchase?: boolean;
  hasMetaToken?: boolean; hasCapiToken?: boolean;
  id?: number; googleConnected?: boolean; googleAdsCustomerId?: string | null; googleConversionActionName?: string | null; googleTagId?: string | null;
  logoUrl?: string | null; primaryColor?: string; supportPhone?: string | null; popupCheckout?: boolean;
};


const saved = (yes?: boolean) => (yes ? "Saved. Leave blank to keep it." : undefined);

export function StoreSettingsForm({ values = {}, errors = {}, submitLabel, isNew }: {
  values?: StoreFormValues; errors?: Record<string, string>; submitLabel: string; isNew?: boolean;
}) {
  const v = values;

  return (
    <Form method="post" className="space-y-5" noValidate>

      <Section title="Store details" description="How this store is identified on your checkout.">
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField label="Store name" name="name" defaultValue={v.name} error={errors.name} placeholder="Budverse" required />
          <TextField label="Store ID" name="slug" defaultValue={v.slug} error={errors.slug} placeholder="budverse" hint="Lowercase letters, numbers and dashes. Used in the theme script and your checkout address." required />
          <TextField label="Shopify domain" name="shopDomain" defaultValue={v.shopDomain} error={errors.shopDomain} placeholder="budverse.myshopify.com" hint="Settings → Domains in Shopify admin" required />
          <TextField label="Store website" name="storefrontUrl" defaultValue={v.storefrontUrl} error={errors.storefrontUrl} placeholder="https://budverse.in" required />
          <TextField label="Support phone" name="supportPhone" defaultValue={v.supportPhone ?? ""} placeholder="+91 98765 43210" hint="Shown on the checkout for help." />
          <TextField label="Own checkout domain (optional)" name="checkoutDomain" defaultValue={v.checkoutDomain ?? ""} error={errors.checkoutDomain} placeholder="checkout.budverse.in"
            hint="Leave empty to use your free checkout address (store-id.checkout.growpefy.com). Nothing to set up." />
        </div>
        <div className="mt-4 border-t border-rule pt-4"><Toggle name="popupCheckout" label="Open checkout as a popup" description="Checkout opens over your store, so customers never leave your website. On phones it fills the screen like a normal page. If it can't load, it opens as a page instead." defaultChecked={v.popupCheckout ?? true} /></div>
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

      <Section title="Payment gateways" description="Connect up to 3 gateways. Payments go straight to your account. If the primary has a problem, the backup takes over.">
        <GatewaysEditor initial={v.gatewayViews ?? []} errors={errors} webhookBase={v.webhookBase} />
        <label className="mt-4 flex cursor-pointer items-start gap-2.5 rounded-lg border border-rule p-3">
          <input type="checkbox" name="payuViaStorefront" defaultChecked={v.payuViaStorefront} className="mt-0.5 h-4 w-4" />
          <span className="text-sm"><b>Start payments from the store's own website</b>
            <span className="block text-xs text-ink-faint">For gateways that only allow your registered website (PayU, Cashfree, CCAvenue). Payments start from {v.storefrontUrl ? v.storefrontUrl.replace(/^https?:\/\//, "") : "your store"}/apps/growpefy/… Needs App Proxy in your Shopify app (subpath prefix <b>apps</b>, subpath <b>growpefy</b>, proxy URL <b>https://growpefy.com/proxy</b>).{v.storefrontUrl && <> <a href={`${v.storefrontUrl.replace(/\/+$/, "")}/apps/growpefy/ping`} target="_blank" rel="noreferrer" className="font-medium text-pine underline">Test App Proxy</a></>}</span></span>
        </label>
      </Section>

      <Section title="Payment methods" description="Prepaid, Cash on Delivery and Partial COD.">
        <p className="text-sm text-ink-soft">
          Turn COD, Prepaid and Partial COD on or off, and set their discount or fee, in <b className="text-ink">Payment methods</b> in the menu.
          COD wait time, OTP and blocking customers are in <b className="text-ink">RTO Suite</b>.
        </p>
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

      {!isNew && v.id && (
        <Section id="google" title="Google Ads" description="Spend, conversions and campaigns from Google Ads next to Meta, and purchases sent back to Google.">
          <div className="flex flex-wrap items-center gap-3">
            <img src="/brand/ads/google-ads.png" alt="Google Ads" className="h-7 w-auto" />
            <p className="min-w-0 flex-1 text-sm text-ink-soft">
              {v.googleConnected && v.googleAdsCustomerId
                ? <>Connected to ad account <b className="num text-ink">{v.googleAdsCustomerId.replace(/(\d{3})(\d{3})(\d{4})/, "$1-$2-$3")}</b>{v.googleConversionActionName ? <> · purchases go to “{v.googleConversionActionName}”</> : " · purchase uploads off"}{v.googleTagId ? <> · tag {v.googleTagId}</> : ""}</>
                : v.googleConnected ? "Signed in. Pick the ad account to finish." : "Not connected."}
            </p>
            <a href={`/dashboard/stores/${v.id}/ads?ch=google`} className="btn-secondary">{v.googleConnected ? "Manage Google Ads" : "Connect Google Ads"}</a>
          </div>
        </Section>
      )}

      {!isNew && <p className="text-sm text-ink-soft">Logo, brand color and the checkout's look are under <b>Settings → Checkout design</b>.</p>}
      <div className="sticky bottom-16 -mx-4 flex justify-end border-t border-rule bg-paper/95 px-4 py-3 backdrop-blur sm:mx-0 sm:rounded-xl sm:border sm:px-5 lg:bottom-0">
        <SubmitButton intent="saveStore" busyText="Saving">{submitLabel}</SubmitButton>
      </div>
    </Form>
  );
}
