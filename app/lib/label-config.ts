// Shipping label design, chosen per store in Shipping → Label design. Shared by the designer page and the PDF renderer.

export type LabelSize = "4x6" | "6x4" | "a4" | "a4x4";
export type LabelConfig = {
  size: LabelSize; // 4x6 thermal portrait, 6x4 thermal landscape, A4 one label per page, A4 four labels per page
  logo: boolean; // print the logo (else the brand name)
  logoUrl: string | null; // PNG / JPG
  brandName: string; // shown when there's no logo; empty = store name
  accent: string; // A4 only (colour printers): header band and COD box
  showMobile: boolean;
  product: "name" | "sku" | "both" | "none";
  nameChars: number;
  showQty: boolean;
  showPrice: boolean;
  showInvoiceValue: boolean; // order value on prepaid labels
  showOrderBarcode: boolean;
  showDate: boolean;
  showSortCode: boolean;
  showPickup: boolean;
  pickupAddress: string;
  showReturn: boolean;
  returnAddress: string; // empty = pickup address
  showGst: boolean;
  gstin: string;
  note: string; // small line at the bottom, e.g. "Handle with care"
};

export const DEFAULT_LABEL: LabelConfig = {
  size: "4x6", logo: false, logoUrl: null, brandName: "", accent: "#111827",
  showMobile: true, product: "name", nameChars: 60, showQty: true, showPrice: false, showInvoiceValue: false,
  showOrderBarcode: true, showDate: true, showSortCode: true,
  showPickup: false, pickupAddress: "", showReturn: true, returnAddress: "", showGst: false, gstin: "", note: "",
};

export const LABEL_SIZES: { id: LabelSize; title: string; sub: string }[] = [
  { id: "4x6", title: "Thermal 4×6", sub: "Vertical · 100×150 mm" },
  { id: "6x4", title: "Thermal 6×4", sub: "Horizontal · 150×100 mm" },
  { id: "a4", title: "A4 · 1 label", sub: "Desktop printer, one per page" },
  { id: "a4x4", title: "A4 · 4 labels", sub: "Desktop printer, cut into 4" },
];

/** Cleans what the designer sent (or what's saved) into a full config. */
export function resolveLabel(raw: unknown): LabelConfig {
  const r = (raw && typeof raw === "object" ? raw : {}) as Partial<Record<keyof LabelConfig, unknown>>;
  const d = DEFAULT_LABEL;
  const bool = (k: keyof LabelConfig) => (typeof r[k] === "boolean" ? (r[k] as boolean) : (d[k] as boolean));
  const str = (k: keyof LabelConfig, n: number) => (typeof r[k] === "string" ? (r[k] as string).trim().slice(0, n) : (d[k] as string));
  const size = LABEL_SIZES.some((s) => s.id === r.size) ? (r.size as LabelSize) : d.size;
  const product = ["name", "sku", "both", "none"].includes(String(r.product)) ? (r.product as LabelConfig["product"]) : d.product;
  const logoUrl = typeof r.logoUrl === "string" && /^https?:\/\/\S+$/.test(r.logoUrl) ? r.logoUrl : null;
  return {
    size, logo: bool("logo") && Boolean(logoUrl), logoUrl, brandName: str("brandName", 60),
    accent: typeof r.accent === "string" && /^#[0-9a-f]{6}$/i.test(r.accent) ? r.accent : d.accent,
    showMobile: bool("showMobile"), product, nameChars: Math.max(10, Math.min(120, Math.round(Number(r.nameChars) || d.nameChars))),
    showQty: bool("showQty"), showPrice: bool("showPrice"), showInvoiceValue: bool("showInvoiceValue"),
    showOrderBarcode: bool("showOrderBarcode"), showDate: bool("showDate"), showSortCode: bool("showSortCode"),
    showPickup: bool("showPickup"), pickupAddress: str("pickupAddress", 300),
    showReturn: bool("showReturn"), returnAddress: str("returnAddress", 300),
    showGst: bool("showGst"), gstin: str("gstin", 20).toUpperCase(), note: str("note", 120),
  };
}
