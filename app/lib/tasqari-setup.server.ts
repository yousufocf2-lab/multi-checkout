// One-time setup of Tasqari's website (store 23): its own colours, honest home page (no demo creators, blog posts,
// awards or countdowns), header/footer menus where every page appears once, and its own pages.
// Runs only while Tasqari has no pages, so it never overwrites edits made later in the editor.
import { and, eq } from "drizzle-orm";
import crypto from "node:crypto";
import { db, storeMenus, storePages, storeThemes, type MenuItem, type ThemeData } from "~/db.server";

const STORE = 23;
const id = () => crypto.randomBytes(5).toString("hex");

const COLORS = {
  color_brand: "#0e7c66", // deep teal
  color_pop: "#ffb547", // warm amber
  color_button: "#0b1f1a",
  color_button_text: "#ffffff",
  color_text: "#0b1f1a",
  color_soft: "#eef6f3",
  color_line: "#dce8e3",
  color_footer_bg: "#0b1f1a",
  color_footer_text: "#e7f3ef",
};

const PAGES: { title: string; handle: string; published: boolean; body: string }[] = [
  {
    title: "About us", handle: "about-us", published: true,
    body: `<h2>Everyday tech that just works</h2>
<p>Tasqari is about the gadgets you reach for every day: earbuds for the commute, a smartwatch for calls and steps, headphones for long work sessions and a speaker for the weekend. We keep the range focused, the prices fair and the support simple.</p>
<h3>What you can expect from us</h3>
<ul>
<li><strong>A focused range.</strong> Audio and wearables only, so we know each product well and can help you choose.</li>
<li><strong>Clear prices.</strong> The price you see includes taxes. Any delivery charge is shown before you pay.</li>
<li><strong>Help after you buy.</strong> A 1-year warranty against manufacturing defects and a 7-day replacement if something arrives damaged or faulty.</li>
<li><strong>Pay your way.</strong> UPI, cards, net banking, or cash on delivery.</li>
</ul>
<p>Have a question before you order? Write to us and we'll help you pick the right product.</p>`,
  },
  {
    title: "Shipping policy", handle: "shipping-policy", published: true,
    body: `<h2>Shipping policy</h2>
<h3>Where we deliver</h3>
<p>We ship across India to every pin code our courier partners serve. Enter your pin code on a product page to see if delivery is available.</p>
<h3>When your order arrives</h3>
<ul>
<li>We pack and hand over orders to the courier as quickly as possible, usually within 1–2 working days.</li>
<li>Most orders reach you within 3–7 working days, depending on your city.</li>
<li>Once your order ships, you get the tracking details by SMS or WhatsApp. You can also see the status under <em>Track your order</em>.</li>
</ul>
<h3>Delivery charges</h3>
<p>If there is a delivery charge, you see it at checkout before you pay. Nothing is added later.</p>
<h3>Cash on delivery</h3>
<p>Cash on delivery is available for most pin codes and order values. You'll see it as a payment option at checkout when it's available for your address.</p>
<h3>If your order is late</h3>
<p>Festivals, weather or courier delays can sometimes slow things down. If your order hasn't arrived in the time shown, contact us with your order number and we'll chase it for you.</p>`,
  },
  {
    title: "Returns & replacement", handle: "returns-replacement", published: true,
    body: `<h2>Returns, replacement and refunds</h2>
<h3>7-day replacement</h3>
<p>If your product arrives damaged, doesn't work, or isn't what you ordered, ask for a replacement within <strong>7 days of delivery</strong>.</p>
<h3>How to ask for a replacement</h3>
<ol>
<li>Send us your order number, a short note about the problem and a clear photo or video.</li>
<li>We check it and reply, usually within 2 working days.</li>
<li>We arrange a pickup where the courier serves your pin code, or tell you how to send the product back.</li>
</ol>
<h3>What we need back</h3>
<ul>
<li>The product with its box, accessories and invoice.</li>
<li>Earbuds and other in-ear products are replaced only for a manufacturing defect, for hygiene reasons.</li>
<li>Damage after delivery (drops, cracks, water) isn't covered.</li>
</ul>
<h3>Refunds</h3>
<p>If we can't replace the product, we refund you. Prepaid orders go back to the original payment method. Cash on delivery orders are refunded to your bank account or UPI ID. Refunds are usually made within 5–7 working days after the product reaches us and is checked.</p>
<h3>Cancelling an order</h3>
<p>You can cancel any time before your order ships. After it ships, please accept the parcel and ask for a return if something is wrong.</p>`,
  },
  {
    title: "Warranty", handle: "warranty", published: true,
    body: `<h2>Warranty</h2>
<p>Our earbuds, smartwatches, headphones, neckbands, speakers and power banks come with a <strong>1-year warranty</strong> against manufacturing defects, counted from the day of delivery, unless the product page says otherwise.</p>
<h3>Covered</h3>
<ul>
<li>Defects in parts or workmanship</li>
<li>Charging, pairing, sound or display problems caused by a defect</li>
</ul>
<h3>Not covered</h3>
<ul>
<li>Physical damage, cracks, water or liquid damage, burns</li>
<li>Damage from a wrong charger, opening or repairing the product elsewhere</li>
<li>Normal wear, like scratches, faded colour, worn straps or ear tips</li>
</ul>
<h3>How to claim</h3>
<p>Send us your order number with a short description and a photo or video of the problem. We'll tell you the next step: a repair or a replacement.</p>`,
  },
  {
    title: "FAQs", handle: "faqs", published: true,
    body: `<h2>Frequently asked questions</h2>
<h3>How long will delivery take?</h3>
<p>Usually 3–7 working days after your order ships. You get tracking details by SMS or WhatsApp.</p>
<h3>Can I pay cash on delivery?</h3>
<p>Yes, for most pin codes and order values. If it's available for your address, you'll see it at checkout.</p>
<h3>Which payment methods do you accept?</h3>
<p>UPI, RuPay, Visa and Mastercard cards, net banking, and cash on delivery.</p>
<h3>My product arrived damaged. What now?</h3>
<p>Ask for a replacement within 7 days of delivery. See <a href="/pages/returns-replacement">Returns &amp; replacement</a>.</p>
<h3>Is there a warranty?</h3>
<p>Yes, 1 year against manufacturing defects. See <a href="/pages/warranty">Warranty</a>.</p>
<h3>How do I track my order?</h3>
<p>Use the link in your shipping message, or open <a href="/account">Track your order</a> and sign in with your mobile number.</p>
<h3>Can I cancel my order?</h3>
<p>Yes, any time before it ships. Contact us with your order number.</p>`,
  },
  {
    title: "Terms & conditions", handle: "terms-conditions", published: true,
    body: `<h2>Terms &amp; conditions</h2>
<p>By using this website or placing an order, you agree to these terms.</p>
<h3>Products and prices</h3>
<p>We show every product, colour and price as accurately as we can. Colours can look a little different on different screens. Prices include applicable taxes unless stated and may change without notice. If a product is listed at a clearly wrong price, we may cancel the order and refund anything you paid.</p>
<h3>Orders</h3>
<p>Your order is confirmed when you receive our confirmation message. We may cancel an order if a product is out of stock, your address can't be served, or the order looks fraudulent. Any amount paid is refunded in full.</p>
<h3>Payments</h3>
<p>Online payments are handled by secure payment partners. We never see or store your card or UPI details.</p>
<h3>Shipping, returns and warranty</h3>
<p>Our <a href="/pages/shipping-policy">Shipping policy</a>, <a href="/pages/returns-replacement">Returns &amp; replacement</a> and <a href="/pages/warranty">Warranty</a> pages are part of these terms.</p>
<h3>Website content</h3>
<p>Text, photos and the Tasqari name on this website belong to Tasqari and may not be copied without permission.</p>
<h3>Liability</h3>
<p>For any order, our liability is limited to the amount you paid for that product.</p>
<h3>Law</h3>
<p>These terms are governed by the laws of India.</p>`,
  },
  {
    title: "Privacy policy", handle: "privacy-policy", published: true,
    body: `<h2>Privacy policy</h2>
<p>This page explains what information we collect when you shop with Tasqari and how we use it.</p>
<h3>What we collect</h3>
<ul>
<li>Your name, mobile number, email and delivery address when you place an order</li>
<li>Your order and payment status (we never store card or UPI details)</li>
<li>Basic browsing data, like pages you visit, to improve the website and our ads</li>
</ul>
<h3>How we use it</h3>
<ul>
<li>To process, ship and support your orders</li>
<li>To send order and delivery updates by SMS, WhatsApp or email</li>
<li>To send offers only if you've agreed to get them; you can stop them any time</li>
<li>To measure and improve the website and our advertising</li>
</ul>
<h3>Who we share it with</h3>
<p>Only the partners who help us run the store, such as payment gateways and courier companies, and only what they need. We never sell your personal information.</p>
<h3>Cookies</h3>
<p>We use cookies for the cart, checkout and analytics. You can control cookies in your browser settings.</p>
<h3>Your choices</h3>
<p>You can ask us to correct or delete your information at any time.</p>`,
  },
  {
    // Not published until the real email / phone / address are filled in
    title: "Contact us", handle: "contact-us", published: false,
    body: `<h2>We're here to help</h2>
<p>Questions about an order, a product or your warranty? Message us and we'll get back to you within one working day.</p>
<ul>
<li><strong>Email:</strong> [ADD SUPPORT EMAIL]</li>
<li><strong>WhatsApp / phone:</strong> [ADD SUPPORT NUMBER]</li>
<li><strong>Hours:</strong> Monday to Saturday, 10 am – 7 pm</li>
<li><strong>Address:</strong> [ADD BUSINESS ADDRESS]</li>
</ul>
<p>Keep your order number handy so we can help you faster.</p>`,
  },
];

const search = (q: string) => `/search?q=${encodeURIComponent(q)}`;
const page = (title: string, ref: string): MenuItem => ({ id: id(), title, kind: "page", ref });
const url = (title: string, u: string): MenuItem => ({ id: id(), title, kind: "url", url: u });

const MENUS: { title: string; handle: string; inHeader: boolean; inFooter: boolean; items: MenuItem[] }[] = [
  { title: "Main menu", handle: "main-menu", inHeader: true, inFooter: false, items: [
    { id: id(), title: "Shop all", kind: "all" }, url("Earbuds", search("Earbuds")), url("Smartwatches", search("Smartwatch")),
    url("Headphones", search("Headphones")), url("Speakers", search("Speaker")), page("About us", "about-us"),
  ] },
  { title: "Shop", handle: "shop", inHeader: false, inFooter: false, items: [
    { id: id(), title: "All products", kind: "all" }, url("Earbuds", search("Earbuds")), url("Smartwatches", search("Smartwatch")),
    url("Headphones", search("Headphones")), url("Speakers", search("Speaker")), url("Neckbands", search("Neckband")), url("Power banks", search("Power bank")),
  ] },
  { title: "Help", handle: "footer", inHeader: false, inFooter: true, items: [
    url("Track your order", "/account"), page("Shipping policy", "shipping-policy"), page("Returns & replacement", "returns-replacement"),
    page("Warranty", "warranty"), page("FAQs", "faqs"),
  ] },
  { title: "Company", handle: "company", inHeader: false, inFooter: false, items: [
    page("About us", "about-us"), page("Terms & conditions", "terms-conditions"), page("Privacy policy", "privacy-policy"),
  ] },
];

function design(cur: ThemeData): ThemeData {
  const d: ThemeData = JSON.parse(JSON.stringify(cur));
  d.settings = {
    ...d.settings, ...COLORS,
    pdp_social_proof: "", // no made-up "people ordered" line
    seo_home_title: "Tasqari – Earbuds, Smartwatches, Headphones & Speakers",
    seo_home_description: "Shop Tasqari earbuds, smartwatches, headphones, neckbands, speakers and power banks. 1-year warranty, 7-day replacement and cash on delivery across India.",
  };
  // Header: honest offer bar (no countdown), no "new drops every Friday" promise
  d.groups.header.sections.deal = { type: "deal-bar", settings: {
    label: "", show_timer: false, bg: "#0b1f1a", text_color: "#e7f3ef",
    messages: [{ text: "1-year warranty on audio and wearables" }, { text: "7-day replacement" }, { text: "Cash on delivery available" }, { text: "Pay by UPI, cards or net banking" }],
  } };
  d.groups.header.sections.header = { type: "header", settings: {
    ...(d.groups.header.sections.header?.settings ?? {}), mega_promo_title: "", mega_promo_color: COLORS.color_brand,
    search_words: "Earbuds, Smartwatch, Headphones, Speaker, Neckband, Power bank",
  } };
  // Footer: three columns, every page once; nothing extra at the bottom
  d.groups.footer.sections.footer = { type: "footer", settings: {
    about: "Earbuds, smartwatches, headphones and speakers for everyday life.",
    columns: [{ heading: "Shop", menu: "shop" }, { heading: "Help", menu: "footer" }, { heading: "Company", menu: "company" }],
    legal_menu: "", show_newsletter: true, news_heading: "New launches and offers, first", news_text: "One email when something new lands. No spam.",
  } };
  // Home: no stock-photo creators, blog posts that go nowhere, awards or demo products
  d.templates.index = {
    order: ["hero", "usp", "new", "best", "deals", "track", "pay"],
    sections: {
      hero: { type: "image-banner", settings: {
        heading: "<b>Sound that moves with you</b>", text: "Earbuds, smartwatches, headphones and speakers for everyday life.",
        button: "Shop all", link: "/products/all", color_a: "#0b1f1a", color_b: COLORS.color_brand, text_color: "#ffffff", full_width: false,
      } },
      usp: { type: "usp-tiles", settings: {
        eyebrow: "Why Tasqari", heading: "Simple to buy. Easy to trust.", text: "",
        items: [
          { icon: "shield", title: "1-year warranty", text: "Against manufacturing defects." },
          { icon: "refresh", title: "7-day replacement", text: "Damaged or faulty? We replace it." },
          { icon: "cash", title: "Cash on delivery", text: "Pay when it reaches you." },
          { icon: "lock", title: "Secure payments", text: "UPI, cards and net banking." },
        ],
      } },
      new: { type: "product-carousel", settings: { label: "New", eyebrow: "Just landed", heading: "New arrivals" } },
      best: { type: "product-carousel", settings: { label: "", eyebrow: "Most picked", heading: "Bestsellers" } },
      deals: { type: "product-carousel", settings: { label: "Deal", eyebrow: "Prices you'll like", heading: "Deals of the week" } },
      track: { type: "image-banner", settings: { heading: "<b>Already ordered?</b><br>Track it in one tap", button: "Track my order", link: "/account", color_a: "#0b1f1a", color_b: COLORS.color_brand, full_width: false } },
      pay: { type: "payment-logos", settings: {} },
    },
  };
  return d;
}

let ran = false;
export async function setupTasqari() {
  if (ran) return;
  ran = true;
  try {
    const existing = await db.select({ id: storePages.id }).from(storePages).where(eq(storePages.storeId, STORE)).limit(1);
    if (existing.length) return; // already set up (or edited by the owner)
    const [t] = await db.select().from(storeThemes).where(eq(storeThemes.storeId, STORE)).limit(1);
    if (!t?.live) { console.warn("[tasqari-setup] no theme yet"); return; }
    let pos = 0;
    for (const p of PAGES) {
      await db.insert(storePages).values({ storeId: STORE, title: p.title, handle: p.handle, bodyHtml: p.body, published: p.published, inFooter: false, position: pos++, layout: "narrow" }).onConflictDoNothing();
    }
    for (const m of MENUS) {
      const [row] = await db.select({ id: storeMenus.id }).from(storeMenus).where(and(eq(storeMenus.storeId, STORE), eq(storeMenus.handle, m.handle))).limit(1);
      if (row) await db.update(storeMenus).set({ title: m.title, items: m.items, inHeader: m.inHeader, inFooter: m.inFooter, updatedAt: new Date() }).where(eq(storeMenus.id, row.id));
      else await db.insert(storeMenus).values({ storeId: STORE, ...m });
    }
    const live = design(t.live);
    const history = [{ at: new Date().toISOString(), by: "Growpefy", data: t.live }, ...(t.history ?? [])].slice(0, 10);
    await db.update(storeThemes).set({ live, draft: live, history, updatedAt: new Date(), publishedAt: new Date() }).where(eq(storeThemes.storeId, STORE));
    console.log(`[tasqari-setup] done: ${PAGES.length} pages, ${MENUS.length} menus, new colours, footer and home page`);
  } catch (e) {
    console.error("[tasqari-setup]", e instanceof Error ? e.message : e);
  }
}
