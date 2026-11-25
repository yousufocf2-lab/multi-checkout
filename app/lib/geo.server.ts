// City-level location for an IP address.
// 1. Store domains come through our Cloudflare Worker, which knows the visitor's city for free (request.cf).
//    server.mjs passes it on as X-Geo, only when the request carries our shared key (nobody else can set it).
// 2. Cloudflare's own visitor-location headers (cf-ipcity…), when the zone has them switched on.
// 3. Otherwise a lookup on freeipapi.com (no key, commercial use allowed, ~60 a minute), cached in memory.
import { cleanGeo, type Geo } from "./geo";

/** Location the edge already worked out for this request (no network call). */
export function geoFromHeaders(request: Request): Geo | null {
  const raw = request.headers.get("x-geo");
  if (raw) {
    try { const g = cleanGeo(JSON.parse(decodeURIComponent(raw))); if (g) return g; } catch { /* bad header */ }
  }
  const h = (k: string) => request.headers.get(k) ?? undefined;
  const city = h("cf-ipcity"), cc = h("cf-ipcountry");
  if (city || (cc && cc !== "XX" && cc !== "T1")) {
    return cleanGeo({ city, cc, region: h("cf-region"), postal: h("cf-postal-code"), lat: h("cf-iplatitude"), lon: h("cf-iplongitude"), tz: h("cf-timezone"), country: cc ? countryName(cc) : undefined });
  }
  return null;
}

const PRIVATE = /^(10\.|127\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|0\.|::1$|fc|fd|fe80:)/i;
const IP = /^[\d.]{7,15}$|^[\da-f:]{3,45}$/i;

type Hit = { geo: Geo | null; at: number };
const cache = new Map<string, Hit>();
const pending = new Map<string, Promise<Geo | null>>();
const CACHE_MS = 24 * 3600_000;
const MISS_MS = 30 * 60_000;
let windowStart = 0, used = 0;
const PER_MINUTE = 45; // stay under the free limit

export function cachedGeo(ip: string | null | undefined): Geo | null | undefined {
  if (!ip) return null;
  const hit = cache.get(ip);
  if (!hit) return undefined;
  if (Date.now() - hit.at > (hit.geo ? CACHE_MS : MISS_MS)) { cache.delete(ip); return undefined; }
  return hit.geo;
}

/** Looks an IP up (cached). Null for private / unknown IPs or when the lookup service is busy. */
export async function lookupIp(ip: string | null | undefined): Promise<Geo | null> {
  if (!ip || !IP.test(ip) || PRIVATE.test(ip)) return null;
  const known = cachedGeo(ip);
  if (known !== undefined) return known;
  const running = pending.get(ip);
  if (running) return running;
  const now = Date.now();
  if (now - windowStart > 60_000) { windowStart = now; used = 0; }
  if (used >= PER_MINUTE) return null; // try again on a later request
  used++;
  const p = (async () => {
    try {
      const r = await fetch(`https://freeipapi.com/api/json/${encodeURIComponent(ip)}`, { signal: AbortSignal.timeout(3000), headers: { Accept: "application/json" } });
      if (r.status === 429) return null;
      const d = (await r.json().catch(() => null)) as Record<string, unknown> | null;
      const geo = d ? cleanGeo({
        city: d.cityName, region: d.regionName, country: d.countryName, cc: d.countryCode, postal: d.zipCode,
        lat: d.latitude, lon: d.longitude, tz: Array.isArray(d.timeZones) ? d.timeZones[0] : d.timeZone, isp: d.asnOrganization ?? d.isp,
      }) : null;
      if (cache.size > 50_000) cache.clear();
      cache.set(ip, { geo, at: Date.now() });
      return geo;
    } catch {
      return null;
    } finally {
      pending.delete(ip);
    }
  })();
  pending.set(ip, p);
  return p;
}

/** Best location for a request: the edge's answer, else a lookup of the IP (only when `lookup` is true). */
export async function geoForRequest(request: Request, ip: string | null | undefined, lookup = true): Promise<Geo | null> {
  return geoFromHeaders(request) ?? (lookup ? lookupIp(ip) : cachedGeo(ip) ?? null);
}

let names: Intl.DisplayNames | null = null;
export function countryName(cc: string) {
  try {
    names ??= new Intl.DisplayNames(["en"], { type: "region" });
    return names.of(cc.toUpperCase()) ?? cc;
  } catch { return cc; }
}
