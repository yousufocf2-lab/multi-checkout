// Store owner KYC: shared by server and browser. Only PAN + GST (for invoices), no Aadhaar.
import { INDIAN_STATES } from "./states";

export type BusinessType = "individual" | "proprietor" | "partnership" | "llp" | "pvt_ltd" | "public_ltd" | "other";

export const BUSINESS_TYPES: { value: BusinessType; label: string }[] = [
  { value: "individual", label: "Individual / no registered business" },
  { value: "proprietor", label: "Sole proprietorship" },
  { value: "partnership", label: "Partnership firm" },
  { value: "llp", label: "LLP" },
  { value: "pvt_ltd", label: "Private limited company" },
  { value: "public_ltd", label: "Public limited company" },
  { value: "other", label: "Other (trust, society…)" },
];

export const CATEGORIES = [
  "Electronics & gadgets", "Fashion & clothing", "Beauty & personal care", "Health & wellness", "Home & kitchen",
  "Jewellery & accessories", "Footwear", "Food & beverages", "Toys & kids", "Books & stationery", "Sports & fitness", "Other",
];

export type KycData = {
  // Step 1 · Business
  brandName?: string;
  legalName?: string;
  businessType?: BusinessType;
  category?: string;
  website?: string;
  // Step 2 · Contact
  email?: string;
  phone?: string;
  whatsapp?: string;
  contactName?: string;
  // Step 3 · Tax & billing
  pan?: string;
  gstin?: string;
  address?: string;
  city?: string;
  state?: string; // full state name (same as wallet billing)
  pincode?: string;
  step?: number; // last completed step (1..3)
};

export type KycStatus = "pending" | "approved" | "rejected";

export const PAN_RE = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
export const GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

/** GSTIN check digit (15th character), as defined by GSTN. */
export function gstinChecksumOk(g: string) {
  if (!GSTIN_RE.test(g)) return false;
  const chars = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    const v = chars.indexOf(g[i]) * (i % 2 === 0 ? 1 : 2);
    sum += Math.floor(v / 36) + (v % 36);
  }
  const check = chars[(36 - (sum % 36)) % 36];
  return check === g[14];
}

/** GST state codes → state name (as in INDIAN_STATES). */
const GST_STATE: Record<string, string> = {
  "01": "JK", "02": "HP", "03": "PB", "04": "CH", "05": "UK", "06": "HR", "07": "DL", "08": "RJ", "09": "UP", "10": "BR",
  "11": "SK", "12": "AR", "13": "NL", "14": "MN", "15": "MZ", "16": "TR", "17": "ML", "18": "AS", "19": "WB", "20": "JH",
  "21": "OR", "22": "CG", "23": "MP", "24": "GJ", "25": "DN", "26": "DN", "27": "MH", "28": "AP", "29": "KA", "30": "GA",
  "31": "LD", "32": "KL", "33": "TN", "34": "PY", "35": "AN", "36": "TS", "37": "AP", "38": "LA",
};

export function stateFromGstin(g: string): string | null {
  const code = GST_STATE[g.slice(0, 2)];
  return code ? INDIAN_STATES.find((s) => s.code === code)?.name ?? null : null;
}

export const panFromGstin = (g: string) => (g.length >= 12 ? g.slice(2, 12) : "");

/** 4th letter of a PAN tells the holder type. */
const PAN_HOLDER: Record<string, string> = { P: "individual", C: "company", F: "firm / LLP", H: "HUF", A: "association", T: "trust", B: "body of individuals", L: "local authority", J: "artificial person", G: "government" };
export const panHolder = (pan: string) => PAN_HOLDER[pan[3]] ?? null;

/** Soft warning when the PAN type doesn't fit the chosen business type. */
export function panTypeWarning(pan: string, type?: BusinessType): string | null {
  if (!PAN_RE.test(pan) || !type) return null;
  const k = pan[3];
  if ((type === "pvt_ltd" || type === "public_ltd") && k !== "C") return "Companies usually have a company PAN (4th letter C). Check the PAN.";
  if ((type === "partnership" || type === "llp") && k !== "F") return "Firms and LLPs usually have a firm PAN (4th letter F). Check the PAN.";
  if ((type === "individual" || type === "proprietor") && k !== "P") return "Individuals and proprietors usually use a personal PAN (4th letter P). Check the PAN.";
  return null;
}

export type KycErrors = Partial<Record<keyof KycData | "form", string>>;

export function validateStep(step: number, k: KycData): KycErrors {
  const e: KycErrors = {};
  if (step === 1) {
    if (!k.brandName || k.brandName.length < 2) e.brandName = "Enter your brand name";
    if (!k.legalName || k.legalName.length < 2) e.legalName = "Enter the name on your PAN or GST certificate";
    if (!k.businessType) e.businessType = "Choose your business type";
    if (!k.category) e.category = "Choose what you sell";
    if (k.website && !/^(https?:\/\/)?[a-z0-9-]+(\.[a-z0-9-]+)+(\/.*)?$/i.test(k.website)) e.website = "Enter a website like mybrand.com";
  }
  if (step === 2) {
    if (!k.contactName || k.contactName.length < 2) e.contactName = "Enter your name";
    if (!k.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(k.email)) e.email = "Enter a valid email for invoices and alerts";
    if (!k.phone || !/^[6-9]\d{9}$/.test(k.phone)) e.phone = "Enter a valid 10-digit mobile number";
    if (k.whatsapp && !/^[6-9]\d{9}$/.test(k.whatsapp)) e.whatsapp = "Enter a valid 10-digit WhatsApp number";
  }
  if (step === 3) {
    if (!k.pan || !PAN_RE.test(k.pan)) e.pan = "PAN has 10 characters, e.g. ABCDE1234F";
    if (k.gstin) {
      if (!GSTIN_RE.test(k.gstin) || !gstinChecksumOk(k.gstin)) e.gstin = "This GSTIN isn't valid. It has 15 characters, e.g. 09ABCDE1234F1Z5";
      else if (k.pan && PAN_RE.test(k.pan) && panFromGstin(k.gstin) !== k.pan) e.gstin = "This GSTIN belongs to a different PAN. Use the GSTIN of the PAN above.";
      else if (k.state && stateFromGstin(k.gstin) && stateFromGstin(k.gstin) !== k.state) e.state = `Your GSTIN is registered in ${stateFromGstin(k.gstin)}. Use the address of that registration.`;
    }
    if (!k.address || k.address.length < 8) e.address = "Enter your full billing address";
    if (!k.city) e.city = "Enter your city";
    if (!k.state || !INDIAN_STATES.some((s) => s.name === k.state)) e.state = e.state ?? "Choose your state";
    if (!k.pincode || !/^\d{6}$/.test(k.pincode)) e.pincode = "Enter a 6-digit pincode";
  }
  return e;
}

export const KYC_STEPS = [
  { n: 1, title: "Business details", note: "Tell us about your brand" },
  { n: 2, title: "Contact", note: "Where we reach you" },
  { n: 3, title: "Tax & billing", note: "For your GST invoices" },
] as const;
