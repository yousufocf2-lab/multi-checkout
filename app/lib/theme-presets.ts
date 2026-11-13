// Ready-made looks for the Swift theme: colours, fonts and a home page layout. "Use this theme" copies one into the
// store's draft (keeping its logo, WhatsApp, social links and custom text), then the owner edits and publishes.
import type { ThemeData, ThemeTemplate } from "~/db/schema";

/** theme: the theme folder this look is built on (its own sections and page layouts); missing = Swift. index: Swift home page; themes with their own folder use that folder's templates. */
export type Preset = { id: string; name: string; tagline: string; best: string; swatch: string[]; settings: Record<string, unknown>; index?: ThemeTemplate; pricePaise?: number; theme?: string };

const sec = (list: [string, string, Record<string, unknown>?][]): ThemeTemplate => ({
  sections: Object.fromEntries(list.map(([id, type, settings]) => [id, { type, settings: settings ?? {} }])),
  order: list.map(([id]) => id),
});

const ALL_PRESETS: Preset[] = [
  {
    id: "swift", name: "Swift", tagline: "Clean and fast, built for COD shoppers on phones", best: "Any store", swatch: ["#ffffff", "#14171a", "#0b5d4b"],
    settings: { color_bg: "#ffffff", color_text: "#14171a", color_muted: "#5a6169", color_soft: "#f5f6f7", color_brand: "", color_button_text: "#ffffff", color_announce_bg: "#14171a", color_announce_text: "#ffffff", font_heading: "DM Sans", font_body: "DM Sans", heading_uppercase: false, heading_scale: 100, button_radius: 10, card_radius: 12, card_ratio: "square" },
    index: sec([["hero", "hero"], ["trust", "trust-badges"], ["bestsellers", "product-grid", { heading: "Bestsellers", limit: 8 }], ["faq", "faq"]]),
  },
  {
    id: "noir", name: "Noir", tagline: "Dark, premium look with gold accents", best: "Gadgets, watches, perfumes", swatch: ["#0b0b0c", "#f2f2f2", "#c8a15a"],
    settings: { color_bg: "#0b0b0c", color_text: "#f2f2f2", color_muted: "#a1a1aa", color_soft: "#18181b", color_brand: "#c8a15a", color_button_text: "#0b0b0c", color_announce_bg: "#c8a15a", color_announce_text: "#0b0b0c", font_heading: "Space Grotesk", font_body: "Inter", heading_uppercase: true, heading_scale: 95, button_radius: 4, card_radius: 6, card_ratio: "portrait" },
    index: sec([["hero", "hero", { eyebrow: "New launch" }], ["video", "video-banner", { heading: "Made to stand out" }], ["new", "product-grid", { heading: "New arrivals", limit: 8 }], ["story", "image-with-text", { heading: "Crafted with obsession" }], ["reviews", "testimonials"], ["faq", "faq"]]),
  },
  {
    id: "bloom", name: "Bloom", tagline: "Soft pastels and elegant serif headings", best: "Beauty, skincare, fashion", swatch: ["#fffaf7", "#3b2a2a", "#c26d6d"],
    settings: { color_bg: "#fffaf7", color_text: "#3b2a2a", color_muted: "#8a6f6a", color_soft: "#fbeee8", color_brand: "#c26d6d", color_button_text: "#ffffff", color_announce_bg: "#c26d6d", color_announce_text: "#ffffff", font_heading: "Playfair Display", font_body: "Manrope", heading_uppercase: false, heading_scale: 105, button_radius: 30, card_radius: 18, card_ratio: "portrait" },
    index: sec([["hero", "hero", { eyebrow: "Self-care, daily" }], ["cats", "collection-list", { heading: "Shop by concern" }], ["best", "product-grid", { heading: "Loved by our customers", limit: 8 }], ["reviews", "testimonials"], ["story", "image-with-text", { heading: "Clean, kind, effective" }], ["faq", "faq"]]),
  },
  {
    id: "fresh", name: "Fresh", tagline: "Bright and friendly, easy to browse aisles", best: "Food, grocery, home", swatch: ["#ffffff", "#10261a", "#1f8a4c"],
    settings: { color_bg: "#ffffff", color_text: "#10261a", color_muted: "#557060", color_soft: "#eef7ef", color_brand: "#1f8a4c", color_button_text: "#ffffff", color_announce_bg: "#1f8a4c", color_announce_text: "#ffffff", font_heading: "Poppins", font_body: "Poppins", heading_uppercase: false, heading_scale: 100, button_radius: 12, card_radius: 14, card_ratio: "square" },
    index: sec([["hero", "hero", { eyebrow: "Fresh every day" }], ["trust", "trust-badges"], ["cats", "collection-list", { heading: "Shop by aisle" }], ["today", "product-grid", { heading: "Fresh today", limit: 8 }], ["story", "image-with-text", { heading: "From farm to your door" }], ["faq", "faq"]]),
  },
  {
    id: "bold", name: "Bold", tagline: "Loud deals, big type, made to sell fast", best: "Electronics, deals, D2C", swatch: ["#ffffff", "#0a0a0a", "#ff3b30"],
    settings: { color_bg: "#ffffff", color_text: "#0a0a0a", color_muted: "#5c5c66", color_soft: "#f2f4f7", color_brand: "#ff3b30", color_button_text: "#ffffff", color_announce_bg: "#0a0a0a", color_announce_text: "#ffffff", font_heading: "Montserrat", font_body: "Inter", heading_uppercase: true, heading_scale: 110, button_radius: 8, card_radius: 10, card_ratio: "square" },
    index: sec([["hero", "hero", { eyebrow: "Limited time" }], ["trust", "trust-badges"], ["deals", "product-grid", { heading: "Deals of the day", limit: 8 }], ["video", "video-banner", { heading: "See it in action" }], ["best", "product-grid", { heading: "Bestsellers", limit: 8 }], ["reviews", "testimonials"]]),
  },
  {
    id: "atelier", name: "Atelier", tagline: "Minimal, gallery-like, lots of white space", best: "Fashion, art, home décor", swatch: ["#ffffff", "#111111", "#111111"],
    settings: { color_bg: "#ffffff", color_text: "#111111", color_muted: "#6b6b6b", color_soft: "#f4f4f2", color_brand: "#111111", color_button_text: "#ffffff", color_announce_bg: "#111111", color_announce_text: "#ffffff", font_heading: "Lora", font_body: "Inter", heading_uppercase: false, heading_scale: 100, button_radius: 0, card_radius: 0, card_ratio: "portrait" },
    index: sec([["hero", "hero", { eyebrow: "The new collection" }], ["new", "product-grid", { heading: "Just in", limit: 8 }], ["story", "image-with-text", { heading: "Made slowly, made well" }], ["note", "rich-text", { heading: "Our promise", text: "<p>Free delivery on prepaid orders, easy returns and cash on delivery across India.</p>" }]]),
  },
  {
    id: "mira", name: "Mira", tagline: "A polished, feminine storefront for bags and accessories", best: "Handbags, purses and accessories", swatch: ["#fffaf6", "#352724", "#a7655f"],
    settings: { color_bg: "#fffaf6", color_text: "#352724", color_muted: "#796c66", color_soft: "#f5ece7", color_brand: "#a7655f", color_button_text: "#ffffff", color_announce_bg: "#352724", color_announce_text: "#fffaf6", font_heading: "Playfair Display", font_body: "Manrope", heading_uppercase: false, heading_scale: 105, button_radius: 8, card_radius: 14, card_ratio: "portrait", preset: "mira" },
    index: sec([["hero", "hero", { eyebrow: "THE EVERYDAY EDIT", heading: "A little more lovely, every day.", text: "Thoughtful bags for wherever the day takes you.", button_label: "Explore the collection" }], ["demo", "demo-product-grid", { heading: "The bag edit" }], ["new", "product-grid", { heading: "Made for your everyday", limit: 8 }], ["story", "image-with-text", { heading: "Room for your whole day", text: "<p>Easy-to-carry favourites, considered details and space for the things that matter.</p>", button_label: "Find your favourite" }], ["trust", "trust-badges"], ["faq", "faq"]]),
  },
  {
    id: "luma", name: "Luma", tagline: "A fresh, science-led storefront for skincare and beauty", best: "Skincare, beauty and self-care", swatch: ["#f4fbff", "#182547", "#5368e8"],
    settings: { color_bg: "#f4fbff", color_text: "#182547", color_muted: "#65738f", color_soft: "#eaf5fb", color_brand: "#5368e8", color_button_text: "#ffffff", color_announce_bg: "#d8f1ff", color_announce_text: "#182547", font_heading: "Plus Jakarta Sans", font_body: "Manrope", heading_uppercase: false, heading_scale: 100, button_radius: 999, card_radius: 24, card_ratio: "portrait", preset: "luma" },
    index: sec([["hero", "hero", { eyebrow: "SKINCARE, MADE SIMPLE", heading: "A little science. A lot of glow.", text: "Thoughtful daily essentials for a routine that feels as good as it looks.", button_label: "Shop the routine" }], ["categories", "collection-list", { heading: "Find your ritual" }], ["essentials", "product-grid", { heading: "Your daily essentials", limit: 8 }], ["story", "image-with-text", { heading: "Good skin days, built daily", text: "<p>Gentle formulas, considered ingredients and easy steps for a routine you can keep.</p>", button_label: "Explore skincare" }], ["reviews", "testimonials"], ["trust", "trust-badges"], ["faq", "faq"]]),
  },
  {
    id: "thread", name: "Thread", tagline: "A bold, editorial storefront for everyday apparel", best: "Clothing, streetwear and essentials", swatch: ["#f5f4ee", "#171816", "#c9e958"],
    settings: { color_bg: "#f5f4ee", color_text: "#171816", color_muted: "#66675f", color_soft: "#e9e9df", color_brand: "#c9e958", color_button_text: "#171816", color_announce_bg: "#171816", color_announce_text: "#d8f27a", font_heading: "Space Grotesk", font_body: "DM Sans", heading_uppercase: true, heading_scale: 105, button_radius: 3, card_radius: 2, card_ratio: "portrait", preset: "thread" },
    index: sec([["hero", "hero", { eyebrow: "THE NEW UNIFORM", heading: "Wear it your way.", text: "Easy layers, considered fits and pieces made to move with you.", button_label: "Shop new arrivals" }], ["categories", "collection-list", { heading: "Find your fit" }], ["new", "product-grid", { heading: "Fresh from the studio", limit: 8 }], ["story", "image-with-text", { heading: "Good clothes. No overthinking.", text: "<p>Reliable fabrics, relaxed shapes and details that work hard in your everyday rotation.</p>", button_label: "Explore the edit" }], ["reviews", "testimonials"], ["trust", "trust-badges"], ["faq", "faq"]]),
  },
  {
    id: "stride", name: "Stride", tagline: "A kinetic footwear storefront with bold campaign visuals", best: "Sneakers, running shoes and footwear", swatch: ["#f3f1eb", "#151719", "#ff6548"],
    settings: { color_bg: "#f3f1eb", color_text: "#151719", color_muted: "#77766f", color_soft: "#e7e4dc", color_brand: "#ff6548", color_button_text: "#ffffff", color_announce_bg: "#151719", color_announce_text: "#ffffff", font_heading: "Space Grotesk", font_body: "DM Sans", heading_uppercase: true, heading_scale: 112, button_radius: 4, card_radius: 8, card_ratio: "square", preset: "stride" },
    index: sec([["hero", "hero", { eyebrow: "MOVE YOUR WAY", heading: "Built for the next mile.", text: "Everyday sneakers, city-ready comfort and performance pairs made to keep you moving.", button_label: "Shop the collection", slides: [{ image: "https://images.unsplash.com/photo-1581285864607-ef85509e7324?auto=format&fit=crop&w=1800&q=82", alt: "Sneakers styled for the street" }, { image: "https://images.unsplash.com/photo-1724921194807-c0d17dc7cfe4?auto=format&fit=crop&w=1800&q=82", alt: "Colorful sneakers on a clean studio set" }, { image: "https://images.unsplash.com/photo-1700178310305-0e05d7930f9f?auto=format&fit=crop&w=1800&q=82", alt: "White sneakers in warm studio light" }] }], ["categories", "collection-list", { heading: "Find your pace" }], ["new", "product-grid", { heading: "The everyday rotation", limit: 8 }], ["story", "image-with-text", { heading: "Comfort that keeps up", text: "<p>From early starts to late plans, find a pair that feels right from the first step. Explore lightweight runners, all-day staples and clean low tops.</p>", button_label: "Explore all footwear" }], ["featured", "product-grid", { heading: "Made for the miles", collection: "running", limit: 4 }], ["reviews", "testimonials"], ["trust", "trust-badges"], ["faq", "faq"], ["newsletter", "newsletter"]]),
  },
  {
    id: "playday", name: "Playday", theme: "playday", tagline: "A storybook toy shop: night-sky hero, shop by age and a gift finder", best: "Toys, games, baby gifts and kids' learning", swatch: ["#fffaf3", "#221c46", "#ff6b3d"],
    settings: { preset: "playday" },
  },
  {
    id: "scentelier", name: "Scentelier", tagline: "An editorial fragrance house with warm, tactile luxury", best: "Perfume, fragrance and premium beauty", swatch: ["#f3eee6", "#211d19", "#a7794f"],
    settings: { color_bg: "#f3eee6", color_text: "#211d19", color_muted: "#777066", color_soft: "#e9e1d5", color_brand: "#a7794f", color_button_text: "#fffdf8", color_announce_bg: "#211d19", color_announce_text: "#f3eee6", font_heading: "Playfair Display", font_body: "Manrope", heading_uppercase: false, heading_scale: 108, button_radius: 2, card_radius: 3, card_ratio: "portrait", preset: "scentelier" },
    index: sec([["hero", "hero", { eyebrow: "A STUDY IN SCENT", heading: "Leave a little of you behind.", text: "Considered fragrances for the moments that become memories.", button_label: "Explore the collection", slides: [{ image: "https://images.unsplash.com/photo-1594035910387-fea47794261f?auto=format&fit=crop&w=2000&q=85", alt: "Sculptural perfume bottles in warm light" }, { image: "https://images.unsplash.com/photo-1541643600914-78b084683601?auto=format&fit=crop&w=2000&q=85", alt: "A refined fragrance bottle" }, { image: "https://images.unsplash.com/photo-1592945403244-b3fbafd7f539?auto=format&fit=crop&w=2000&q=85", alt: "Perfume arranged as an editorial still life" }] }], ["categories", "collection-list", { heading: "Find your fragrance", limit: 4 }], ["new", "product-grid", { heading: "The scent wardrobe", limit: 8 }], ["story", "image-with-text", { heading: "Made to linger", text: "<p>Meet expressive notes, thoughtful blends and beautiful bottles made to make getting ready feel like a ritual.</p>", button_label: "Discover the house" }], ["reviews", "testimonials"], ["trust", "trust-badges"], ["email", "newsletter"]]),
  },
  {
    id: "pulse", name: "Pulse", theme: "pulse", tagline: "A sharp electronics store: live deal ticker, split hero, shoppable videos and a feature-rich product page", best: "Earbuds, smartwatches, speakers and gadgets", swatch: ["#ffffff", "#0e0f12", "#5146ff"],
    settings: { preset: "pulse" },
  },
];

// The colour-only starter looks stay resolvable for previews and existing saved designs,
// but only complete, distinct designs are offered in the theme library.
export const PRESETS: Preset[] = ALL_PRESETS.filter((p) => p.id === "mira" || p.id === "luma" || p.id === "thread" || p.id === "stride" || p.id === "playday" || p.id === "scentelier" || p.id === "pulse");
export const presetById = (id: string | null | undefined) => ALL_PRESETS.find((p) => p.id === id) ?? null;

/** The store's design with a preset's look and home page; keeps logo, favicon, WhatsApp, social links and custom CSS. */
export function applyPreset(current: ThemeData, p: Preset, fresh?: ThemeData): ThemeData {
  const target = p.theme ?? "swift";
  if (target !== (current.theme ?? "swift")) {
    // Another theme folder: start from its own default pages, header and footer; keep the store's logo, icons and links
    if (!fresh) throw new Error("Theme defaults are needed to switch themes.");
    const keep = Object.fromEntries(Object.entries(current.settings ?? {}).filter(([k, v]) => CARRY.includes(k) && v != null && v !== ""));
    const base = JSON.parse(JSON.stringify(fresh)) as ThemeData;
    return {
      ...base, theme: target,
      settings: { ...base.settings, ...keep, ...p.settings, preset: p.id },
      templates: p.index ? { ...base.templates, index: JSON.parse(JSON.stringify(p.index)) } : base.templates,
    };
  }
  return {
    ...current,
    settings: { ...current.settings, ...p.settings, preset: p.id },
    templates: p.index ? { ...current.templates, index: JSON.parse(JSON.stringify(p.index)) } : current.templates,
  };
}

/** Store details that stay when switching to a theme built on another folder. */
const CARRY = ["logo", "favicon", "whatsapp_number", "social_instagram", "social_facebook", "social_youtube", "social_linkedin", "custom_css"];
