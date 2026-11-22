// One-time: turn Tasqari (store 23) into a PC-parts store — graphics cards, processors, motherboards, RAM, storage,
// power supplies, cabinets, coolers, monitors, keyboards and mice. Sample products use our own illustrations
// (public/tasqari-samples), no brand names or other companies' photos. Runs only while the store has no
// "graphics-cards" category, and never deletes or edits a product the owner made.
import { and, eq, inArray } from "drizzle-orm";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { catalogCategories, catalogItems, db, storeMenus, storePages, stores, storeThemes, type MenuItem, type ThemeData } from "~/db.server";
import { saveItem } from "~/lib/catalog.server";
import { env } from "~/lib/env.server";
import { uploadMedia } from "~/lib/media.server";

const STORE = 23;
const id = () => crypto.randomBytes(5).toString("hex");

// ---- categories (sub-categories are their own categories, grouped under a parent in the menus) ----
type Cat = { handle: string; title: string; image: string; parent?: string; text: string };
const CATS: Cat[] = [
  { handle: "graphics-cards", title: "Graphics cards", image: "gpu-3fan", text: "Gaming and creator graphics cards." },
  { handle: "components", title: "Components", image: "motherboard", text: "Processors, motherboards, RAM, power supplies, cabinets and coolers." },
  { handle: "processors", title: "Processors", image: "cpu", text: "Desktop processors for gaming and work." },
  { handle: "motherboards", title: "Motherboards", image: "motherboard", text: "ATX and Micro-ATX motherboards." },
  { handle: "ram", title: "RAM", image: "ram", text: "DDR4 and DDR5 desktop memory." },
  { handle: "storage", title: "Storage", image: "ssd-nvme", text: "SSDs, internal and external hard disks." },
  { handle: "ssd", title: "SSD", image: "ssd-nvme", parent: "storage", text: "NVMe and SATA solid state drives." },
  { handle: "internal-hard-disks", title: "Internal hard disks", image: "hdd-35", parent: "storage", text: "3.5-inch and 2.5-inch hard disks." },
  { handle: "external-hard-disks", title: "External hard disks", image: "hdd-external", parent: "storage", text: "Portable USB hard disks." },
  { handle: "power-supplies", title: "Power supplies", image: "psu-850", text: "80+ certified power supplies." },
  { handle: "cabinets", title: "Cabinets", image: "cabinet", text: "PC cabinets with airflow and glass panels." },
  { handle: "cpu-coolers", title: "CPU coolers", image: "cooler", text: "Air and liquid CPU coolers." },
  { handle: "monitors", title: "Monitors", image: "monitor", text: "High refresh rate gaming monitors." },
  { handle: "keyboards-mice", title: "Keyboards & mice", image: "keyboard", text: "Gaming keyboards and mice." },
  { handle: "keyboards", title: "Keyboards", image: "keyboard", parent: "keyboards-mice", text: "Mechanical and gaming keyboards." },
  { handle: "mice", title: "Mice", image: "mouse-wireless", parent: "keyboards-mice", text: "Wired and wireless gaming mice." },
];

// ---- sample products: stock 10, active ----
type P = { title: string; cats: string[]; image: string; price: number; mrp?: number; tags?: string[]; specs: [string, string][]; about: string; weight: number };
const PRODUCTS: P[] = [
  { title: "8GB GDDR6 Dual-Fan Gaming Graphics Card", cats: ["graphics-cards"], image: "gpu-2fan", price: 28999, mrp: 32999, tags: ["New"], weight: 1400,
    about: "A compact dual-fan card for smooth 1080p gaming and everyday creative work.",
    specs: [["Memory", "8GB GDDR6, 128-bit"], ["Interface", "PCIe 4.0 x8"], ["Outputs", "3× DisplayPort 1.4a, 1× HDMI 2.1"], ["Power", "1× 8-pin, 550W PSU recommended"], ["Length", "About 250 mm, 2 slots"]] },
  { title: "12GB GDDR6X Triple-Fan Graphics Card", cats: ["graphics-cards"], image: "gpu-3fan", price: 54999, mrp: 59999, tags: ["Bestseller"], weight: 1900,
    about: "A triple-fan card with headroom for 1440p gaming, streaming and 3D work.",
    specs: [["Memory", "12GB GDDR6X, 192-bit"], ["Interface", "PCIe 4.0 x16"], ["Outputs", "3× DisplayPort 1.4a, 1× HDMI 2.1"], ["Power", "1× 16-pin, 750W PSU recommended"], ["Length", "About 300 mm, 2.5 slots"]] },
  { title: "6-Core 12-Thread Desktop Processor (AM5)", cats: ["components", "processors"], image: "cpu", price: 15499, mrp: 17999, weight: 300,
    about: "A 6-core processor that handles gaming, streaming and multitasking with ease.",
    specs: [["Cores / threads", "6 / 12"], ["Boost clock", "Up to 5.1 GHz"], ["Socket", "AM5"], ["Memory support", "DDR5"], ["Cooler", "Not included"]] },
  { title: "8-Core 16-Thread Desktop Processor (LGA1700)", cats: ["components", "processors"], image: "cpu", price: 27999, mrp: 31499, tags: ["New"], weight: 300,
    about: "Eight fast cores for high-FPS gaming and heavy work like editing and rendering.",
    specs: [["Cores / threads", "8 / 16"], ["Boost clock", "Up to 5.2 GHz"], ["Socket", "LGA1700"], ["Memory support", "DDR4 and DDR5"], ["Cooler", "Not included"]] },
  { title: "B650 ATX Motherboard with Wi-Fi", cats: ["components", "motherboards"], image: "motherboard", price: 16999, mrp: 18999, weight: 1500,
    about: "A full-size AM5 board with Wi-Fi, fast storage slots and room to grow.",
    specs: [["Socket", "AM5"], ["Form factor", "ATX"], ["Memory", "4× DDR5 slots, up to 192GB"], ["Storage", "2× M.2 (PCIe 4.0), 4× SATA"], ["Network", "Wi-Fi 6, 2.5G LAN, Bluetooth"]] },
  { title: "B760M Micro-ATX DDR5 Motherboard", cats: ["components", "motherboards"], image: "motherboard", price: 11499, mrp: 12999, weight: 1100,
    about: "A compact LGA1700 board for small and mid-size builds.",
    specs: [["Socket", "LGA1700"], ["Form factor", "Micro-ATX"], ["Memory", "2× DDR5 slots, up to 96GB"], ["Storage", "2× M.2, 4× SATA"], ["Network", "1G LAN"]] },
  { title: "16GB DDR5 5600MHz Desktop RAM", cats: ["components", "ram"], image: "ram", price: 4999, mrp: 5799, weight: 60,
    about: "Fast DDR5 memory with a low-profile heat spreader that fits most coolers.",
    specs: [["Capacity", "16GB (1× 16GB)"], ["Type", "DDR5 desktop (UDIMM)"], ["Speed", "5600 MHz"], ["Latency", "CL36"], ["Voltage", "1.25V"]] },
  { title: "32GB (2×16GB) DDR4 3200MHz RGB RAM Kit", cats: ["components", "ram"], image: "ram-kit", price: 7499, mrp: 8999, tags: ["Bestseller"], weight: 120,
    about: "A dual-channel 32GB kit with RGB lighting for gaming and creator PCs.",
    specs: [["Capacity", "32GB (2× 16GB)"], ["Type", "DDR4 desktop (UDIMM)"], ["Speed", "3200 MHz"], ["Latency", "CL16"], ["Lighting", "Addressable RGB"]] },
  { title: "1TB NVMe Gen4 M.2 SSD", cats: ["storage", "ssd"], image: "ssd-nvme", price: 6499, mrp: 7999, tags: ["Bestseller"], weight: 30,
    about: "Fast boot and load times with PCIe Gen4 speeds in a slim M.2 stick.",
    specs: [["Capacity", "1TB"], ["Interface", "PCIe 4.0 x4, NVMe"], ["Form factor", "M.2 2280"], ["Read / write", "Up to 7000 / 6000 MB/s"], ["Endurance", "600 TBW"]] },
  { title: "512GB 2.5-inch SATA SSD", cats: ["storage", "ssd"], image: "ssd-sata", price: 2799, mrp: 3299, weight: 60,
    about: "An easy upgrade that makes an older PC or laptop feel new again.",
    specs: [["Capacity", "512GB"], ["Interface", "SATA III (6 Gb/s)"], ["Form factor", "2.5-inch, 7 mm"], ["Read / write", "Up to 550 / 500 MB/s"]] },
  { title: "2TB 7200 RPM 3.5-inch Internal Hard Disk", cats: ["storage", "internal-hard-disks"], image: "hdd-35", price: 5299, mrp: 5999, weight: 650,
    about: "Lots of space for games, photos and backups in your desktop.",
    specs: [["Capacity", "2TB"], ["Speed", "7200 RPM"], ["Cache", "256MB"], ["Interface", "SATA III (6 Gb/s)"], ["Size", "3.5-inch desktop"]] },
  { title: "1TB 2.5-inch Laptop Hard Disk", cats: ["storage", "internal-hard-disks"], image: "hdd-25", price: 3499, mrp: 3999, weight: 110,
    about: "A 2.5-inch drive for laptops, consoles and small PCs.",
    specs: [["Capacity", "1TB"], ["Speed", "5400 RPM"], ["Interface", "SATA III (6 Gb/s)"], ["Size", "2.5-inch, 7 mm"]] },
  { title: "1TB USB 3.2 Portable External Hard Disk", cats: ["storage", "external-hard-disks"], image: "hdd-external", price: 4599, mrp: 5299, weight: 220,
    about: "A pocket-size drive for backups and moving files between devices.",
    specs: [["Capacity", "1TB"], ["Connection", "USB 3.2 Gen 1 (cable included)"], ["Works with", "Windows, macOS, consoles"], ["Power", "From the USB port"]] },
  { title: "2TB USB 3.2 Portable External Hard Disk", cats: ["storage", "external-hard-disks"], image: "hdd-external", price: 6299, mrp: 7199, weight: 230,
    about: "Twice the space in the same pocket-size body.",
    specs: [["Capacity", "2TB"], ["Connection", "USB 3.2 Gen 1 (cable included)"], ["Works with", "Windows, macOS, consoles"], ["Power", "From the USB port"]] },
  { title: "650W 80+ Bronze Power Supply", cats: ["components", "power-supplies"], image: "psu-650", price: 4299, mrp: 4999, weight: 1800,
    about: "Steady, efficient power for mid-range gaming builds.",
    specs: [["Wattage", "650W"], ["Efficiency", "80+ Bronze"], ["Cables", "Non-modular"], ["Fan", "120 mm, quiet"], ["Protections", "OVP, UVP, OCP, OPP, SCP"]] },
  { title: "850W 80+ Gold Fully Modular Power Supply", cats: ["components", "power-supplies"], image: "psu-850", price: 9999, mrp: 11499, tags: ["New"], weight: 2100,
    about: "Plenty of power for high-end graphics cards, with only the cables you need.",
    specs: [["Wattage", "850W"], ["Efficiency", "80+ Gold"], ["Cables", "Fully modular"], ["Fan", "135 mm, quiet mode"], ["Protections", "OVP, UVP, OCP, OPP, OTP, SCP"]] },
  { title: "Mid-Tower ATX Cabinet with Tempered Glass", cats: ["components", "cabinets"], image: "cabinet", price: 4999, mrp: 5999, weight: 6500,
    about: "Good airflow, a glass side panel and room for long graphics cards.",
    specs: [["Fits", "ATX, Micro-ATX, Mini-ITX"], ["Fans included", "3× 120 mm ARGB front"], ["GPU length", "Up to 360 mm"], ["Front ports", "USB 3.0, USB-C, audio"]] },
  { title: "240mm ARGB Liquid CPU Cooler", cats: ["components", "cpu-coolers"], image: "cooler", price: 6999, mrp: 7999, weight: 1300,
    about: "Keeps hot processors cool and quiet, with lighting on the pump and fans.",
    specs: [["Radiator", "240 mm"], ["Fans", "2× 120 mm ARGB"], ["Sockets", "LGA1700, AM5, AM4"], ["Lighting", "Addressable RGB"]] },
  { title: "27-inch QHD 165Hz IPS Gaming Monitor", cats: ["monitors"], image: "monitor", price: 18999, mrp: 22999, tags: ["New"], weight: 6000,
    about: "Sharp 1440p picture and smooth motion for fast games.",
    specs: [["Size", "27-inch"], ["Resolution", "2560 × 1440 (QHD)"], ["Refresh rate", "165 Hz"], ["Panel", "IPS, 1 ms (GtG)"], ["Inputs", "2× HDMI 2.0, 1× DisplayPort 1.4"]] },
  { title: "Mechanical RGB Gaming Keyboard", cats: ["keyboards-mice", "keyboards"], image: "keyboard", price: 2499, mrp: 2999, weight: 900,
    about: "Clicky mechanical switches and per-key lighting.",
    specs: [["Switches", "Blue (clicky)"], ["Layout", "Full size, 104 keys"], ["Lighting", "Per-key RGB"], ["Connection", "USB, braided cable"]] },
  { title: "Wireless Gaming Mouse 16000 DPI", cats: ["keyboards-mice", "mice"], image: "mouse-wireless", price: 1799, mrp: 2199, weight: 120,
    about: "A light wireless mouse with an accurate sensor and long battery life.",
    specs: [["Sensor", "Optical, up to 16000 DPI"], ["Connection", "2.4 GHz wireless and Bluetooth"], ["Battery", "Rechargeable, USB-C"], ["Buttons", "6, programmable"]] },
  { title: "Wired RGB Gaming Mouse", cats: ["keyboards-mice", "mice"], image: "mouse-wired", price: 899, mrp: 1199, weight: 110,
    about: "A comfortable wired mouse with adjustable DPI and RGB lighting.",
    specs: [["Sensor", "Optical, up to 7200 DPI"], ["Connection", "USB, braided cable"], ["Buttons", "6"], ["Lighting", "RGB"]] },
];

const describe = (p: P) =>
  `<p>${p.about}</p><h3>Specifications</h3><ul>${p.specs.map(([k, v]) => `<li><strong>${k}:</strong> ${v}</li>`).join("")}</ul>` +
  `<p>Check that this part fits your build (socket, size and power) before you order. Not sure? Write to us and we'll help.</p>`;

// ---- pages: rewrite the ones that still talk about audio ----
const PAGE_BODIES: Record<string, string> = {
  "about-us": `<h2>PC parts, without the guesswork</h2>
<p>Tasqari sells the parts you need to build or upgrade a computer: graphics cards, processors, motherboards, RAM, SSDs and hard disks, power supplies, cabinets, coolers, monitors, keyboards and mice.</p>
<h3>What you can expect from us</h3>
<ul>
<li><strong>Clear specifications.</strong> Every product lists the details that decide whether it fits your build: socket, size, power and connections.</li>
<li><strong>Help choosing.</strong> Not sure a graphics card fits your cabinet or your power supply is enough? Ask us before you order.</li>
<li><strong>Careful packing.</strong> Parts are packed to survive the journey, and anything that arrives damaged or dead is replaced.</li>
<li><strong>Pay your way.</strong> UPI, cards, net banking, or cash on delivery where available.</li>
</ul>`,
  warranty: `<h2>Warranty</h2>
<p>Products come with the manufacturer's warranty for the period shown on the product page or the invoice, counted from the date of delivery.</p>
<h3>How to claim</h3>
<p>Many brands handle warranty directly at their service centres. Send us your order number with a short description and a photo or video of the problem, and we'll tell you where to go and help with the claim, or arrange it through us where we can.</p>
<h3>Usually not covered</h3>
<ul>
<li>Physical damage, burns, bent pins or liquid damage</li>
<li>Damage from a faulty power supply, overclocking beyond the maker's limits or modifying the product</li>
<li>Removed or damaged serial number stickers</li>
</ul>
<p>Keep the box and invoice safe: most brands ask for them for a warranty claim.</p>`,
  "returns-replacement": `<h2>Returns, replacement and refunds</h2>
<h3>Dead or damaged on arrival</h3>
<p>If a product arrives damaged, doesn't work, or isn't what you ordered, tell us within <strong>7 days of delivery</strong> and we'll replace it.</p>
<h3>How to ask</h3>
<ol>
<li>Send your order number, a short note about the problem and a clear photo or video (an unboxing video helps a lot).</li>
<li>We check and reply, usually within 2 working days.</li>
<li>We arrange a pickup where the courier serves your pin code, or tell you how to send it back.</li>
</ol>
<h3>What we need back</h3>
<ul>
<li>The product in its original box with all accessories, manuals and the invoice.</li>
<li>No physical damage, bent pins or removed stickers.</li>
<li>A part that works but doesn't fit your build isn't a defect, so please check compatibility before ordering. Ask us if you're unsure.</li>
</ul>
<h3>Refunds</h3>
<p>If we can't replace the product, we refund you. Prepaid orders go back to the original payment method; cash on delivery orders are refunded to your bank account or UPI ID, usually within 5–7 working days after the product reaches us and is checked.</p>
<h3>Cancelling an order</h3>
<p>You can cancel any time before your order ships.</p>`,
  faqs: `<h2>Frequently asked questions</h2>
<h3>How do I know a part fits my PC?</h3>
<p>Check the specifications on the product page: socket for processors and motherboards, memory type for RAM, length and power for graphics cards. If you're unsure, send us your current parts and we'll help.</p>
<h3>Is my power supply enough for this graphics card?</h3>
<p>Each graphics card lists a recommended power supply. Ask us with your full build and we'll check.</p>
<h3>How long will delivery take?</h3>
<p>Usually 3–7 working days after your order ships. You get tracking details by SMS or WhatsApp.</p>
<h3>Can I pay cash on delivery?</h3>
<p>Yes, for most pin codes and order values. If it's available for your address, you'll see it at checkout.</p>
<h3>What if a part arrives dead or damaged?</h3>
<p>Tell us within 7 days of delivery. See <a href="/pages/returns-replacement">Returns &amp; replacement</a>.</p>
<h3>What about warranty?</h3>
<p>Products carry the manufacturer's warranty. See <a href="/pages/warranty">Warranty</a>.</p>
<h3>Do you give a GST invoice?</h3>
<p>Every order comes with an invoice. Write to us with your order number if you need GST details on it.</p>`,
};

const COLORS = {
  color_brand: "#2563eb", color_pop: "#22d3ee", color_button: "#0b1220", color_button_text: "#ffffff",
  color_text: "#0b1220", color_soft: "#eef2f8", color_line: "#dde3ee", color_footer_bg: "#070b14", color_footer_text: "#dbe4f3",
};

async function images(): Promise<Record<string, string>> {
  const dirs = [path.resolve("build/client/tasqari-samples"), path.resolve("public/tasqari-samples")];
  const dir = dirs.find((d) => fs.existsSync(d));
  const names = [...new Set([...CATS.map((c) => c.image), ...PRODUCTS.map((p) => p.image), "banner-desktop", "banner-mobile"])];
  const out: Record<string, string> = {};
  for (const n of names) {
    const fallback = `${env.appUrl}/tasqari-samples/${n}.webp`;
    if (!dir) { out[n] = fallback; continue; }
    try {
      const file = path.join(dir, `${n}.webp`);
      const size = fs.statSync(file).size;
      const r = await uploadMedia(STORE, "image/webp", Readable.toWeb(fs.createReadStream(file)) as ReadableStream<Uint8Array>, size);
      out[n] = r.url || fallback;
    } catch (e) {
      console.warn("[tasqari-gpu] upload", n, e instanceof Error ? e.message : e);
      out[n] = fallback;
    }
  }
  return out;
}

let ran = false;
export async function setupTasqariGpu() {
  if (ran) return;
  ran = true;
  try {
    // What's in the catalog right now (also answers "where did my product go")
    const items = await db.select({ id: catalogItems.id, title: catalogItems.title, status: catalogItems.status, source: catalogItems.source, createdAt: catalogItems.createdAt, updatedAt: catalogItems.updatedAt })
      .from(catalogItems).where(eq(catalogItems.storeId, STORE));
    console.log("[tasqari-gpu] items before", JSON.stringify(items));

    const [done] = await db.select({ id: catalogCategories.id }).from(catalogCategories).where(and(eq(catalogCategories.storeId, STORE), eq(catalogCategories.handle, "graphics-cards"))).limit(1);
    if (done) return;
    const [store] = await db.select().from(stores).where(eq(stores.id, STORE)).limit(1);
    const [t] = await db.select().from(storeThemes).where(eq(storeThemes.storeId, STORE)).limit(1);
    if (!store || !t?.live) { console.warn("[tasqari-gpu] store or theme missing"); return; }

    const img = await images();

    // Categories
    const existing = await db.select({ id: catalogCategories.id, handle: catalogCategories.handle }).from(catalogCategories).where(eq(catalogCategories.storeId, STORE));
    const catId = new Map(existing.map((c) => [c.handle, c.id]));
    for (const [i, c] of CATS.entries()) {
      if (catId.has(c.handle)) continue;
      const [r] = await db.insert(catalogCategories).values({ storeId: STORE, title: c.title, handle: c.handle, description: c.text, imageUrl: img[c.image], position: i }).returning({ id: catalogCategories.id });
      catId.set(c.handle, r.id);
    }

    // Products (skip a title that already exists)
    const have = new Set(items.map((i) => i.title.toLowerCase()));
    let made = 0;
    for (const p of PRODUCTS) {
      if (have.has(p.title.toLowerCase())) continue;
      await saveItem(store, {
        title: p.title, descriptionHtml: describe(p), status: "active", vendor: null, productType: CATS.find((c) => c.handle === p.cats[p.cats.length - 1])?.title ?? null,
        tags: p.tags ?? [], images: [{ url: img[p.image], alt: p.title }], options: [],
        variants: [{ title: "Default", optionValues: [], sku: null, pricePaise: p.price * 100, compareAtPaise: p.mrp ? p.mrp * 100 : null, stock: 10, weightGrams: p.weight }],
        categoryIds: p.cats.map((h) => catId.get(h)!).filter(Boolean),
        seoTitle: `${p.title} | Tasqari`, seoDescription: p.about,
      });
      made++;
    }

    // Menus
    const cat = (h: string): MenuItem => ({ id: id(), title: CATS.find((c) => c.handle === h)!.title, kind: "category", ref: h });
    const parent = (title: string, h: string, kids: string[]): MenuItem => ({ id: id(), title, kind: "category", ref: h, children: kids.map(cat) });
    const menus: { handle: string; title: string; inHeader: boolean; inFooter: boolean; items: MenuItem[] }[] = [
      { handle: "main-menu", title: "Main menu", inHeader: true, inFooter: false, items: [
        cat("graphics-cards"),
        parent("Components", "components", ["processors", "motherboards", "ram", "power-supplies", "cabinets", "cpu-coolers"]),
        parent("Storage", "storage", ["ssd", "internal-hard-disks", "external-hard-disks"]),
        cat("monitors"),
        parent("Keyboards & mice", "keyboards-mice", ["keyboards", "mice"]),
        { id: id(), title: "Shop all", kind: "all" },
      ] },
      { handle: "shop", title: "Shop", inHeader: false, inFooter: false, items: ["graphics-cards", "processors", "motherboards", "ram", "storage", "power-supplies", "monitors"].map(cat) },
    ];
    for (const m of menus) {
      const [row] = await db.select({ id: storeMenus.id }).from(storeMenus).where(and(eq(storeMenus.storeId, STORE), eq(storeMenus.handle, m.handle))).limit(1);
      if (row) await db.update(storeMenus).set({ title: m.title, items: m.items, inHeader: m.inHeader, inFooter: m.inFooter, updatedAt: new Date() }).where(eq(storeMenus.id, row.id));
      else await db.insert(storeMenus).values({ storeId: STORE, ...m });
    }

    // Pages that still describe audio products
    const pages = await db.select({ id: storePages.id, handle: storePages.handle, body: storePages.bodyHtml }).from(storePages).where(and(eq(storePages.storeId, STORE), inArray(storePages.handle, Object.keys(PAGE_BODIES))));
    for (const pg of pages) {
      if (/earbud|headphone|audio|wearable/i.test(pg.body)) await db.update(storePages).set({ bodyHtml: PAGE_BODIES[pg.handle], updatedAt: new Date() }).where(eq(storePages.id, pg.id));
    }

    // Theme
    const d: ThemeData = JSON.parse(JSON.stringify(t.live));
    d.settings = {
      ...d.settings, ...COLORS, pdp_social_proof: "",
      seo_home_title: "Tasqari – Graphics Cards, Processors, SSDs & PC Parts",
      seo_home_description: "Buy graphics cards, processors, motherboards, RAM, SSDs, hard disks, power supplies, cabinets and monitors from Tasqari. Clear specs, careful packing and cash on delivery across India.",
    };
    const deal = d.groups.header.sections.deal;
    if (deal) deal.settings = { ...deal.settings, show_timer: false, label: "", bg: "#070b14", text_color: "#dbe4f3", messages: [
      { text: "Graphics cards, processors, SSDs and more" }, { text: "Need help choosing parts? Ask us" }, { text: "7-day replacement if it arrives dead or damaged" }, { text: "Cash on delivery available" },
    ] };
    const header = d.groups.header.sections.header;
    if (header) header.settings = { ...header.settings, mega_promo_title: "", mega_promo_color: COLORS.color_brand, search_words: "Graphics card, SSD, RAM, Motherboard, Processor, Power supply", search_placeholder: "Search graphics cards, SSDs, RAM…" };
    const footer = d.groups.footer.sections.footer;
    if (footer) footer.settings = { ...footer.settings, about: "Graphics cards, processors, storage and everything else for your PC build." };

    const C = (h: string) => ({ title: CATS.find((c) => c.handle === h)!.title, link: `/category/${h}`, image: img[CATS.find((c) => c.handle === h)!.image], color: "#ffffff", tag: "", icon: "auto" });
    d.templates.index = {
      order: ["hero", "cats", "gpus", "usp", "storage", "best", "deals", "track", "pay"],
      sections: {
        hero: { type: "hero-slider", settings: {
          autoplay: 0, full_width: false,
          slides: [{ image: img["banner-desktop"], image_mobile: img["banner-mobile"], link: "/category/graphics-cards", alt: "Graphics card", eyebrow: "Graphics cards", heading: "More frames. Less waiting.", text: "Graphics cards for 1080p and 1440p gaming, streaming and creative work.", button: "Shop graphics cards", align: "left", text_color: "#ffffff", shade: false, button_style: "light", color: "#05070d" }],
          side: [
            { eyebrow: "Storage", title: "Faster loads with NVMe SSDs", button: "Shop SSDs", link: "/category/ssd", image: img["ssd-nvme"], color: "#eef2f8", text_color: "#0b1220" },
            { eyebrow: "Memory", title: "DDR4 and DDR5 RAM", button: "Shop RAM", link: "/category/ram", image: img["ram-kit"], color: "#e8f7fb", text_color: "#0b1220" },
          ],
        } },
        cats: { type: "category-strip", settings: { heading: "Shop by category", center: true, show: "photos", fit: "contain", style: "tiles",
          items: ["graphics-cards", "processors", "motherboards", "ram", "ssd", "internal-hard-disks", "external-hard-disks", "power-supplies", "cabinets", "cpu-coolers", "monitors", "keyboards-mice"].map(C) } },
        gpus: { type: "product-carousel", settings: { eyebrow: "The heart of a gaming PC", heading: "Graphics cards", collection: "graphics-cards", sort: "default", label: "" } },
        usp: { type: "usp-tiles", settings: { eyebrow: "Why Tasqari", heading: "Build with confidence.", text: "",
          items: [
            { icon: "badge", title: "Clear specs", text: "Socket, size and power on every product." },
            { icon: "headphones", title: "Help choosing", text: "Ask us before you buy." },
            { icon: "refresh", title: "7-day replacement", text: "If it arrives dead or damaged." },
            { icon: "cash", title: "Cash on delivery", text: "Pay when it reaches you." },
          ] } },
        storage: { type: "product-carousel", settings: { eyebrow: "SSDs and hard disks", heading: "Storage", collection: "storage", sort: "default", label: "" } },
        best: { type: "product-carousel", settings: { eyebrow: "Most picked", heading: "Bestsellers", label: "" } },
        deals: { type: "product-carousel", settings: { eyebrow: "Prices you'll like", heading: "Deals on components", collection: "components", label: "" } },
        track: { type: "image-banner", settings: { heading: "<b>Already ordered?</b><br>Track it in one tap", button: "Track my order", link: "/account", color_a: "#070b14", color_b: COLORS.color_brand, full_width: false } },
        pay: { type: "payment-logos", settings: {} },
      },
    };
    const history = [{ at: new Date().toISOString(), by: "Growpefy", data: t.live }, ...(t.history ?? [])].slice(0, 10);
    await db.update(storeThemes).set({ live: d, draft: d, history, updatedAt: new Date(), publishedAt: new Date() }).where(eq(storeThemes.storeId, STORE));
    console.log(`[tasqari-gpu] done: ${CATS.length} categories, ${made} products, menus, pages, theme`);
  } catch (e) {
    console.error("[tasqari-gpu]", e instanceof Error ? e.stack : e);
  }
}
