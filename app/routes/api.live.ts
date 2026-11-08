// Live view heartbeat from Growpefy Store websites and the checkout page. Always answers 204.
// Body (text/plain JSON): { s: store slug | c: checkout session id, u: tab id, p: path, r: root, d: device, t: title, src, q: cart qty, v: cart paise, e: "leave" }
import type { ActionFunctionArgs } from "@remix-run/node";
import { heartbeat, storeForSession } from "~/lib/live.server";
import { storeBySlug } from "~/lib/storefront.server";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type" };
const done = () => new Response(null, { status: 204, headers: cors });
const slugs = new Map<string, { id: number | null; at: number }>();
const ID = /^[a-zA-Z0-9_-]{8,80}$/;

export const loader = () => done();

export async function action({ request }: ActionFunctionArgs) {
  if (request.method === "OPTIONS") return done();
  try {
    const b = JSON.parse((await request.text()).slice(0, 2000)) as Record<string, unknown>;
    let storeId: number | null = null;
    let source = typeof b.src === "string" ? b.src : undefined;
    let session: string | undefined;
    let visitor = typeof b.u === "string" && ID.test(b.u) ? b.u : "";
    let path = typeof b.p === "string" ? b.p.split("?")[0].slice(0, 240) : "/";

    if (typeof b.c === "string" && ID.test(b.c)) {
      // Checkout page: one visitor per checkout session
      const s = await storeForSession(b.c);
      storeId = s.storeId;
      source = s.source || "direct";
      session = b.c;
      visitor = `c-${b.c}`;
      path = "/checkout";
    } else if (typeof b.s === "string" && b.s) {
      const slug = b.s.slice(0, 80);
      let hit = slugs.get(slug);
      if (!hit || Date.now() - hit.at > 10 * 60_000) {
        const s = await storeBySlug(slug);
        hit = { id: s && (s.platform === "growpefy" || s.storefrontEnabled) ? s.id : null, at: Date.now() };
        if (slugs.size > 5000) slugs.clear();
        slugs.set(slug, hit);
      }
      storeId = hit.id;
      const root = typeof b.r === "string" ? b.r.replace(/\/+$/, "") : "";
      if (root && path.startsWith(root)) path = path.slice(root.length) || "/";
      if (path.length > 1) path = path.replace(/\/+$/, "");
    }
    if (!storeId || !visitor) return done();

    heartbeat(storeId, {
      visitor, path,
      title: typeof b.t === "string" ? b.t : undefined,
      device: b.d === "desktop" ? "desktop" : "mobile",
      source, session, step: Number(b.st) || undefined,
      cartQty: Number(b.q) || 0, cartPaise: Number(b.v) || 0,
      leave: b.e === "leave",
    });
  } catch { /* ignore bad beacons */ }
  return done();
}
