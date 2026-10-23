import type { Store } from "~/db/schema";

/** Store fields safe to send to the browser (secrets replaced by "saved" flags; admin-only fields left out). */
export function storeForClient(s: Store) {
  // dropshipping is admin-only and must never reach the store owner's browser
  const { adminToken, clientSecret, payuSalt, metaAccessToken, metaCapiToken, dropshipEnabled: _d, dropship: _ds, ...safe } = s;
  return {
    ...safe,
    createdAt: s.createdAt.toISOString(),
    hasAdminToken: Boolean(adminToken),
    hasClientSecret: Boolean(clientSecret),
    hasPayuSalt: Boolean(payuSalt),
    hasMetaToken: Boolean(metaAccessToken),
    hasCapiToken: Boolean(metaCapiToken),
  };
}
