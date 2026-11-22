// One-off: dump Tasqari's website setup (theme, menus, pages) and its old Shopify store's pages/policies/contact,
// so the new site's pages can be written from them.
import { eq } from "drizzle-orm";
import { db, storeMenus, storePages, storeThemes, stores, catalogCategories } from "~/db.server";
import { adminGraphql } from "./shopify.server";
import { shopifySide } from "./shopify-oauth.server";

const out = (tag: string, v: unknown) => {
  const s = JSON.stringify(v);
  for (let i = 0; i < s.length; i += 6000) console.log(`[site-dump] ${tag} ${i / 6000}: ${s.slice(i, i + 6000)}`);
};

let done = false;
export async function dumpSite() {
  if (done) return;
  done = true;
  try {
    for (const id of [23, 8]) {
      const [t] = await db.select().from(storeThemes).where(eq(storeThemes.storeId, id)).limit(1);
      const live = t?.live;
      out(`store${id}.theme`, { theme: t?.theme, settings: live?.settings, groups: live?.groups, indexOrder: live?.templates?.index?.order });
      out(`store${id}.menus`, await db.select({ title: storeMenus.title, handle: storeMenus.handle, items: storeMenus.items, h: storeMenus.inHeader, f: storeMenus.inFooter }).from(storeMenus).where(eq(storeMenus.storeId, id)));
      out(`store${id}.pages`, (await db.select().from(storePages).where(eq(storePages.storeId, id))).map((p) => ({ id: p.id, title: p.title, handle: p.handle, pub: p.published, f: p.inFooter, len: p.bodyHtml.length, body: id === 23 ? p.bodyHtml.slice(0, 1500) : undefined })));
    }
    out("store23.cats", await db.select({ t: catalogCategories.title, h: catalogCategories.handle }).from(catalogCategories).where(eq(catalogCategories.storeId, 23)));
    const [st] = await db.select().from(stores).where(eq(stores.id, 23)).limit(1);
    out("store23.store", { name: st?.name, logo: st?.logoUrl, domain: st?.storefrontDomain, shopifyShop: st?.shopifyShop, hasToken: Boolean(st?.adminToken), phone: (st as Record<string, unknown> | undefined)?.supportPhone, email: (st as Record<string, unknown> | undefined)?.supportEmail });
    if (st?.adminToken && st.shopifyShop) {
      const d = await adminGraphql<Record<string, unknown>>(shopifySide(st), `{
        shop { name email contactEmail description billingAddress { address1 address2 city province zip phone company }
          shopPolicies { type title body } }
        pages(first: 30) { nodes { title handle body } }
      }`, {});
      out("shopify", d);
    } else console.log("[site-dump] Tasqari Shopify not connected (no token)");
  } catch (e) {
    console.error("[site-dump]", e instanceof Error ? e.message : e);
  }
}
