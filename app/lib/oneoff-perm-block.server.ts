// One-off (delete after it has run, with oneoff/perm.enc and the ONEOFF_IMPORT_KEY variable):
// customers permanently blocked in the old Fusion checkout (Supabase) go into the block list of
// Fusion Prime (store 8) and Zavli (store 3). How a blocked customer is treated (COD only or no order)
// follows each store's own block list setting.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { inArray } from "drizzle-orm";
import { blockedCustomers, db, stores } from "~/db.server";

const TAG = "[perm-block-import]";
const STORES = [8, 3];

let ran = false;
export async function importPermBlocks() {
  if (ran) return;
  ran = true;
  try {
    const key = process.env.ONEOFF_IMPORT_KEY;
    const file = path.join(process.cwd(), "oneoff", "perm.enc");
    if (!key || !fs.existsSync(file)) { console.log(`${TAG} no data or key, skipped`); return; }
    const buf = fs.readFileSync(file);
    const d = crypto.createDecipheriv("aes-256-gcm", Buffer.from(key, "base64"), buf.subarray(0, 12));
    d.setAuthTag(buf.subarray(12, 28));
    const phones = (JSON.parse(Buffer.concat([d.update(buf.subarray(28)), d.final()]).toString("utf8")) as string[]).filter((p) => /^[6-9]\d{9}$/.test(p));
    for (const storeId of STORES) {
      let added = 0;
      for (let i = 0; i < phones.length; i += 1000) {
        const part = phones.slice(i, i + 1000);
        const res = await db.insert(blockedCustomers).values(part.map((p) => ({ storeId, kind: "phone", value: p, source: "old_checkout" })))
          .onConflictDoNothing().returning({ id: blockedCustomers.id });
        added += res.length;
      }
      console.log(`${TAG} store ${storeId}: ${phones.length} phones, ${added} newly blocked, ${phones.length - added} were already on the list`);
    }
    const s = await db.select({ id: stores.id, name: stores.name, on: stores.blockEnabled, codOnly: stores.blockCodOnly }).from(stores).where(inArray(stores.id, STORES));
    for (const x of s) console.log(`${TAG} store ${x.id} ${x.name}: block list ${x.on ? "ON" : "OFF"}, ${x.codOnly ? "COD only" : "no orders at all"}`);
  } catch (e) {
    console.error(TAG, e instanceof Error ? e.message : e);
  }
}
