// A shopper's photo or short video for a product review. Body = the file; headers: Content-Type, X-Store (store slug).
// Allowed only when the store has reviews on and allows that kind of file (Settings → Widgets → Reviews).
import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { mediaReady, uploadMedia, IMAGE_TYPES, VIDEO_TYPES } from "~/lib/media.server";
import { clientIp } from "~/lib/orders.server";
import { storeBySlug } from "~/lib/storefront.server";
import { widgetSettings } from "~/lib/widgets";

const MAX_IMAGE = 8 * 1024 * 1024;
const MAX_VIDEO = 40 * 1024 * 1024;
const hits = new Map<string, { n: number; at: number }>();

export const loader = () => json({ error: "POST only" }, { status: 405 });

export async function action({ request }: ActionFunctionArgs) {
  // A few uploads per visitor per hour is plenty for a review
  const ip = clientIp(request) || "unknown";
  const h = hits.get(ip);
  const now = Date.now();
  if (h && now - h.at < 3600_000 && h.n >= 30) return json({ error: "Too many uploads. Please try again later." }, { status: 429 });
  hits.set(ip, h && now - h.at < 3600_000 ? { n: h.n + 1, at: h.at } : { n: 1, at: now });
  if (hits.size > 20000) hits.clear();

  const store = await storeBySlug(String(request.headers.get("x-store") ?? "").slice(0, 80));
  if (!store || !store.active) return json({ error: "Store not found." }, { status: 404 });
  const r = widgetSettings(store.widgetSettings).reviews;
  if (!r.enabled) return json({ error: "Reviews are switched off." }, { status: 403 });
  const type = (request.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  const isVideo = type in VIDEO_TYPES, isImage = type in IMAGE_TYPES;
  if ((!isVideo && !isImage) || (isVideo && !r.allowVideos) || (isImage && !r.allowPhotos)) return json({ error: isVideo ? "Videos can't be added to reviews here." : "Only photos and short videos can be added." }, { status: 400 });
  const size = Number(request.headers.get("content-length") ?? 0);
  if (!size) return json({ error: "Please try again." }, { status: 411 });
  if (size > (isVideo ? MAX_VIDEO : MAX_IMAGE)) return json({ error: isVideo ? "That video is too big (40 MB max). Try a shorter clip." : "That photo is too big (8 MB max)." }, { status: 400 });
  if (!mediaReady() || !request.body) return json({ error: "Upload isn't available right now." }, { status: 503 });
  try {
    const up = await uploadMedia(store.id, type, request.body, size);
    console.log(`[review-media] store=${store.id} ${up.kind} ${Math.round(up.bytes / 1024)}KB`);
    return json({ url: up.url, type: up.type });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "Upload failed" }, { status: 400 });
  }
}
