import type { Store } from "~/db/schema";
import { appHost, cleanDomain } from "./urls.server";

export type StoreInput = Pick<
  Store,
  | "name" | "slug" | "shopDomain" | "storefrontUrl" | "checkoutDomain" | "active"
  | "adminToken" | "clientId" | "clientSecret" | "apiVersion"
  | "payuKey" | "payuSalt" | "payuMode"
  | "codEnabled" | "codCooldownHours" | "codBlockAfterPrepaid"
  | "metaAdAccountId" | "metaAccessToken" | "metaPixelId" | "metaCapiToken" | "metaApiVersion" | "metaFireCodPurchase"
  | "supportPhone"
>;

/** Parses + validates the store settings form. Blank secret fields keep the saved value. */
export function parseStoreForm(fd: FormData, existing?: Store) {
  const s = (k: string) => String(fd.get(k) ?? "").trim();
  const secret = (k: string, old: string | null | undefined) => s(k) || old || null;
  const on = (k: string) => fd.get(k) === "on";
  const errors: Record<string, string> = {};


  const data: StoreInput = {
    name: s("name"),
    slug: s("slug").toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, ""),
    shopDomain: s("shopDomain").replace(/^https?:\/\//, "").replace(/\/.*$/, "").toLowerCase(),
    storefrontUrl: s("storefrontUrl").replace(/\/+$/, ""),
    checkoutDomain: s("checkoutDomain") ? cleanDomain(s("checkoutDomain")) : null,
    active: on("active"),
    adminToken: on("clearAdminToken") ? null : secret("adminToken", existing?.adminToken),
    clientId: s("clientId") || null,
    clientSecret: secret("clientSecret", existing?.clientSecret),
    apiVersion: s("apiVersion") || "2025-07",
    payuKey: s("payuKey") || null,
    payuSalt: secret("payuSalt", existing?.payuSalt),
    payuMode: s("payuMode") === "live" ? "live" : "test",
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
  };

  if (!data.name) errors.name = "Enter the store name";
  if (!data.slug) errors.slug = "Enter a short ID, e.g. budverse";
  if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(data.shopDomain)) errors.shopDomain = "Use the .myshopify.com domain, e.g. budverse.myshopify.com";
  if (!/^https?:\/\/\S+$/.test(data.storefrontUrl)) errors.storefrontUrl = "Start with https://, e.g. https://budverse.in";
  if (s("checkoutDomain") && !data.checkoutDomain) errors.checkoutDomain = "Enter only the domain, e.g. checkout.budverse.in";
  if (data.checkoutDomain && data.checkoutDomain === appHost()) errors.checkoutDomain = "Use your store's own subdomain, not the platform domain";
  if (!data.adminToken && !(data.clientId && data.clientSecret)) errors.clientId = "Add the Shopify app's Client ID and Client secret";

  return { data, errors };
}
