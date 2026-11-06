// Page-speed beacon from Growpefy Store websites (LCP, INP, CLS of one page view). Always answers 204.
import type { ActionFunctionArgs } from "@remix-run/node";
import { db, storefrontVitals } from "~/db.server";
import { storeBySlug } from "~/lib/storefront.server";

const ids = new Map<string, { id: number | null; at: number }>();
const clamp = (v: unknown, max: number) => { const n = Number(v); return Number.isFinite(n) && n >= 0 && n <= max ? n : null; };

export async function action({ request }: ActionFunctionArgs) {
  const done = new Response(null, { status: 204, headers: { "Access-Control-Allow-Origin": "*" } });
  try {
    const text = (await request.text()).slice(0, 2000);
    const b = JSON.parse(text) as { s?: string; p?: string; d?: string; lcp?: number; inp?: number; cls?: number };
    if (!b.s || typeof b.s !== "string") return done;
    let hit = ids.get(b.s);
    if (!hit || Date.now() - hit.at > 10 * 60_000) {
      const s = await storeBySlug(b.s.slice(0, 80));
      hit = { id: s?.platform === "growpefy" ? s.id : null, at: Date.now() };
      ids.set(b.s, hit);
    }
    if (!hit.id) return done;
    const lcp = clamp(b.lcp, 60_000), inp = clamp(b.inp, 30_000), cls = clamp(b.cls, 10);
    if (lcp == null && inp == null && cls == null) return done;
    await db.insert(storefrontVitals).values({
      storeId: hit.id, page: typeof b.p === "string" ? b.p.slice(0, 20) : null, device: b.d === "desktop" ? "desktop" : "mobile",
      lcp: lcp == null ? null : Math.round(lcp), inp: inp == null ? null : Math.round(inp), cls,
    });
  } catch { /* ignore bad beacons */ }
  return done;
}

export const loader = () => new Response(null, { status: 405 });
