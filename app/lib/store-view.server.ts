import type { Store } from "~/db/schema";

/** Store fields safe to send to the browser (secrets replaced by "saved" flags). */
export function storeForClient(s: Store) {
  const { adminToken, clientSecret, payuSalt, metaAccessToken, metaCapiToken, ...safe } = s;
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
