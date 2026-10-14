import type { Store } from "~/db/schema";

type StoreInput = Omit<Store, "id" | "createdAt">;

/** Parses + validates the store settings form. Blank secret fields keep the old value. */
export function parseStoreForm(fd: FormData, existing?: Store) {
  const s = (k: string) => String(fd.get(k) ?? "").trim();
  const pct = (k: string) => Math.max(0, Math.min(100, Math.round(Number(s(k)) || 0)));
  const secret = (k: string, old: string | null | undefined) => s(k) || old || null;
  const errors: Record<string, string> = {};

  const shopDomain = s("shopDomain").replace(/^https?:\/\//, "").replace(/\/.*$/, "").toLowerCase();
  const data: StoreInput = {
    name: s("name"),
    slug: s("slug").toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, ""),
    shopDomain,
    storefrontUrl: s("storefrontUrl").replace(/\/+$/, ""),
    adminToken: secret("adminToken", existing?.adminToken),
    clientId: s("clientId") || null,
    clientSecret: secret("clientSecret", existing?.clientSecret),
    apiVersion: s("apiVersion") || "2025-07",
    logoUrl: s("logoUrl") || null,
    primaryColor: /^#[0-9a-f]{6}$/i.test(s("primaryColor")) ? s("primaryColor") : "#111827",
    supportPhone: s("supportPhone") || null,
    prepaidDiscountPct: pct("prepaidDiscountPct"),
    codDiscountPct: pct("codDiscountPct"),
    codEnabled: fd.get("codEnabled") === "on",
    payuKey: s("payuKey") || null,
    payuSalt: secret("payuSalt", existing?.payuSalt),
    payuMode: s("payuMode") === "live" ? "live" : "test",
    active: fd.get("active") === "on",
    metaAdAccountId: s("metaAdAccountId").replace(/\D/g, "") || null,
    metaAccessToken: secret("metaAccessToken", existing?.metaAccessToken),
    metaPixelId: s("metaPixelId").replace(/\D/g, "") || null,
    metaCapiToken: secret("metaCapiToken", existing?.metaCapiToken),
    metaApiVersion: /^v\d+\.\d+$/.test(s("metaApiVersion")) ? s("metaApiVersion") : "v23.0",
    metaFireCodPurchase: fd.get("metaFireCodPurchase") === "on",
  };
  if (fd.get("clearMetaToken") === "on") data.metaAccessToken = null;

  if (fd.get("clearAdminToken") === "on") data.adminToken = null;

  if (!data.name) errors.name = "Required";
  if (!data.slug) errors.slug = "Required";
  if (!/^[a-z0-9-]+\.myshopify\.com$/.test(data.shopDomain)) errors.shopDomain = "xyz.myshopify.com format chahiye";
  if (!/^https?:\/\//.test(data.storefrontUrl)) errors.storefrontUrl = "https:// se shuru hona chahiye";
  if (!data.adminToken && !(data.clientId && data.clientSecret)) errors.adminToken = "Admin token ya Client ID + Secret mein se ek chahiye";

  return { data, errors };
}
