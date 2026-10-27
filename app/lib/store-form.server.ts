import type { Store } from "~/db/schema";
import type { StoreGateway } from "~/db/schema";
import { MAX_GATEWAYS, gatewayById } from "./gateways/catalog";
import { storeGateways } from "./gateways/index.server";
import { newWooSecret } from "./woo.server";

export type StoreInput = Pick<
  Store,
  | "name" | "slug" | "platform" | "shopDomain" | "storefrontUrl" | "checkoutDomain" | "active" | "wooSecret"
  | "adminToken" | "clientId" | "clientSecret" | "apiVersion"
  | "payuKey" | "payuSalt" | "payuMode" | "payuViaStorefront" | "gateways"
  | "codEnabled" | "codCooldownHours" | "codBlockAfterPrepaid"
  | "metaAdAccountId" | "metaAccessToken" | "metaPixelId" | "metaCapiToken" | "metaApiVersion" | "metaFireCodPurchase"
  | "supportPhone" | "popupCheckout"
>;

/** Parses + validates the store settings form. Blank secret fields keep the saved value. */
export function parseStoreForm(fd: FormData, existing?: Store) {
  const s = (k: string) => String(fd.get(k) ?? "").trim();
  const secret = (k: string, old: string | null | undefined) => s(k) || old || null;
  const on = (k: string) => fd.get(k) === "on";
  const errors: Record<string, string> = {};
  // the platform is picked once, when the store is connected
  const platform: Store["platform"] = existing ? existing.platform : s("platform") === "woocommerce" ? "woocommerce" : "shopify";
  const woo = platform === "woocommerce";
  const site = s("storefrontUrl").replace(/\/+$/, "");
  // "Get credentials" stores: the owner's form has no app fields, so keep what Growpefy's team saved
  const keepApp = !woo && Boolean(existing && (existing.connectStatus || existing.installUrl)) && !fd.has("clientId");

  const data: StoreInput = {
    name: s("name"),
    platform,
    // WooCommerce: a fresh secret on connect (or when asked); the plugin signs every request with it
    wooSecret: woo ? (on("rotateWooSecret") || !existing?.wooSecret ? newWooSecret() : existing.wooSecret) : existing?.wooSecret ?? null,
    slug: s("slug").toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, ""),
    shopDomain: (woo ? site : s("shopDomain")).replace(/^https?:\/\//, "").replace(/\/.*$/, "").toLowerCase(),
    storefrontUrl: site,
    // Every checkout runs on Growpefy's own address (store-id.checkout.growpefy.com); own domains are no longer used
    checkoutDomain: null,
    active: on("active"),
    adminToken: keepApp ? existing!.adminToken : on("clearAdminToken") ? null : secret("adminToken", existing?.adminToken),
    clientId: keepApp ? existing!.clientId : s("clientId") || null,
    clientSecret: keepApp ? existing!.clientSecret : secret("clientSecret", existing?.clientSecret),
    apiVersion: s("apiVersion") || "2025-07",
    // filled in from the gateways below (PayU's keys are also kept in the old columns)
    payuKey: null,
    payuSalt: null,
    payuMode: "test",
    gateways: [],
    payuViaStorefront: woo ? false : on("payuViaStorefront"),
    // COD on/off now lives in Payment methods; new stores start with COD on
    codEnabled: existing?.codEnabled ?? true,
    // COD wait time and repeat-COD rules now live in the RTO Suite page
    codCooldownHours: existing?.codCooldownHours ?? 6,
    codBlockAfterPrepaid: existing?.codBlockAfterPrepaid ?? true,
    metaAdAccountId: s("metaAdAccountId").replace(/\D/g, "") || null,
    metaAccessToken: on("clearMetaToken") ? null : secret("metaAccessToken", existing?.metaAccessToken),
    metaPixelId: s("metaPixelId").replace(/\D/g, "") || null,
    metaCapiToken: secret("metaCapiToken", existing?.metaCapiToken),
    metaApiVersion: /^v\d+\.\d+$/.test(s("metaApiVersion")) ? s("metaApiVersion") : "v23.0",
    metaFireCodPurchase: on("metaFireCodPurchase"),
    supportPhone: s("supportPhone") || null,
    popupCheckout: on("popupCheckout"),
  };

  // Payment gateways: up to 3, in the order shown (primary first). Blank secrets keep the saved value.
  const count = Math.min(MAX_GATEWAYS, Math.max(0, Number(s("gwCount")) || 0));
  const before = existing ? storeGateways(existing) : [];
  const seen = new Set<string>();
  for (let i = 0; i < count; i++) {
    const id = s(`gw${i}_id`);
    const info = gatewayById(id);
    if (!info || seen.has(id)) continue;
    seen.add(id);
    const old = before.find((g) => g.id === id);
    const creds: Record<string, string> = {};
    for (const f of info.fields) {
      const v = s(`gw${i}_f_${f.name}`);
      creds[f.name] = v || (f.secret ? old?.creds[f.name] ?? "" : "");
    }
    const g: StoreGateway = { id, mode: s(`gw${i}_mode`) === "live" ? "live" : "test", on: on(`gw${i}_on`), creds };
    const missing = info.fields.filter((f) => !f.optional && !creds[f.name]).map((f) => f.label.toLowerCase());
    if (g.on && missing.length) errors[`gw${i}`] = `${info.name}: enter the ${missing.join(", ")}`;
    data.gateways.push(g);
  }
  const payuGw = data.gateways.find((g) => g.id === "payu");
  data.payuKey = payuGw?.creds.key || null;
  data.payuSalt = payuGw?.creds.salt || null;
  data.payuMode = payuGw?.mode ?? "test";

  if (!data.name) errors.name = "Enter the store name";
  if (!data.slug) errors.slug = "Enter a short ID, e.g. budverse";
  if (!woo && !/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(data.shopDomain)) errors.shopDomain = "Use the .myshopify.com domain, e.g. budverse.myshopify.com";
  if (woo && !/^https:\/\/\S+$/.test(data.storefrontUrl)) errors.storefrontUrl = "Use your WordPress site address with https://, e.g. https://budverse.in";
  if (!/^https?:\/\/\S+$/.test(data.storefrontUrl)) errors.storefrontUrl = "Start with https://, e.g. https://budverse.in";
  if (data.slug && data.slug.length > 40) errors.slug = "Keep the store ID under 40 characters";
  if (!woo && !keepApp && !data.adminToken && !(data.clientId && data.clientSecret)) errors.clientId = "Add the Shopify app's Client ID and Client secret";

  return { data, errors };
}
