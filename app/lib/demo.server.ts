// Demo stores: one ready-made store per business type, so the owner can log in and show or test it.
// Login is a plain username (demo, demofood, …) — stored as <username>@demo.growpefy.com.
// "Create / reset" puts the store back to its starting menu or products; real stores are never touched.
import { and, eq, inArray } from "drizzle-orm";
import { catalogCategories, catalogItems, db, stores, users, type Store } from "~/db.server";
import type { BusinessType } from "~/db/schema";
type KycData = NonNullable<typeof users.$inferInsert["kyc"]>;
import { saveItem, type ItemInput, type VariantInput } from "./catalog.server";
import { createOwnStore } from "./connect.server";
import { mediaReady, uploadMedia } from "./media.server";
import type { RestaurantSettings } from "./restaurant";

import { DEMO_DOMAIN, hashPassword } from "./auth.server";
/** The password the owner chose for every demo login (can be changed with DEMO_PASSWORD). */
export const demoPassword = () => process.env.DEMO_PASSWORD || "Demo@@007";

export type DemoDef = { type: BusinessType; username: string; store: string; label: string };
/** One per business type that is ready. New types get a line here (institute → demostudy, …). */
export const DEMOS: DemoDef[] = [
  { type: "store", username: "demo", store: "Demo Store", label: "Online store" },
  { type: "restaurant", username: "demofood", store: "Demo Kitchen", label: "Restaurant / cloud kitchen" },
];


export async function demoStatus() {
  const emails = DEMOS.map((d) => `${d.username}${DEMO_DOMAIN}`);
  const us = await db.select({ id: users.id, email: users.email }).from(users).where(inArray(users.email, emails));
  const ids = us.map((u) => u.id);
  const ss = ids.length ? await db.select({ id: stores.id, ownerId: stores.ownerId, slug: stores.slug, name: stores.name, businessType: stores.businessType }).from(stores).where(inArray(stores.ownerId, ids)) : [];
  return DEMOS.map((d) => {
    const u = us.find((x) => x.email === `${d.username}${DEMO_DOMAIN}`);
    const s = u ? ss.find((x) => x.ownerId === u.id && x.businessType === d.type) : undefined;
    return { ...d, userId: u?.id ?? null, storeId: s?.id ?? null, slug: s?.slug ?? null };
  });
}

const rs = (n: number) => Math.round(n * 100);
const v = (price: number, mrp: number | null, title = "Default", optionValues: string[] = [], stock: number | null = null): VariantInput =>
  ({ title, optionValues, sku: null, pricePaise: rs(price), compareAtPaise: mrp ? rs(mrp) : null, stock, weightGrams: 300 });
const img = (k: string) => [{ url: `/demo/${k}.svg`, alt: "" }];

/** Creates the demo login + store, or resets them to the starting state. Returns the store id. */
export async function ensureDemo(type: BusinessType) {
  const d = DEMOS.find((x) => x.type === type);
  if (!d) throw new Error("There's no demo for this store type yet.");
  const email = `${d.username}${DEMO_DOMAIN}`;
  const passwordHash = await hashPassword(demoPassword());
  const kyc = { v: 2 } as KycData;
  let [u] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  if (!u) {
    [u] = await db.insert(users).values({ email, name: d.store, passwordHash, kyc, kycStatus: "approved", signupWith: "email", active: true, signup: { industry: type } }).returning();
  } else {
    await db.update(users).set({ passwordHash, kycStatus: "approved", kyc: { ...(u.kyc ?? {}), v: 2 } as KycData, active: true }).where(eq(users.id, u.id));
  }
  let [s] = await db.select().from(stores).where(and(eq(stores.ownerId, u.id), eq(stores.businessType, type))).limit(1);
  if (!s) {
    const id = await createOwnStore({ ownerId: u.id, name: d.store, businessType: type });
    [s] = await db.select().from(stores).where(eq(stores.id, id)).limit(1);
  }
  // Start over: the demo's own products / menu only
  await db.delete(catalogItems).where(eq(catalogItems.storeId, s.id));
  await db.delete(catalogCategories).where(eq(catalogCategories.storeId, s.id));
  if (type === "restaurant") await seedRestaurant(s);
  else await seedShop(s);
  console.log(`[demo] ${d.username} → store ${s.id} reset`);
  return s.id;
}

let catPos = 0;
async function category(storeId: number, title: string, handle: string) {
  const [c] = await db.insert(catalogCategories).values({ storeId, title, handle, position: catPos++ }).returning({ id: catalogCategories.id });
  return c.id;
}

async function item(store: Store, input: Omit<ItemInput, "descriptionHtml" | "tags" | "options" | "status"> & Partial<Pick<ItemInput, "descriptionHtml" | "tags" | "options">>) {
  return saveItem(store, { descriptionHtml: "", tags: [], options: [], status: "active", kind: store.businessType, ...input });
}

// ---------------- Online store ----------------
async function seedShop(s: Store) {
  await db.update(stores).set({ codEnabled: true, storefrontEnabled: true }).where(eq(stores.id, s.id));
  const gadgets = await category(s.id, "Gadgets", "gadgets");
  const lifestyle = await category(s.id, "Lifestyle", "lifestyle");
  const digital = await category(s.id, "Digital downloads", "digital-downloads");
  const p = (k: string, title: string, cat: number, price: number, mrp: number | null, desc: string, extra: Record<string, unknown> = {}, opts?: { options: ItemInput["options"]; variants: VariantInput[] }) =>
    item(s, { title, images: img(k), categoryIds: [cat], descriptionHtml: `<p>${desc}</p>`, variants: opts?.variants ?? [v(price, mrp)], options: opts?.options ?? [], extra: { physical: true, ...extra } });
  await p("earbuds", "Wireless Earbuds", gadgets, 999, 1999, "Sample product for the demo store. Bluetooth earbuds with a charging case.");
  await p("band", "Fitness Band", gadgets, 1499, 2499, "Sample product for the demo store. Steps, sleep and heart-rate tracking.");
  await p("lamp", "Desk Lamp", gadgets, 799, 1199, "Sample product for the demo store. Three brightness levels, USB powered.");
  await p("tshirt", "Cotton T-Shirt", lifestyle, 499, 799, "Sample product for the demo store. Soft cotton, regular fit.", {}, {
    options: [{ name: "Size", values: ["S", "M", "L", "XL"] }],
    variants: ["S", "M", "L", "XL"].map((z) => v(499, 799, z, [z])),
  });
  await p("mug", "Ceramic Coffee Mug", lifestyle, 349, 499, "Sample product for the demo store. 350 ml, microwave safe.");
  await p("backpack", "Everyday Backpack", lifestyle, 1299, 1999, "Sample product for the demo store. Laptop sleeve and water-resistant fabric.");
  // Digital: no shipping, no COD, file unlocks after payment
  const files = await demoFile(s.id);
  await p("ebook", "Starter Guide (eBook)", digital, 99, 199, "Digital product: pay online and download the PDF right away from your order page. Cash on Delivery isn't offered for downloads.", { physical: false, files });
  await p("presets", "Photo Presets Pack", digital, 149, 299, "Digital product: a downloadable pack. Pay online, then download from your order page.", { physical: false, files });
}

/** A small PDF made here, stored privately like any digital product file. */
async function demoFile(storeId: number) {
  if (!mediaReady()) return [];
  const bytes = demoPdf([
    "Growpefy demo download",
    "",
    "This file was unlocked because the order was paid.",
    "Digital products: no shipping, no Cash on Delivery,",
    "and the download appears on the order page.",
  ]);
  const body = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(bytes); c.close(); } });
  const r = await uploadMedia(storeId, "application/pdf", body, bytes.length, { private: true });
  return [{ name: "Starter-Guide.pdf", key: r.key, bytes: r.bytes, mime: "application/pdf" }];
}

function demoPdf(lines: string[]) {
  const esc = (t: string) => t.replace(/[\\()]/g, (m) => `\\${m}`);
  const text = lines.map((l, i) => `BT /F1 ${i === 0 ? 22 : 13} Tf 60 ${740 - i * 26} Td (${esc(l)}) Tj ET`).join("\n");
  const objs = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${text.length} >>\nstream\n${text}\nendstream`,
  ];
  let out = "%PDF-1.4\n";
  const offs: number[] = [];
  objs.forEach((o, i) => { offs.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offs.map((n) => `${String(n).padStart(10, "0")} 00000 n \n`).join("")}`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(out);
}

// ---------------- Restaurant ----------------
async function seedRestaurant(s: Store) {
  const restaurant: RestaurantSettings = {
    modes: { delivery: true, takeaway: true, dineIn: true },
    hours: Array.from({ length: 7 }, () => ({ closed: false, slots: [{ open: "00:00", close: "23:59" }] })),
    pausedUntil: null, prepMinutes: 20,
    delivery: { radiusKm: 50, slabs: [{ upToKm: 3, fee: 20 }, { upToKm: 8, fee: 40 }, { upToKm: 50, fee: 60 }], freeAbove: 499, minOrder: 149, by: "own", partner: "", etaMinutes: 25 },
    takeawayMinOrder: 0,
    kitchen: { autoAccept: false, sound: true },
    location: { lat: 28.6315, lng: 77.2167, address: "Demo Kitchen, Connaught Place, New Delhi" },
    tables: Array.from({ length: 10 }, (_, i) => `T${i + 1}`),
  };
  await db.update(stores).set({ codEnabled: true, storefrontEnabled: true, restaurant }).where(eq(stores.id, s.id));
  const starters = await category(s.id, "Starters", "starters");
  const mains = await category(s.id, "Main Course", "main-course");
  const breads = await category(s.id, "Breads", "breads");
  const drinks = await category(s.id, "Beverages", "beverages");
  const desserts = await category(s.id, "Desserts", "desserts");
  type Dish = { k: string; t: string; c: number; p: number; mrp?: number; diet: "veg" | "nonveg" | "egg"; spicy?: number; best?: boolean; serves?: string; desc: string; addons?: unknown[]; portions?: [string, number][] };
  const dip = { name: "Dips", min: 0, max: 2, options: [{ name: "Mint chutney", price: 0 }, { name: "Garlic mayo", price: 20 }, { name: "Schezwan", price: 20 }] };
  const curry = { name: "Add extra", min: 0, max: 3, options: [{ name: "Extra butter", price: 30 }, { name: "Extra gravy", price: 40 }, { name: "Jeera rice", price: 80 }] };
  const dishes: Dish[] = [
    { k: "paneer-tikka", t: "Paneer Tikka", c: starters, p: 249, diet: "veg", spicy: 2, best: true, serves: "Serves 2", desc: "Chargrilled cottage cheese cubes with peppers and onion.", addons: [dip] },
    { k: "spring-roll", t: "Veg Spring Rolls", c: starters, p: 179, diet: "veg", spicy: 1, serves: "6 pieces", desc: "Crispy rolls stuffed with spiced vegetables.", addons: [dip] },
    { k: "chicken-wings", t: "Peri Peri Chicken Wings", c: starters, p: 299, diet: "nonveg", spicy: 3, serves: "8 pieces", desc: "Tossed in a tangy peri peri glaze.", addons: [dip] },
    { k: "dal-makhani", t: "Dal Makhani", c: mains, p: 229, diet: "veg", spicy: 1, best: true, serves: "Serves 1-2", desc: "Black lentils slow-cooked with butter and cream.", addons: [curry], portions: [["Half", 229], ["Full", 349]] },
    { k: "butter-chicken", t: "Butter Chicken", c: mains, p: 329, diet: "nonveg", spicy: 1, best: true, serves: "Serves 1-2", desc: "Tandoori chicken in a rich tomato and butter gravy.", addons: [curry], portions: [["Half", 329], ["Full", 499]] },
    { k: "veg-biryani", t: "Veg Dum Biryani", c: mains, p: 259, diet: "veg", spicy: 2, serves: "Serves 1", desc: "Fragrant basmati rice layered with vegetables. Comes with raita.",
      addons: [{ name: "Raita", min: 1, max: 1, options: [{ name: "Boondi raita", price: 0 }, { name: "Mixed veg raita", price: 0 }] }] },
    { k: "egg-curry", t: "Egg Curry", c: mains, p: 199, diet: "egg", spicy: 2, serves: "2 eggs", desc: "Boiled eggs in an onion-tomato masala." },
    { k: "naan", t: "Butter Naan", c: breads, p: 59, diet: "veg", desc: "Soft tandoor naan brushed with butter.", addons: [{ name: "Make it", min: 0, max: 1, options: [{ name: "Garlic naan", price: 15 }, { name: "Cheese naan", price: 40 }] }] },
    { k: "roti", t: "Tandoori Roti", c: breads, p: 25, diet: "veg", desc: "Whole wheat bread from the tandoor." },
    { k: "lassi", t: "Sweet Lassi", c: drinks, p: 99, diet: "veg", desc: "Chilled yogurt drink.", portions: [["Regular", 99], ["Large", 139]] },
    { k: "lime-soda", t: "Fresh Lime Soda", c: drinks, p: 79, diet: "veg", desc: "Sweet, salted or mixed.",
      addons: [{ name: "Taste", min: 1, max: 1, options: [{ name: "Sweet", price: 0 }, { name: "Salted", price: 0 }, { name: "Mixed", price: 0 }] }] },
    { k: "cold-coffee", t: "Cold Coffee", c: drinks, p: 129, diet: "veg", desc: "Blended with ice cream.", addons: [{ name: "Extras", min: 0, max: 1, options: [{ name: "Extra ice cream", price: 40 }] }] },
    { k: "gulab-jamun", t: "Gulab Jamun", c: desserts, p: 89, diet: "veg", best: true, serves: "2 pieces", desc: "Warm milk dumplings in sugar syrup." },
    { k: "brownie", t: "Chocolate Brownie", c: desserts, p: 149, diet: "egg", desc: "Fudgy brownie, served warm.", addons: [{ name: "Top it", min: 0, max: 1, options: [{ name: "Vanilla ice cream", price: 50 }] }] },
  ];
  for (const d of dishes) {
    const portions = d.portions ?? null;
    await item(s, {
      title: d.t, images: img(d.k), categoryIds: [d.c], descriptionHtml: `<p>${d.desc}</p>`,
      options: portions ? [{ name: "Portion", values: portions.map((x) => x[0]) }] : [],
      variants: portions ? portions.map(([n, pr]) => v(pr, null, n, [n])) : [v(d.p, d.mrp ?? null)],
      extra: { diet: d.diet, spicy: d.spicy ?? 0, bestseller: Boolean(d.best), serves: d.serves ?? "", soldOut: false, addons: d.addons ?? [], physical: true },
    });
  }
}
