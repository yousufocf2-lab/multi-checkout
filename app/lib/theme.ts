// Checkout look & feel, saved per store in stores.theme (jsonb). Shared by server and browser.

export type SectionOrder = "address_offers_payment" | "offers_address_payment" | "address_payment_offers";
export type UpsellPlacement = "cart" | "before_payment" | "after_payment" | "hidden";

export type CheckoutLayout = "single" | "steps";
/** Checkout sections the store can drag into any order (on phones; on computers the order card and price sit on the right). */
export type BlockKey = "order" | "address" | "offers" | "upsell" | "payment" | "price";
export const BLOCK_KEYS: BlockKey[] = ["order", "address", "offers", "upsell", "payment", "price"];
export const BLOCK_LABELS: Record<BlockKey, string> = {
  order: "Your order", address: "Delivery details", offers: "Coupons & bank offers", upsell: "You may also like", payment: "Payment", price: "Price details",
};

export type CheckoutTheme = {
  layout: CheckoutLayout; // single page, or 3 steps (mobile → address → payment)
  blocks: BlockKey[]; // section order, see BLOCK_KEYS
  bgColor: string; // page background
  surfaceColor: string; // cards
  textColor: string;
  borderColor: string;
  buttonColor: string;
  buttonTextColor: string;
  headerBg: string;
  headerText: string;
  font: "instrument" | "inter" | "poppins" | "dmsans" | "roboto" | "system";
  fontScale: "sm" | "md" | "lg";
  radius: "sharp" | "soft" | "round";
  logoHeight: number; // px, 20..80
  logoAlign: "left" | "center";
  sectionOrder: SectionOrder;
  upsellPlacement: UpsellPlacement;
  upsellTitle: string;
  showSavingsBar: boolean;
  announcement: string; // thin bar above the header; empty = hidden
  announcementBg: string;
  announcementText: string;
  showEmail: boolean;
  showTrust: boolean;
  trustText: string;
  prepaidButtonText: string; // "Pay {amount}" — {amount} is replaced
  codButtonText: string;
};

export const DEFAULT_THEME: CheckoutTheme = {
  layout: "single",
  blocks: ["order", "address", "offers", "upsell", "payment", "price"],
  bgColor: "#F4F5F2",
  surfaceColor: "#FFFFFF",
  textColor: "#1C2430",
  borderColor: "#E2E5E0",
  buttonColor: "", // empty = brand color
  buttonTextColor: "#FFFFFF",
  headerBg: "#FFFFFF",
  headerText: "#1C2430",
  font: "instrument",
  fontScale: "md",
  radius: "soft",
  logoHeight: 32,
  logoAlign: "left",
  sectionOrder: "address_offers_payment",
  upsellPlacement: "cart",
  upsellTitle: "You may also like",
  showSavingsBar: true,
  announcement: "",
  announcementBg: "#1C2430",
  announcementText: "#FFFFFF",
  showEmail: true,
  showTrust: true,
  trustText: "Payments are encrypted and processed by PayU", // "PayU" is swapped for the store's primary gateway at checkout
  prepaidButtonText: "Pay {amount}",
  codButtonText: "Place order, {amount}",
};

export const FONTS: Record<CheckoutTheme["font"], { label: string; css: string; google?: string }> = {
  instrument: { label: "Instrument Sans", css: '"Instrument Sans", system-ui, sans-serif' },
  inter: { label: "Inter", css: '"Inter", system-ui, sans-serif', google: "Inter:wght@400;500;600;700" },
  poppins: { label: "Poppins", css: '"Poppins", system-ui, sans-serif', google: "Poppins:wght@400;500;600;700" },
  dmsans: { label: "DM Sans", css: '"DM Sans", system-ui, sans-serif', google: "DM+Sans:wght@400;500;600;700" },
  roboto: { label: "Roboto", css: '"Roboto", system-ui, sans-serif', google: "Roboto:wght@400;500;700" },
  system: { label: "Phone default", css: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif' },
};

export const FONT_SCALE: Record<CheckoutTheme["fontScale"], number> = { sm: 15, md: 16, lg: 17 };
export const RADIUS: Record<CheckoutTheme["radius"], { card: string; field: string }> = {
  sharp: { card: "4px", field: "3px" },
  soft: { card: "12px", field: "8px" },
  round: { card: "20px", field: "999px" },
};

export const SECTION_ORDERS: { id: SectionOrder; label: string; order: ("address" | "offers" | "payment")[] }[] = [
  { id: "address_offers_payment", label: "Address → Offers → Payment", order: ["address", "offers", "payment"] },
  { id: "offers_address_payment", label: "Offers → Address → Payment", order: ["offers", "address", "payment"] },
  { id: "address_payment_offers", label: "Address → Payment → Offers", order: ["address", "payment", "offers"] },
];

export const UPSELL_PLACEMENTS: { id: UpsellPlacement; label: string }[] = [
  { id: "cart", label: "Under the cart items" },
  { id: "before_payment", label: "As its own section (drag it in the preview)" },
  { id: "hidden", label: "Don't show" },
];

const HEX = /^#[0-9a-f]{6}$/i;
const pick = <T extends string>(v: unknown, allowed: readonly T[], fallback: T): T => (allowed.includes(v as T) ? (v as T) : fallback);
const color = (v: unknown, fallback: string) => (typeof v === "string" && HEX.test(v) ? v : fallback);
const text = (v: unknown, fallback: string, max = 140) => (typeof v === "string" ? v.slice(0, max) : fallback);

/**
 * Section order. Old themes only had a preset order + an upsell position, so build the list from those.
 * Always returns every key exactly once.
 */
function resolveBlocks(raw: unknown, sectionOrder: unknown, upsell: unknown): BlockKey[] {
  const list = (Array.isArray(raw) ? raw : typeof raw === "string" ? raw.split(",") : []).map((x) => String(x).trim()) as BlockKey[];
  const seen = [...new Set(list.filter((k) => BLOCK_KEYS.includes(k)))];
  if (seen.length) return [...seen, ...BLOCK_KEYS.filter((k) => !seen.includes(k))];
  const base = (SECTION_ORDERS.find((o) => o.id === sectionOrder) ?? SECTION_ORDERS[0]).order as BlockKey[];
  const out: BlockKey[] = ["order", ...base, "price"];
  const at = out.indexOf("payment");
  out.splice(upsell === "after_payment" ? at + 1 : at, 0, "upsell");
  return out;
}

/** Saved theme + defaults, with every value validated. */
export function resolveTheme(raw: unknown): CheckoutTheme {
  const t = (raw && typeof raw === "object" ? raw : {}) as Partial<Record<keyof CheckoutTheme, unknown>>;
  const d = DEFAULT_THEME;
  return {
    layout: pick(t.layout, ["single", "steps"] as const, d.layout),
    blocks: resolveBlocks(t.blocks, t.sectionOrder, t.upsellPlacement),
    bgColor: color(t.bgColor, d.bgColor),
    surfaceColor: color(t.surfaceColor, d.surfaceColor),
    textColor: color(t.textColor, d.textColor),
    borderColor: color(t.borderColor, d.borderColor),
    buttonColor: t.buttonColor === "" ? "" : color(t.buttonColor, d.buttonColor),
    buttonTextColor: color(t.buttonTextColor, d.buttonTextColor),
    headerBg: color(t.headerBg, d.headerBg),
    headerText: color(t.headerText, d.headerText),
    font: pick(t.font, Object.keys(FONTS) as CheckoutTheme["font"][], d.font),
    fontScale: pick(t.fontScale, ["sm", "md", "lg"] as const, d.fontScale),
    radius: pick(t.radius, ["sharp", "soft", "round"] as const, d.radius),
    logoHeight: Math.min(80, Math.max(20, Math.round(Number(t.logoHeight) || d.logoHeight))),
    logoAlign: pick(t.logoAlign, ["left", "center"] as const, d.logoAlign),
    sectionOrder: pick(t.sectionOrder, SECTION_ORDERS.map((s) => s.id), d.sectionOrder),
    upsellPlacement: pick(t.upsellPlacement, UPSELL_PLACEMENTS.map((s) => s.id), d.upsellPlacement),
    upsellTitle: text(t.upsellTitle, d.upsellTitle, 60) || d.upsellTitle,
    showSavingsBar: typeof t.showSavingsBar === "boolean" ? t.showSavingsBar : d.showSavingsBar,
    announcement: text(t.announcement, d.announcement),
    announcementBg: color(t.announcementBg, d.announcementBg),
    announcementText: color(t.announcementText, d.announcementText),
    showEmail: typeof t.showEmail === "boolean" ? t.showEmail : d.showEmail,
    showTrust: typeof t.showTrust === "boolean" ? t.showTrust : d.showTrust,
    trustText: text(t.trustText, d.trustText) || d.trustText,
    prepaidButtonText: text(t.prepaidButtonText, d.prepaidButtonText, 40) || d.prepaidButtonText,
    codButtonText: text(t.codButtonText, d.codButtonText, 40) || d.codButtonText,
  };
}

/** Reads the design form (field names = theme keys; booleans are checkboxes). */
export function themeFromForm(fd: FormData): CheckoutTheme {
  const raw: Record<string, unknown> = {};
  for (const k of Object.keys(DEFAULT_THEME) as (keyof CheckoutTheme)[]) {
    if (typeof DEFAULT_THEME[k] === "boolean") raw[k] = fd.get(k) === "on";
    else raw[k] = String(fd.get(k) ?? "").trim();
  }
  if (raw.buttonColor && !HEX.test(String(raw.buttonColor))) raw.buttonColor = "";
  return resolveTheme(raw);
}

export function hexToRgb(hex: string) {
  const m = hex.replace("#", "").match(/^([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  return m ? `${parseInt(m[1], 16)} ${parseInt(m[2], 16)} ${parseInt(m[3], 16)}` : "17 24 39";
}

/** Mix two hex colors (0 = a, 1 = b). Used to derive soft/faint text and sunk backgrounds. */
export function mix(a: string, b: string, t: number) {
  const pa = hexToRgb(a).split(" ").map(Number);
  const pb = hexToRgb(b).split(" ").map(Number);
  return pa.map((v, i) => Math.round(v + (pb[i] - v) * t)).join(" ");
}

/** CSS variables for a themed checkout wrapper. */
export function themeVars(t: CheckoutTheme, brand: string): Record<string, string> {
  return {
    "--brand": hexToRgb(brand),
    "--btn": hexToRgb(t.buttonColor || brand),
    "--btn-fg": hexToRgb(t.buttonTextColor),
    "--ink": hexToRgb(t.textColor),
    "--ink-soft": mix(t.textColor, t.surfaceColor, 0.3),
    "--ink-faint": mix(t.textColor, t.surfaceColor, 0.48),
    "--paper": hexToRgb(t.bgColor),
    "--paper-sunk": mix(t.bgColor, t.textColor, 0.05),
    "--surface": hexToRgb(t.surfaceColor),
    "--rule": hexToRgb(t.borderColor),
    "--rule-strong": mix(t.borderColor, t.textColor, 0.12),
    "--r-card": RADIUS[t.radius].card,
    "--r-field": RADIUS[t.radius].field,
    fontFamily: FONTS[t.font].css,
  };
}

export const buttonText = (tpl: string, amount: string) => tpl.replace(/\{amount\}/g, amount);
