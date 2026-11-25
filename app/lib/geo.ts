// Where a visitor or a customer is, worked out from their IP address (city level, never exact).
// Shared by the server and the dashboard, so no server-only imports here.

export type Geo = {
  city?: string;
  region?: string; // state / province, e.g. "Telangana", "California"
  country?: string; // full name, e.g. "India"
  cc?: string; // ISO country code, e.g. "IN"
  postal?: string;
  lat?: number;
  lon?: number;
  tz?: string;
  isp?: string;
};

/** "Hyderabad, Telangana, India" (country left out when the caller already shows it). */
export function placeOf(g: Geo | null | undefined, opts: { country?: boolean } = {}) {
  if (!g) return "";
  const parts = [g.city, g.region && g.region !== g.city ? g.region : undefined];
  if (opts.country !== false) parts.push(g.country ?? g.cc);
  return parts.filter(Boolean).join(", ");
}

/** Short label for lists: "Hyderabad, Telangana" in India, "California, United States" abroad. */
export function shortPlace(g: Geo | null | undefined) {
  if (!g) return "";
  if (!g.cc || g.cc === "IN") return [g.city, g.region].filter(Boolean).join(", ") || g.country || "";
  return [g.city || g.region, g.country ?? g.cc].filter(Boolean).join(", ");
}

export const hasPoint = (g: Geo | null | undefined): g is Geo & { lat: number; lon: number } =>
  Boolean(g && Number.isFinite(g.lat) && Number.isFinite(g.lon) && !(g.lat === 0 && g.lon === 0));

/** Country flag emoji from the ISO code. */
export function flagOf(cc: string | undefined) {
  if (!cc || !/^[A-Z]{2}$/i.test(cc)) return "";
  return String.fromCodePoint(...[...cc.toUpperCase()].map((c) => 0x1f1a5 + c.charCodeAt(0)));
}

const cleanText = (v: unknown, n = 60) => (typeof v === "string" ? v.replace(/[\u0000-\u001f<>"]/g, "").trim().slice(0, n) || undefined : undefined);
const num = (v: unknown, lim: number) => {
  const x = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(x) && Math.abs(x) <= lim ? Math.round(x * 1000) / 1000 : undefined;
};

/** Validates a geo object from any source (header, API, stored JSON). Null when nothing useful is left. */
export function cleanGeo(v: unknown): Geo | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const g: Geo = {
    city: cleanText(o.city), region: cleanText(o.region), country: cleanText(o.country),
    cc: typeof o.cc === "string" && /^[A-Za-z]{2}$/.test(o.cc) ? o.cc.toUpperCase() : undefined,
    postal: cleanText(o.postal, 12), lat: num(o.lat, 90), lon: num(o.lon, 180), tz: cleanText(o.tz, 40), isp: cleanText(o.isp, 80),
  };
  for (const k of Object.keys(g) as (keyof Geo)[]) if (g[k] === undefined) delete g[k];
  return g.city || g.region || g.country || g.cc ? g : null;
}

// ---------------- browser / device from the user agent ----------------

export type DeviceInfo = { device: "Mobile" | "Tablet" | "Desktop"; os: string; browser: string; inApp?: string };

export function parseUa(ua: string | null | undefined): DeviceInfo | null {
  if (!ua) return null;
  const tablet = /iPad|Tablet|SM-T|Tab\b/i.test(ua);
  const mobile = !tablet && /Mobi|Android|iPhone|iPod/i.test(ua);
  let os = "Other";
  const android = ua.match(/Android\s([\d.]+)/);
  const ios = ua.match(/(?:iPhone|CPU) OS (\d+)[_.](\d+)/);
  if (android) os = `Android ${android[1].split(".")[0]}`;
  else if (ios) os = `iOS ${ios[1]}.${ios[2]}`;
  else if (/Windows NT 10/.test(ua)) os = "Windows 10/11";
  else if (/Windows/.test(ua)) os = "Windows";
  else if (/Mac OS X/.test(ua)) os = "macOS";
  else if (/CrOS/.test(ua)) os = "ChromeOS";
  else if (/Linux/.test(ua)) os = "Linux";
  const inApp = /Instagram/i.test(ua) ? "Instagram app" : /FBAN|FBAV|FB_IAB|FBIOS/i.test(ua) ? "Facebook app" : /WhatsApp/i.test(ua) ? "WhatsApp" : /Snapchat/i.test(ua) ? "Snapchat" : /\bwv\)|; wv\b/.test(ua) ? "In-app browser" : undefined;
  let browser = "Browser";
  const pick = (re: RegExp, name: string) => { const m = ua.match(re); return m ? `${name} ${m[1].split(".")[0]}` : null; };
  browser = pick(/EdgA?\/([\d.]+)/, "Edge") ?? pick(/SamsungBrowser\/([\d.]+)/, "Samsung Internet") ?? pick(/OPR\/([\d.]+)/, "Opera")
    ?? pick(/Firefox\/([\d.]+)/, "Firefox") ?? pick(/CriOS\/([\d.]+)/, "Chrome") ?? pick(/Chrome\/([\d.]+)/, "Chrome")
    ?? (/Safari/.test(ua) ? pick(/Version\/([\d.]+)/, "Safari") : null) ?? browser;
  return { device: tablet ? "Tablet" : mobile ? "Mobile" : "Desktop", os, browser, inApp };
}
