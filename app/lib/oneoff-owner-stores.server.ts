// One-off (delete after it has run): lists every store under the same owner account as Zavli (store 3).
import { asc, eq } from "drizzle-orm";
import { db, stores, users } from "~/db.server";

let ran = false;
export async function logOwnerStores() {
  if (ran) return;
  ran = true;
  try {
    const [z] = await db.select({ ownerId: stores.ownerId }).from(stores).where(eq(stores.id, 3)).limit(1);
    if (!z?.ownerId) { console.log("[owner-stores] store 3 has no owner"); return; }
    const [u] = await db.select({ id: users.id, name: users.name, active: users.active }).from(users).where(eq(users.id, z.ownerId)).limit(1);
    const list = await db.select({ id: stores.id, name: stores.name, slug: stores.slug, platform: stores.platform, shop: stores.shopDomain, checkout: stores.checkoutDomain, createdAt: stores.createdAt })
      .from(stores).where(eq(stores.ownerId, z.ownerId)).orderBy(asc(stores.id));
    console.log(`[owner-stores] owner #${u?.id} "${u?.name}" active=${u?.active}: ${list.length} stores`);
    for (const s of list) console.log(`[owner-stores] #${s.id} ${s.name} | ${s.platform} | ${s.shop} | checkout ${s.checkout ?? "-"} | slug ${s.slug} | added ${s.createdAt.toISOString().slice(0, 10)}`);
  } catch (e) {
    console.error("[owner-stores]", e instanceof Error ? e.message : e);
  }
}
