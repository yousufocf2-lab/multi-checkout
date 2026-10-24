import type { Store } from "~/db/schema";
import { gatewayById } from "./gateways/catalog";
import { storeGateways } from "./gateways/index.server";

/** Store fields safe to send to the browser (secrets replaced by "saved" flags; admin-only fields left out). */
export function storeForClient(s: Store) {
  // dropshipping is admin-only and must never reach the store owner's browser
  const { adminToken, clientSecret, payuSalt, metaAccessToken, metaCapiToken, dropshipEnabled: _d, dropship: _ds, gateways: _g, ...safe } = s;
  // Gateways: public fields as they are, secrets only as "saved"
  const gatewayViews = storeGateways(s).map((g) => {
    const info = gatewayById(g.id);
    const values: Record<string, string> = {};
    const saved: Record<string, boolean> = {};
    for (const f of info?.fields ?? []) {
      if (f.secret) saved[f.name] = Boolean(g.creds[f.name]);
      else values[f.name] = g.creds[f.name] ?? "";
    }
    return { id: g.id, mode: g.mode, on: g.on, values, saved };
  });
  return {
    ...safe,
    createdAt: s.createdAt.toISOString(),
    hasAdminToken: Boolean(adminToken),
    hasClientSecret: Boolean(clientSecret),
    hasPayuSalt: Boolean(payuSalt),
    gatewayViews,
    webhookBase: (process.env.APP_URL ?? "").replace(/\/+$/, ""),
    hasMetaToken: Boolean(metaAccessToken),
    hasCapiToken: Boolean(metaCapiToken),
  };
}
