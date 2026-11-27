// One-off (delete after it has run, with oneoff/hw512.enc and the ONEOFF_IMPORT_KEY variable):
// HW-512 smartwatch abandoned checkouts from the old Fusion checkout (Supabase, May–Oct 2026) into
// fusionprimes.in's (store 8) abandoned list, only for customers who never ordered anywhere since:
// the old checkout's orders were already left out when the file was made; here Growpefy orders on
// Fusion Prime and Zavli are checked too. Old dates are kept, so they sit below the new checkouts.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { and, asc, eq, ilike, inArray, sql } from "drizzle-orm";
import { catalogItems, catalogVariants, checkoutSessions, db, orders, stores } from "~/db.server";
import { GP_PREFIX } from "./catalog.server";

const TAG = "[hw512-import]";
const FUSION = 8;
const ORDERED = ["paid", "cod_placed", "cod_placing", "cancelled"];
type Row = { p: string; c: string; u: string; pr: number };

function readRows(): Row[] | null {
  const key = process.env.ONEOFF_IMPORT_KEY;
  const file = path.join(process.cwd(), "oneoff", "hw512.enc");
  if (!key || !fs.existsSync(file)) return null;
  const buf = fs.readFileSync(file);
  const d = crypto.createDecipheriv("aes-256-gcm", Buffer.from(key, "base64"), buf.subarray(0, 12));
  d.setAuthTag(buf.subarray(12, 28));
  return JSON.parse(Buffer.concat([d.update(buf.subarray(28)), d.final()]).toString("utf8")) as Row[];
}

let ran = false;
export async function importHw512() {
  if (ran) return;
  ran = true;
  try {
    const rows = readRows();
    if (!rows) { console.log(`${TAG} no data or key, skipped`); return; }
    const [done] = await db.select({ n: sql<number>`count(*)::int` }).from(checkoutSessions)
      .where(and(eq(checkoutSessions.storeId, FUSION), sql`${checkoutSessions.tracking}->>'import' = 'old_checkout'`));
    if (done?.n) { console.log(`${TAG} already imported (${done.n}), skipped`); return; }

    // HW-512 on fusionprimes.in
    const items = await db.select().from(catalogItems)
      .where(and(eq(catalogItems.storeId, FUSION), ilike(catalogItems.title, "%HW-512%"))).orderBy(asc(catalogItems.id));
    const item = items.find((i) => i.status === "active") ?? null;
    if (!item) { console.log(`${TAG} no active HW-512 product on store ${FUSION} (found ${items.length}: ${items.map((i) => `#${i.id} ${i.status}`).join(", ")}), stopped`); return; }
    const [v] = await db.select().from(catalogVariants).where(eq(catalogVariants.itemId, item.id)).orderBy(asc(catalogVariants.id)).limit(1);
    if (!v) { console.log(`${TAG} HW-512 #${item.id} has no variant, stopped`); return; }

    // Fusion Prime and Zavli stores (any owner), and phones that ordered on them in Growpefy
    const brandStores = await db.select({ id: stores.id, name: stores.name }).from(stores)
      .where(sql`(lower(${stores.name}) like 'fusion%' or lower(${stores.name}) like 'zavli%')`);
    const storeIds = brandStores.map((s) => s.id);
    const phones = [...new Set(rows.map((r) => r.p))];
    const orderedPhones = new Set<string>();
    for (let i = 0; i < phones.length; i += 1000) {
      const part = phones.slice(i, i + 1000);
      const got = await db.selectDistinct({ p: sql<string>`right(regexp_replace(${orders.customer}->>'phone', '\\D', '', 'g'), 10)` }).from(orders)
        .where(and(inArray(orders.storeId, storeIds), inArray(orders.status, ORDERED),
          sql`right(regexp_replace(${orders.customer}->>'phone', '\\D', '', 'g'), 10) in (${sql.join(part.map((p) => sql`${p}`), sql`, `)})`));
      for (const g of got) orderedPhones.add(g.p);
    }
    const keep = rows.filter((r) => !orderedPhones.has(r.p));

    const image = v.imageUrl ?? (item.images as { url: string }[])[0]?.url ?? null;
    const snapshot = [{ title: item.title, variantTitle: v.title && v.title !== "Default" ? v.title : null, image, quantity: 1, pricePaise: v.pricePaise }];
    let n = 0;
    for (let i = 0; i < keep.length; i += 500) {
      const part = keep.slice(i, i + 500);
      await db.insert(checkoutSessions).values(part.map((r) => ({
        id: crypto.randomBytes(12).toString("base64url"),
        storeId: FUSION,
        items: [{ variantId: `${GP_PREFIX}${v.id}`, quantity: 1 }],
        customer: { phone: r.p },
        cartSnapshot: snapshot,
        cartValue: v.pricePaise,
        tracking: { import: "old_checkout" },
        createdAt: new Date(r.c),
        updatedAt: new Date(r.u),
      })));
      n += part.length;
    }
    console.log(`${TAG} stores checked: ${brandStores.map((s) => `#${s.id} ${s.name}`).join(", ")}`);
    console.log(`${TAG} file ${rows.length}, ordered on Growpefy ${rows.length - keep.length}, imported ${n} into store ${FUSION} (HW-512 #${item.id} variant ${v.id}, price ${v.pricePaise / 100})`);
  } catch (e) {
    console.error(TAG, e instanceof Error ? e.message : e);
  }
}
