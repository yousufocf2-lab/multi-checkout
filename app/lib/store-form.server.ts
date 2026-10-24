import type { Store } from "~/db/schema";
import { appHost, checkoutRoot, cleanDomain } from "./urls.server";
import type { StoreGateway } from "~/db/schema";
import { MAX_GATEWAYS, gatewayById } from "./gateways/catalog";
import { storeGateways } from "./gateways/index.server";

export type StoreInput = Pick<
  Store,
  | "name" | "slug" | "shopDomain" | "storefrontUrl" | "checkoutDomain" | "active"
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
    // filled in from the gateways below (PayU's keys are also kept in the old columns)
    payuKey: null,
    payuSalt: null,
    payuMode: "test",
    gateways: [],
    payuViaStorefront: on("payuViaStorefront"),
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
  if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(data.shopDomain)) errors.shopDomain = "Use the .myshopify.com domain, e.g. budverse.myshopify.com";
  if (!/^https?:\/\/\S+$/.test(data.storefrontUrl)) errors.storefrontUrl = "Start with https://, e.g. https://budverse.in";
  if (s("checkoutDomain") && !data.checkoutDomain) errors.checkoutDomain = "Enter only the domain, e.g. checkout.budverse.in";
  if (data.checkoutDomain && data.checkoutDomain === appHost()) errors.checkoutDomain = "Use your store's own subdomain, not the platform domain";
  const root = checkoutRoot();
  if (data.checkoutDomain && root && (data.checkoutDomain === root || data.checkoutDomain.endsWith(`.${root}`))) errors.checkoutDomain = "Leave this empty to use your free checkout address. Only add a domain you own.";
  if (data.slug && data.slug.length > 40) errors.slug = "Keep the store ID under 40 characters";
  if (!data.adminToken && !(data.clientId && data.clientSecret)) errors.clientId = "Add the Shopify app's Client ID and Client secret";

  return { data, errors };
}
