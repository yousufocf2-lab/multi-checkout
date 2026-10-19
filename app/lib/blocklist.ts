import { INDIAN_STATES } from "./states";

/** What a store can block in the RTO Suite. */
export const BLOCK_KINDS = ["phone", "email", "pincode", "city", "state", "country"] as const;
export type BlockKind = (typeof BLOCK_KINDS)[number];
export const BLOCK_LABELS: Record<BlockKind, string> = {
  phone: "Mobile number", email: "Email", pincode: "Pincode / ZIP", city: "City", state: "State", country: "Country",
};

/** Call confirmation unlocks after this many completed orders. */
export const CALL_UNLOCK_ORDERS = 100;

export const CSV_SOURCES = ["shopify", "woocommerce", "other"] as const;
export type CsvSource = (typeof CSV_SOURCES)[number];
export const CSV_SOURCE_LABELS: Record<CsvSource, string> = { shopify: "Shopify orders export", woocommerce: "WooCommerce orders export", other: "Other (our simple format)" };

// ---------- normalisation (same rules for the block list and for checkout lookups) ----------

let regionNames: Map<string, string> | null = null;
/** Country name or code → ISO-3166 alpha-2 (IN, US, GB…). */
export function countryCode(v: string): string | null {
  const t = v.trim();
  if (!t) return null;
  if (/^[A-Za-z]{2}$/.test(t)) return t.toUpperCase();
  if (!regionNames) {
    regionNames = new Map();
    try {
      const dn = new Intl.DisplayNames(["en"], { type: "region" });
      for (let a = 65; a <= 90; a++) for (let b = 65; b <= 90; b++) {
        const code = String.fromCharCode(a, b);
        const name = dn.of(code);
        if (name && name !== code) regionNames.set(name.toLowerCase(), code);
      }
    } catch { /* no ICU data */ }
    for (const [k, v] of [["usa", "US"], ["united states of america", "US"], ["uk", "GB"], ["england", "GB"], ["uae", "AE"], ["bharat", "IN"], ["hindustan", "IN"]] as const) regionNames.set(k, v);
  }
  return regionNames.get(t.toLowerCase().replace(/\s+/g, " ")) ?? null;
}

/** Phone → digits. Indian numbers become the 10-digit mobile number; others keep their country code. */
export function normPhone(v: string, defaultCountry = "IN"): string | null {
  const d = v.replace(/\D/g, "");
  if (!d) return null;
  if (d.length === 10 && defaultCountry === "IN") return d;
  if (d.length === 11 && d.startsWith("0")) return defaultCountry === "IN" ? d.slice(1) : d.slice(1);
  if (d.length === 12 && d.startsWith("91")) return d.slice(2);
  if (d.length === 13 && d.startsWith("091")) return d.slice(3);
  return d.length >= 7 && d.length <= 15 ? d : null;
}

/** State name or code → lowercase full name for India ("UP" / "Uttar Pradesh" → "uttar pradesh"); other countries lowercase as given. */
export function normState(v: string, country = "IN"): string | null {
  const t = v.trim();
  if (!t) return null;
  if (country === "IN") {
    const byCode = INDIAN_STATES.find((s) => s.code === t.toUpperCase());
    if (byCode) return byCode.name.toLowerCase();
    const byName = INDIAN_STATES.find((s) => s.name.toLowerCase() === t.toLowerCase().replace(/\s+/g, " ").replace(/&/g, "and"));
    if (byName) return byName.name.toLowerCase();
  }
  return t.toLowerCase().replace(/\s+/g, " ");
}

export function normValue(kind: BlockKind, raw: string, ctx: { country?: string } = {}): string | null {
  const v = String(raw ?? "").replace(/^'+/, "").trim();
  if (!v) return null;
  switch (kind) {
    case "phone": return normPhone(v, ctx.country ?? "IN");
    case "email": return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) ? v.toLowerCase() : null;
    case "pincode": { const p = v.toUpperCase().replace(/\s+/g, ""); return /^[A-Z0-9-]{3,10}$/.test(p) ? p : null; }
    case "city": return v.toLowerCase().replace(/\s+/g, " ").slice(0, 80);
    case "state": return normState(v, ctx.country ?? "IN");
    case "country": return countryCode(v);
  }
}

/** Display a stored value nicely. */
export function showValue(kind: BlockKind, v: string) {
  if (kind === "city" || kind === "state") return v.replace(/\b\w/g, (c) => c.toUpperCase());
  if (kind === "phone" && v.length === 10) return `+91 ${v}`;
  return v;
}

// ---------- CSV ----------

/** RFC 4180 CSV parser: quoted fields, commas and newlines inside quotes, CR / LF / CRLF line endings. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let q = false;
  const s = text.replace(/^﻿/, "");
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (q) {
      if (ch === '"') { if (s[i + 1] === '"') { field += '"'; i++; } else q = false; }
      else field += ch;
    } else if (ch === '"') q = true;
    else if (ch === ",") { row.push(field); field = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && s[i + 1] === "\n") i++;
      row.push(field); field = "";
      if (row.some((c) => c.trim() !== "")) rows.push(row);
      row = [];
    } else field += ch;
  }
  row.push(field);
  if (row.some((c) => c.trim() !== "")) rows.push(row);
  return rows;
}

const col = (letters: string) => [...letters].reduce((n, c) => n * 26 + (c.charCodeAt(0) - 64), 0) - 1;

/** Where each field lives in each export: header names first, column letter as fallback. */
const LAYOUTS: Record<CsvSource, Record<BlockKind, { headers: string[]; letter: string }>> = {
  shopify: {
    email: { headers: ["Email"], letter: "B" },
    city: { headers: ["Shipping City", "Billing City"], letter: "AN" },
    pincode: { headers: ["Shipping Zip", "Billing Zip"], letter: "AO" },
    state: { headers: ["Shipping Province", "Billing Province", "Shipping Province Name"], letter: "AP" },
    country: { headers: ["Shipping Country", "Billing Country"], letter: "AQ" },
    phone: { headers: ["Shipping Phone", "Phone", "Billing Phone"], letter: "AR" },
  },
  woocommerce: {
    email: { headers: ["billing_email"], letter: "T" },
    phone: { headers: ["billing_phone", "shipping_phone"], letter: "U" },
    pincode: { headers: ["shipping_postcode", "billing_postcode"], letter: "AG" },
    city: { headers: ["shipping_city", "billing_city"], letter: "AH" },
    state: { headers: ["shipping_state", "billing_state"], letter: "AI" },
    country: { headers: ["shipping_country", "billing_country"], letter: "AJ" },
  },
  other: {
    email: { headers: ["email"], letter: "A" },
    phone: { headers: ["phone", "mobile", "phone number"], letter: "B" },
    pincode: { headers: ["pincode", "pin code", "zip", "postcode"], letter: "C" },
    city: { headers: ["city"], letter: "D" },
    state: { headers: ["state", "province"], letter: "E" },
    country: { headers: ["country"], letter: "F" },
  },
};

export type CsvExtract = { values: Record<BlockKind, Set<string>>; rows: number; skipped: number };

/**
 * Pull the chosen fields out of an orders export. Blank cells (e.g. Shopify's extra line-item rows) are skipped.
 * Country is read first so phones and states are normalised for the right country; missing country = the store's.
 */
export function extractFromCsv(text: string, source: CsvSource, kinds: BlockKind[], defaultCountry = "IN"): CsvExtract {
  const rows = parseCsv(text);
  const values = Object.fromEntries(BLOCK_KINDS.map((k) => [k, new Set<string>()])) as CsvExtract["values"];
  if (!rows.length) return { values, rows: 0, skipped: 0 };
  const layout = LAYOUTS[source];
  const header = rows[0].map((h) => h.trim().toLowerCase());
  const looksLikeHeader = header.some((h) => Object.values(layout).some((l) => l.headers.some((x) => x.toLowerCase() === h)));
  const idx = (k: BlockKind) => {
    if (looksLikeHeader) for (const h of layout[k].headers) { const i = header.indexOf(h.toLowerCase()); if (i >= 0) return [i]; }
    return [col(layout[k].letter)];
  };
  const pos = Object.fromEntries(BLOCK_KINDS.map((k) => [k, idx(k)])) as Record<BlockKind, number[]>;
  // Shopify: use billing columns as a second choice when shipping is blank
  const alt = (k: BlockKind) => (looksLikeHeader ? layout[k].headers.slice(1).map((h) => header.indexOf(h.toLowerCase())).filter((i) => i >= 0) : []);
  const cell = (r: string[], k: BlockKind) => {
    for (const i of [...pos[k], ...alt(k)]) { const v = (r[i] ?? "").replace(/^'+/, "").trim(); if (v) return v; }
    return "";
  };
  let skipped = 0;
  const data = looksLikeHeader ? rows.slice(1) : rows;
  for (const r of data) {
    const country = countryCode(cell(r, "country")) ?? defaultCountry;
    let any = false;
    for (const k of kinds) {
      const raw = cell(r, k);
      if (!raw) continue;
      const v = normValue(k, raw, { country });
      if (v) { values[k].add(v); any = true; }
    }
    if (!any) skipped++;
  }
  return { values, rows: data.length, skipped };
}
