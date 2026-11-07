// Growpefy Store website pages: policies, about, contact. Starter policies are created as drafts for the owner to check.
import { and, asc, eq, ilike, ne } from "drizzle-orm";
import { db, storePages, type Store } from "~/db.server";
import { toHandle } from "./business-types";

export async function listPages(storeId: number) {
  return db.select().from(storePages).where(eq(storePages.storeId, storeId)).orderBy(asc(storePages.position), asc(storePages.id));
}

export async function getPage(storeId: number, id: number) {
  const [p] = await db.select().from(storePages).where(and(eq(storePages.storeId, storeId), eq(storePages.id, id))).limit(1);
  return p ?? null;
}

export async function publishedPage(storeId: number, handle: string) {
  const [p] = await db.select().from(storePages).where(and(eq(storePages.storeId, storeId), eq(storePages.handle, handle), eq(storePages.published, true))).limit(1);
  return p ?? null;
}

/** Any page by handle, published or not (for the owner's preview). */
export async function pageByHandle(storeId: number, handle: string) {
  const [p] = await db.select().from(storePages).where(and(eq(storePages.storeId, storeId), eq(storePages.handle, handle))).limit(1);
  return p ?? null;
}

export async function footerPages(storeId: number) {
  return db.select({ title: storePages.title, handle: storePages.handle }).from(storePages)
    .where(and(eq(storePages.storeId, storeId), eq(storePages.published, true), eq(storePages.inFooter, true)))
    .orderBy(asc(storePages.position), asc(storePages.id));
}

async function freeHandle(storeId: number, wanted: string, exceptId?: number) {
  const base = toHandle(wanted);
  const rows = await db.select({ id: storePages.id, handle: storePages.handle }).from(storePages)
    .where(and(eq(storePages.storeId, storeId), ilike(storePages.handle, `${base}%`), exceptId ? ne(storePages.id, exceptId) : undefined));
  const used = new Set(rows.map((r) => r.handle));
  if (!used.has(base)) return base;
  for (let i = 2; ; i++) if (!used.has(`${base}-${i}`)) return `${base}-${i}`;
}

export type PageInput = {
  title: string; handle?: string; bodyHtml: string; published: boolean; inFooter: boolean;
  seoTitle?: string | null; seoDescription?: string | null; layout?: string; hideTitle?: boolean;
};

export async function savePage(storeId: number, input: PageInput, id?: number) {
  const title = input.title.trim().slice(0, 200);
  if (!title) throw new Error("Give the page a title.");
  if (input.bodyHtml.length > 200_000) throw new Error("The page is too long. Keep it under 200,000 characters.");
  const handle = await freeHandle(storeId, input.handle?.trim() || title, id);
  const values = {
    title, handle, bodyHtml: input.bodyHtml, published: input.published, inFooter: input.inFooter, updatedAt: new Date(),
    seoTitle: input.seoTitle?.trim().slice(0, 120) || null, seoDescription: input.seoDescription?.trim().slice(0, 320) || null,
    layout: input.layout === "wide" ? "wide" : "narrow", hideTitle: Boolean(input.hideTitle),
  };
  if (id) {
    await db.update(storePages).set(values).where(and(eq(storePages.storeId, storeId), eq(storePages.id, id)));
    return id;
  }
  const count = (await listPages(storeId)).length;
  const [r] = await db.insert(storePages).values({ ...values, storeId, position: count }).returning({ id: storePages.id });
  return r.id;
}

export async function deletePage(storeId: number, id: number) {
  await db.delete(storePages).where(and(eq(storePages.storeId, storeId), eq(storePages.id, id)));
}

// ---------- starter policies ----------

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

/** Plain starting text for the usual Indian D2C policies. Created as drafts: the owner checks and edits before publishing. */
function starters(store: Store, email: string | null) {
  const name = esc(store.name);
  const contact = [store.supportPhone ? `phone or WhatsApp <b>${esc(store.supportPhone)}</b>` : "", email ? `email <b>${esc(email)}</b>` : ""].filter(Boolean).join(" or ") || "[ADD YOUR PHONE AND EMAIL]";
  return [
    {
      title: "Shipping policy",
      body: `<p>${name} ships across India.</p>
<ul><li>Orders are packed and handed to the courier within <b>[1–2] working days</b>.</li>
<li>Delivery usually takes <b>[3–7] working days</b> after dispatch, depending on your pincode.</li>
<li>You get the tracking link on WhatsApp/SMS once your order ships.</li>
<li>Cash on delivery is available on most pincodes. Some orders may need a confirmation before dispatch.</li></ul>
<p>For any delivery question, contact us on ${contact}.</p>`,
    },
    {
      title: "Returns & refunds",
      body: `<p>If something is wrong with your order, tell us within <b>[7] days</b> of delivery.</p>
<ul><li>Items must be unused, with tags and original packaging.</li>
<li>Damaged or wrong items: send a photo or unboxing video and we will replace or refund it.</li>
<li>Refunds for prepaid orders go back to the original payment method within <b>[5–7] working days</b> after we receive the item. For COD orders we refund to your bank account or UPI.</li>
<li>[ADD ANY ITEMS THAT CAN'T BE RETURNED]</li></ul>
<p>To start a return, contact us on ${contact} with your order number.</p>`,
    },
    {
      title: "Privacy policy",
      body: `<p>${name} collects only what is needed to deliver your order and support you: your name, phone number, email, delivery address and order details.</p>
<ul><li>Payments are processed by our payment partners; we do not store your card or UPI details.</li>
<li>We share your delivery details only with courier and service partners who help fulfil your order.</li>
<li>We may send order updates and, if you agree, offers on WhatsApp, SMS or email. You can opt out at any time.</li>
<li>Our website uses cookies and similar tools to keep your cart and measure ads.</li></ul>
<p>To see, correct or delete your data, contact us on ${contact}.</p>`,
    },
    {
      title: "Terms of service",
      body: `<p>By ordering from ${name} you agree to these terms.</p>
<ul><li>Prices are in Indian rupees and include GST unless stated otherwise.</li>
<li>We may cancel an order if an item is out of stock, the price was shown wrongly, or the order looks fraudulent. Any amount paid is refunded.</li>
<li>Product photos are for illustration; small differences in colour may occur.</li>
<li>These terms are governed by the laws of India. [ADD YOUR CITY] courts have jurisdiction.</li></ul>
<p>Business name: <b>[YOUR REGISTERED BUSINESS NAME]</b> · Address: <b>[YOUR BUSINESS ADDRESS]</b> · Contact: ${contact}.</p>`,
    },
    {
      title: "Contact us",
      body: `<p>We're happy to help with orders, delivery and returns.</p><p>Contact: ${contact}</p><p>Hours: <b>[Mon–Sat, 10 am – 7 pm]</b></p>`,
    },
  ];
}

/** Adds the starter policies that the store doesn't have yet (by handle). Returns how many were added. */
export async function addStarterPages(store: Store, email: string | null) {
  const have = new Set((await listPages(store.id)).map((p) => p.handle));
  let added = 0;
  for (const s of starters(store, email)) {
    if (have.has(toHandle(s.title))) continue;
    await savePage(store.id, { title: s.title, bodyHtml: s.body, published: false, inFooter: true });
    added++;
  }
  return added;
}
