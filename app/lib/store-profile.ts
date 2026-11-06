// Store profile options shared by the server and the browser: business types, countries, currencies, time zones, order IDs.
import type { EntityType, PostalAddress } from "~/db/schema";

export const BUSINESS_TYPES: { id: EntityType; label: string; group: "Individual" | "Company" | "Other" }[] = [
  { id: "individual", label: "Individual (no registered business)", group: "Individual" },
  { id: "sole_proprietorship", label: "Sole proprietorship", group: "Individual" },
  { id: "partnership", label: "Partnership firm", group: "Company" },
  { id: "llp", label: "Limited liability partnership (LLP)", group: "Company" },
  { id: "private_limited", label: "Private limited company", group: "Company" },
  { id: "public_limited", label: "Public limited company", group: "Company" },
  { id: "trust_society", label: "Trust, society or NGO", group: "Other" },
  { id: "other", label: "Other", group: "Other" },
];
export const businessTypeLabel = (t?: string | null) => BUSINESS_TYPES.find((b) => b.id === t)?.label ?? null;

/** Countries a store can be based in, with the currency, time zone and units they usually use. */
export const COUNTRIES: { code: string; name: string; flag: string; currency: string; timezone: string; dial: string; imperial?: boolean }[] = [
  { code: "IN", name: "India", flag: "🇮🇳", currency: "INR", timezone: "Asia/Kolkata", dial: "+91" },
  { code: "AE", name: "United Arab Emirates", flag: "🇦🇪", currency: "AED", timezone: "Asia/Dubai", dial: "+971" },
  { code: "SA", name: "Saudi Arabia", flag: "🇸🇦", currency: "SAR", timezone: "Asia/Riyadh", dial: "+966" },
  { code: "QA", name: "Qatar", flag: "🇶🇦", currency: "QAR", timezone: "Asia/Qatar", dial: "+974" },
  { code: "KW", name: "Kuwait", flag: "🇰🇼", currency: "KWD", timezone: "Asia/Kuwait", dial: "+965" },
  { code: "OM", name: "Oman", flag: "🇴🇲", currency: "OMR", timezone: "Asia/Muscat", dial: "+968" },
  { code: "BH", name: "Bahrain", flag: "🇧🇭", currency: "BHD", timezone: "Asia/Bahrain", dial: "+973" },
  { code: "NP", name: "Nepal", flag: "🇳🇵", currency: "NPR", timezone: "Asia/Kathmandu", dial: "+977" },
  { code: "BD", name: "Bangladesh", flag: "🇧🇩", currency: "BDT", timezone: "Asia/Dhaka", dial: "+880" },
  { code: "LK", name: "Sri Lanka", flag: "🇱🇰", currency: "LKR", timezone: "Asia/Colombo", dial: "+94" },
  { code: "SG", name: "Singapore", flag: "🇸🇬", currency: "SGD", timezone: "Asia/Singapore", dial: "+65" },
  { code: "MY", name: "Malaysia", flag: "🇲🇾", currency: "MYR", timezone: "Asia/Kuala_Lumpur", dial: "+60" },
  { code: "GB", name: "United Kingdom", flag: "🇬🇧", currency: "GBP", timezone: "Europe/London", dial: "+44" },
  { code: "US", name: "United States", flag: "🇺🇸", currency: "USD", timezone: "America/New_York", dial: "+1", imperial: true },
  { code: "CA", name: "Canada", flag: "🇨🇦", currency: "CAD", timezone: "America/Toronto", dial: "+1" },
  { code: "AU", name: "Australia", flag: "🇦🇺", currency: "AUD", timezone: "Australia/Sydney", dial: "+61" },
  { code: "NZ", name: "New Zealand", flag: "🇳🇿", currency: "NZD", timezone: "Pacific/Auckland", dial: "+64" },
  { code: "DE", name: "Germany", flag: "🇩🇪", currency: "EUR", timezone: "Europe/Berlin", dial: "+49" },
  { code: "FR", name: "France", flag: "🇫🇷", currency: "EUR", timezone: "Europe/Paris", dial: "+33" },
  { code: "NL", name: "Netherlands", flag: "🇳🇱", currency: "EUR", timezone: "Europe/Amsterdam", dial: "+31" },
  { code: "ZA", name: "South Africa", flag: "🇿🇦", currency: "ZAR", timezone: "Africa/Johannesburg", dial: "+27" },
  { code: "KE", name: "Kenya", flag: "🇰🇪", currency: "KES", timezone: "Africa/Nairobi", dial: "+254" },
];
export const countryOf = (code?: string | null) => COUNTRIES.find((c) => c.code === code) ?? COUNTRIES[0];

export const CURRENCIES: { code: string; name: string; symbol: string }[] = [
  { code: "INR", name: "Indian rupee", symbol: "₹" },
  { code: "USD", name: "US dollar", symbol: "$" },
  { code: "EUR", name: "Euro", symbol: "€" },
  { code: "GBP", name: "British pound", symbol: "£" },
  { code: "AED", name: "UAE dirham", symbol: "AED" },
  { code: "SAR", name: "Saudi riyal", symbol: "SAR" },
  { code: "QAR", name: "Qatari riyal", symbol: "QAR" },
  { code: "KWD", name: "Kuwaiti dinar", symbol: "KWD" },
  { code: "OMR", name: "Omani rial", symbol: "OMR" },
  { code: "BHD", name: "Bahraini dinar", symbol: "BHD" },
  { code: "NPR", name: "Nepalese rupee", symbol: "Rs" },
  { code: "BDT", name: "Bangladeshi taka", symbol: "৳" },
  { code: "LKR", name: "Sri Lankan rupee", symbol: "Rs" },
  { code: "SGD", name: "Singapore dollar", symbol: "S$" },
  { code: "MYR", name: "Malaysian ringgit", symbol: "RM" },
  { code: "CAD", name: "Canadian dollar", symbol: "C$" },
  { code: "AUD", name: "Australian dollar", symbol: "A$" },
  { code: "NZD", name: "New Zealand dollar", symbol: "NZ$" },
  { code: "ZAR", name: "South African rand", symbol: "R" },
  { code: "KES", name: "Kenyan shilling", symbol: "KSh" },
];
export const currencyOf = (code?: string | null) => CURRENCIES.find((c) => c.code === code) ?? CURRENCIES[0];

export const TIMEZONES = [...new Set(COUNTRIES.map((c) => c.timezone))].sort();

/** "#" + prefix + number + suffix. Prefix and suffix keep letters, digits and - _ / only. */
export const cleanAffix = (v: string) => v.trim().replace(/[^A-Za-z0-9\-_/]/g, "").slice(0, 12);
export const orderName = (prefix: string, n: number, suffix: string) => `#${prefix}${n}${suffix}`;

export function addressLines(a?: PostalAddress | null) {
  if (!a) return [];
  const country = a.country ? countryOf(a.country).name : "";
  return [a.line1, a.line2, [a.city, a.state, a.pincode].filter(Boolean).join(", "), country].filter((x) => x && x.trim()) as string[];
}

export const GSTIN_RE = /^\d{2}[A-Z]{5}\d{4}[A-Z][A-Z\d]Z[A-Z\d]$/;
export const PAN_RE = /^[A-Z]{5}\d{4}[A-Z]$/;
