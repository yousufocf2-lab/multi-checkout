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
  v?: number; // 2 = current KYC (personal → business → tax → address → documents → review)
  // Personal
  contactName?: string;
  phone?: string;
  phoneVerified?: string; // the number that was verified by OTP
  altPhone?: string;
  email?: string;
  emailVerified?: string; // the email that was verified by OTP
  altEmail?: string;
  whatsapp?: string;
  // Business
  brandName?: string;
  businessType?: BusinessType;
  category?: string;
  website?: string;
  // Tax
  pan?: string;
  legalName?: string; // name as per PAN
  gstin?: string;
  // Address
  address?: string;
  landmark?: string;
  city?: string;
  state?: string; // full state name (same as wallet billing)
  pincode?: string;
  geo?: { lat: number; lng: number };
  // Progress
  step?: number; // old 3-step KYC
  v2Step?: number; // last completed step of the current KYC
  submittedAt?: string;
};

export type KycStatus = "pending" | "approved" | "rejected";

/** PAN: 5 letters (4th = holder type), 4 digits (not 0000), 1 letter. */
export const PAN_RE = /^[A-Z]{3}[PCHFATBLJG][A-Z](?!0000)[0-9]{4}[A-Z]$/;
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

/**
 * The 5th PAN letter is the first letter of the holder's surname (people) or of the name (businesses).
 * People: accept it matching any word of the name, since surnames are written in different orders.
 */
export function panNameMatches(pan: string, name: string) {
  const words = name.toUpperCase().replace(/[^A-Z ]/g, " ").split(/\s+/).filter((w) => w && !["MR", "MRS", "MS", "DR", "M/S", "SHRI", "SMT", "THE"].includes(w));
  if (!words.length) return false;
  const c = pan[4];
  return pan[3] === "P" ? words.some((w) => w[0] === c) : words[0][0] === c || words.some((w) => w[0] === c);
}

/** Soft warning when the PAN type doesn't fit the chosen business type. */
export function panTypeWarning(pan: string, type?: BusinessType): string | null {
  if (!PAN_RE.test(pan) || !type) return null;
  const k = pan[3];
  if ((type === "pvt_ltd" || type === "public_ltd") && k !== "C") return "Companies usually have a company PAN (4th letter C). Check the PAN.";
  if ((type === "partnership" || type === "llp") && k !== "F") return "Firms and LLPs usually have a firm PAN (4th letter F). Check the PAN.";
  if ((type === "individual" || type === "proprietor") && k !== "P") return "Individuals and proprietors usually use a personal PAN (4th letter P). Check the PAN.";
  return null;
}

export type KycErrors = Partial<Record<keyof KycData | "form" | "docs" | "panDoc" | "gstDoc" | "declare", string>>;

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
export const MOBILE_RE = /^[6-9]\d{9}$/;
/** Name as on PAN: letters, spaces, dots, & and a few business symbols. */
const NAME_RE = /^[A-Za-z][A-Za-z .&'()\-/,]{1,159}$/;

/** Checks one step of the KYC. `ready` = whether OTP can be sent on that channel (else verification is skipped). */
export function validateStep(step: number, k: KycData, ready: { phone: boolean; email: boolean } = { phone: true, email: true }): KycErrors {
  const e: KycErrors = {};
  if (step === 1) {
    if (!k.contactName || k.contactName.length < 2) e.contactName = "Enter your full name";
    if (!k.phone || !MOBILE_RE.test(k.phone)) e.phone = "Enter a valid 10-digit mobile number";
    else if (ready.phone && k.phoneVerified !== k.phone) e.phone = "Verify this mobile number with the OTP";
    if (k.altPhone && !MOBILE_RE.test(k.altPhone)) e.altPhone = "Enter a valid 10-digit mobile number";
    else if (k.altPhone && k.altPhone === k.phone) e.altPhone = "Use a different number than your main one";
    if (!k.email || !EMAIL_RE.test(k.email)) e.email = "Enter a valid email address";
    else if (ready.email && k.emailVerified !== k.email) e.email = "Verify this email with the OTP";
    if (k.altEmail && !EMAIL_RE.test(k.altEmail)) e.altEmail = "Enter a valid email address";
    else if (k.altEmail && k.altEmail === k.email) e.altEmail = "Use a different email than your main one";
  }
  if (step === 2) {
    if (!k.brandName || k.brandName.length < 2) e.brandName = "Enter your brand name";
    if (!k.businessType) e.businessType = "Choose your business type";
    if (!k.category) e.category = "Choose what you sell";
    if (k.website && !/^(https?:\/\/)?[a-z0-9-]+(\.[a-z0-9-]+)+(\/.*)?$/i.test(k.website)) e.website = "Enter a website like mybrand.com";
  }
  if (step === 3) {
    if (!k.pan || !PAN_RE.test(k.pan)) e.pan = "Enter a valid PAN: 5 letters, 4 digits, 1 letter (e.g. ABCPK1234F). The 4th letter shows the holder type (P for a person, C for a company, F for a firm…).";
    if (!k.legalName || !NAME_RE.test(k.legalName)) e.legalName = "Enter the name exactly as on your PAN card";
    else if (k.pan && PAN_RE.test(k.pan) && !panNameMatches(k.pan, k.legalName)) e.legalName = `This name doesn't match the PAN. The 5th letter of the PAN (${k.pan[4]}) is the first letter of the ${k.pan[3] === "P" ? "surname" : "business name"} on the PAN.`;
    if (k.gstin) {
      if (!GSTIN_RE.test(k.gstin)) e.gstin = "GSTIN must be 15 characters: 2-digit state code, your PAN, 1 entity digit/letter, Z and a check character";
      else if (!stateFromGstin(k.gstin)) e.gstin = "The first 2 digits aren't a valid GST state code";
      else if (!PAN_RE.test(panFromGstin(k.gstin))) e.gstin = "Characters 3 to 12 of a GSTIN are a PAN, and these aren't a valid PAN";
      else if (!gstinChecksumOk(k.gstin)) e.gstin = "This GSTIN isn't valid (the last character doesn't match). Check it on your GST certificate.";
      else if (k.pan && PAN_RE.test(k.pan) && panFromGstin(k.gstin) !== k.pan) e.gstin = "This GSTIN belongs to a different PAN. Use the GSTIN of the PAN above.";
    }
  }
  if (step === 4) {
    if (!k.address || k.address.length < 8) e.address = "Enter house / building, street and area";
    if (!k.city) e.city = "Enter your city";
    if (!k.state || !INDIAN_STATES.some((s) => s.name === k.state)) e.state = "Choose your state";
    if (!k.pincode || !/^[1-9]\d{5}$/.test(k.pincode)) e.pincode = "Enter a valid 6-digit pincode";
    if (!e.state && k.gstin && GSTIN_RE.test(k.gstin) && stateFromGstin(k.gstin) && stateFromGstin(k.gstin) !== k.state) e.state = `Your GSTIN is registered in ${stateFromGstin(k.gstin)}. Use the address of that registration.`;
  }
  return e;
}

/** GSTIN passes every check (format, state code, checksum, matches the PAN). */
export const gstVerified = (k: KycData) => Boolean(k.gstin && k.pan && GSTIN_RE.test(k.gstin) && stateFromGstin(k.gstin) && gstinChecksumOk(k.gstin) && panFromGstin(k.gstin) === k.pan);

export const KYC_STEPS = [
  { n: 1, title: "Personal details", note: "Mobile & email, verified" },
  { n: 2, title: "Business details", note: "Your brand" },
  { n: 3, title: "PAN & GST", note: "Tax identity" },
  { n: 4, title: "Address", note: "Business address" },
  { n: 5, title: "Documents", note: "PAN card & GST" },
  { n: 6, title: "Review & submit", note: "Check and confirm" },
] as const;
export const KYC_LAST = 6;

export const DOC_KINDS = { pan: "PAN card", gst: "GST certificate", other: "Other document" } as const;
export type DocKind = keyof typeof DOC_KINDS;
export const DOC_MAX_BYTES = 5 * 1024 * 1024;
export const DOC_TYPES = ["application/pdf", "image/jpeg", "image/png", "image/webp"];

/** Does this owner still need to (re)do KYC? Owners from before the current KYC must do it once. */
export const kycIncomplete = (u: { kycStatus: string; kyc: KycData }) => u.kycStatus !== "approved" || (u.kyc.v ?? 1) < 2;
