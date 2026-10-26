// Billing details printed on a store's GST invoices: taken from the owner's KYC, with the admin able to correct them.
// Store owners can't change what came from KYC (that needs a re-KYC by Growpefy); they can only fill what's missing.
import { eq } from "drizzle-orm";
import { db, stores, users, wallets, type BillingDetails } from "~/db.server";

import { BILLING_FIELDS, type BillingField } from "./billing";
export { BILLING_FIELDS, BILLING_LABEL, GST_STATE_CODE, stateCode, type BillingField } from "./billing";

export type StoreBilling = {
  details: BillingDetails;
  /** Fields that came from the owner's KYC (owners can't edit them). */
  fromKyc: BillingField[];
  /** Name, address, state and an email or phone are all there. */
  complete: boolean;
  hasOwner: boolean;
};

/** What goes on this store's invoices right now. */
export async function storeBilling(storeId: number): Promise<StoreBilling> {
  const [row] = await db.select({ store: stores, wallet: wallets, owner: users })
    .from(stores)
    .leftJoin(wallets, eq(wallets.storeId, stores.id))
    .leftJoin(users, eq(users.id, stores.ownerId))
    .where(eq(stores.id, storeId)).limit(1);
  if (!row) throw new Response("Store not found", { status: 404 });
  const k = row.owner?.kyc ?? {};
  const kyc: BillingDetails = row.owner ? {
    name: k.legalName || k.brandName || row.owner.name || undefined,
    gstin: k.gstin || undefined,
    address: [k.address, k.landmark, k.city, k.pincode].filter(Boolean).join(", ") || undefined,
    state: k.state || undefined,
    email: k.email || row.owner.email || undefined,
    phone: k.phone || row.owner.phone || undefined,
  } : {};
  const saved = row.wallet?.billing ?? {};
  const details: BillingDetails = {};
  for (const f of BILLING_FIELDS) {
    const v = (saved[f] || kyc[f] || "").trim();
    if (v) details[f] = v;
  }
  if (!details.name) details.name = row.store.name; // always something to bill to
  const fromKyc = BILLING_FIELDS.filter((f) => Boolean(kyc[f]));
  return {
    details, fromKyc, hasOwner: Boolean(row.owner),
    complete: Boolean(details.name && details.address && details.state && (details.email || details.phone)),
  };
}
