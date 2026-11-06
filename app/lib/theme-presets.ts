// Ready-made looks for the Swift theme: colours, fonts and a home page layout. "Use this theme" copies one into the
// store's draft (keeping its logo, WhatsApp, social links and custom text), then the owner edits and publishes.
import type { ThemeData, ThemeTemplate } from "~/db/schema";

export type Preset = { id: string; name: string; tagline: string; best: string; swatch: string[]; settings: Record<string, unknown>; index: ThemeTemplate };

const sec = (list: [string, string, Record<string, unknown>?][]): ThemeTemplate => ({
  sections: Object.fromEntries(list.map(([id, type, settings]) => [id, { type, settings: settings ?? {} }])),
  order: list.map(([id]) => id),
});

export const PRESETS: Preset[] = [
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
];

export const presetById = (id: string | null | undefined) => PRESETS.find((p) => p.id === id) ?? null;

/** The store's design with a preset's look and home page; keeps logo, favicon, WhatsApp, social links and custom CSS. */
export function applyPreset(current: ThemeData, p: Preset): ThemeData {
  return {
    ...current,
    settings: { ...current.settings, ...p.settings, preset: p.id },
    templates: { ...current.templates, index: JSON.parse(JSON.stringify(p.index)) },
  };
}
