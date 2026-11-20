// One-time fix: domains like brand.co.in were saved without www (the .co.in ending wasn't recognised), so the
// Cloudflare hostname waited for a record on the bare domain while customers added "www". Moves pending ones to www.
import { and, isNotNull, ne, or, isNull } from "drizzle-orm";
import { eq } from "drizzle-orm";
import { db, stores } from "~/db.server";
import { addHostname, cfConfigured, removeHostname } from "./cloudflare.server";
import { domainParts } from "./domain-parts";

let ran = false;
export async function fixApexDomains() {
  if (ran || !cfConfigured()) return;
  ran = true;
  try {
    const rows = await db.select({ id: stores.id, domain: stores.storefrontDomain }).from(stores)
      .where(and(isNotNull(stores.storefrontDomain), or(isNull(stores.storefrontDomainStatus), ne(stores.storefrontDomainStatus, "live"))));
    for (const r of rows) {
      const d = r.domain!;
      if (!domainParts(d).isApex) continue;
      const www = `www.${d}`;
      const [taken] = await db.select({ id: stores.id }).from(stores).where(eq(stores.storefrontDomain, www)).limit(1);
      if (taken) continue;
      await removeHostname(d).catch((e) => console.error("[domain-fix] remove", d, e instanceof Error ? e.message : e));
      await addHostname(www);
      await db.update(stores).set({ storefrontDomain: www, storefrontDomainStatus: "dns", storefrontDnsTarget: null }).where(eq(stores.id, r.id));
      console.log(`[domain-fix] store ${r.id}: ${d} -> ${www}`);
    }
  } catch (e) {
    console.error("[domain-fix]", e instanceof Error ? e.message : e);
  }
}
