// Live view: who is on a store's website and checkout right now.
// Browsers send a small heartbeat every ~15 s (and "leave" when the page closes). Presence lives in memory
// (one app instance): nothing personal is kept — a random per-tab id, the page, device and where they came from.
import { and, desc, eq, gte, inArray } from "drizzle-orm";
import { checkoutSessions, db, orders } from "~/db.server";

export type Stage = "home" | "browsing" | "product" | "cart" | "checkout";
export const STAGES: Stage[] = ["home", "browsing", "product", "cart", "checkout"];

type Visitor = {
  id: string; path: string; title: string; stage: Stage; device: "mobile" | "desktop";
  source: string; cartQty: number; cartPaise: number; firstSeen: number; lastSeen: number; expires: number; pages: number;
  // Checkout only: what the customer has typed so far, and the step they're on
  name?: string; place?: string; step?: 1 | 2 | 3; session?: string;
};
type LiveEvent = { id: number; at: number; kind: "join" | "cart" | "checkout" | "order" | "details" | "left"; text: string; sub?: string; session?: string };
type StoreLive = { visitors: Map<string, Visitor>; events: LiveEvent[]; history: { minute: number; n: number }[]; peak: { day: string; n: number; at: number } };

const ALIVE_MS = 45_000; // a heartbeat keeps a visitor for this long
const LEAVE_GRACE_MS = 6_000; // page closed: keep a moment so moving to the next page doesn't flicker
const MAX_VISITORS = 3000;
const MAX_EVENTS = 40;
const HISTORY_MIN = 30;

const live = new Map<number, StoreLive>();
let eventSeq = 1;

function bucket(storeId: number) {
  let b = live.get(storeId);
  if (!b) { b = { visitors: new Map(), events: [], history: [], peak: { day: istDay(Date.now()), n: 0, at: 0 } }; live.set(storeId, b); }
  return b;
}
const istDay = (t: number) => new Date(t + 5.5 * 3600_000).toISOString().slice(0, 10);

function push(b: StoreLive, e: Omit<LiveEvent, "id" | "at">) {
  b.events.unshift({ ...e, id: eventSeq++, at: Date.now() });
  if (b.events.length > MAX_EVENTS) b.events.length = MAX_EVENTS;
}

function prune(b: StoreLive, now = Date.now()) {
  for (const [k, v] of b.visitors) {
    if (v.expires > now) continue;
    b.visitors.delete(k);
    // Someone who typed their details and went away: it's now an abandoned checkout (unless an order came in)
    if (v.session && (v.name || v.place)) push(b, { kind: "left", text: `${v.name || "A customer"} left checkout`, sub: [v.place, v.cartPaise ? inr(v.cartPaise) : ""].filter(Boolean).join(" · ") || undefined, session: v.session });
  }
  const n = b.visitors.size;
  const minute = Math.floor(now / 60_000);
  const last = b.history[b.history.length - 1];
  if (last?.minute === minute) last.n = Math.max(last.n, n);
  else { b.history.push({ minute, n }); if (b.history.length > HISTORY_MIN + 2) b.history.splice(0, b.history.length - HISTORY_MIN - 2); }
  const day = istDay(now);
  if (b.peak.day !== day) b.peak = { day, n: 0, at: 0 };
  if (n > b.peak.n) b.peak = { day, n, at: now };
}

// Keeps history and peaks moving even when nobody polls
const g = globalThis as unknown as { __gpLiveTimer?: ReturnType<typeof setInterval> };
if (!g.__gpLiveTimer) {
  g.__gpLiveTimer = setInterval(() => { const now = Date.now(); for (const [id, b] of live) { prune(b, now); if (!b.visitors.size && !b.events.length && now - (b.history.at(-1)?.minute ?? 0) * 60_000 > 2 * 3600_000) live.delete(id); } }, 15_000);
  g.__gpLiveTimer.unref?.();
}

export function stageOf(path: string): Stage {
  if (path === "/" || path === "") return "home";
  if (path.startsWith("/product/") || path.startsWith("/products/") && path !== "/products/all") return "product";
  if (path === "/cart") return "cart";
  if (path === "/checkout") return "checkout";
  return "browsing";
}

const clean = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/[\u0000-\u001f<>]/g, "").trim().slice(0, max) : "");
const SOURCES: [RegExp, string][] = [
  [/instagram|^ig$/i, "Instagram"], [/facebook|^fb$|meta/i, "Facebook"], [/google/i, "Google"], [/youtube|youtu\.be/i, "YouTube"],
  [/whatsapp|wa\.me/i, "WhatsApp"], [/bing/i, "Bing"], [/twitter|^x$|t\.co/i, "X"], [/direct|^$/i, "Direct"],
];
export function sourceLabel(raw: string) {
  const s = raw.toLowerCase();
  for (const [re, label] of SOURCES) if (re.test(s)) return label;
  return raw.replace(/^www\./, "").slice(0, 30) || "Direct";
}

export type Beat = { visitor: string; path: string; title?: string; device?: string; source?: string; cartQty?: number; cartPaise?: number; leave?: boolean; step?: number; session?: string };

export function heartbeat(storeId: number, beat: Beat) {
  const b = bucket(storeId);
  const now = Date.now();
  const v = b.visitors.get(beat.visitor);
  if (beat.leave) { if (v) v.expires = Math.min(v.expires, now + LEAVE_GRACE_MS); return; }
  if (!v && b.visitors.size >= MAX_VISITORS) return;
  const path = beat.path || "/";
  const stage = stageOf(path);
  const title = clean(beat.title, 120);
  const cartQty = Math.max(0, Math.min(999, Math.round(Number(beat.cartQty) || 0)));
  const cartPaise = Math.max(0, Math.min(1e10, Math.round(Number(beat.cartPaise) || 0)));
  if (!v) {
    const source = sourceLabel(clean(beat.source, 60));
    b.visitors.set(beat.visitor, { id: beat.visitor, path, title, stage, device: beat.device === "desktop" ? "desktop" : "mobile", source, cartQty, cartPaise, firstSeen: now, lastSeen: now, expires: now + ALIVE_MS, pages: 1, session: beat.session, step: stepOf(beat.step) });
    if (stage === "checkout") push(b, { kind: "checkout", text: "Started checkout", sub: cartPaise ? inr(cartPaise) : undefined });
    else push(b, { kind: "join", text: `New visitor from ${source}`, sub: title || pageName(path) });
  } else {
    if (v.path !== path) v.pages++;
    if (cartQty > v.cartQty) push(b, { kind: "cart", text: "Added to cart", sub: `${cartQty} item${cartQty === 1 ? "" : "s"}${cartPaise ? ` · ${inr(cartPaise)}` : ""}` });
    if (stage === "checkout" && v.stage !== "checkout") push(b, { kind: "checkout", text: "Started checkout", sub: cartPaise ? inr(cartPaise) : undefined });
    Object.assign(v, { path, title: title || v.title, stage, cartQty, cartPaise: cartPaise || (cartQty ? v.cartPaise : 0), lastSeen: now, expires: now + ALIVE_MS, step: stepOf(beat.step) ?? v.step });
  }
  prune(b, now);
}

const stepOf = (n: unknown) => (n === 1 || n === 2 || n === 3 ? n : undefined);

/**
 * The checkout saved what the customer typed (name, address): show it on their live visitor right away.
 * Only the first name and a short place (city + pincode) are shown; the full details stay in the order/abandoned pages.
 */
export function checkoutDetails(storeId: number, sessionId: string, c: { firstName?: string; lastName?: string; city?: string; pincode?: string; address1?: string }) {
  const b = bucket(storeId);
  const now = Date.now();
  const key = `c-${sessionId}`;
  let v = b.visitors.get(key);
  if (!v) {
    v = { id: key, path: "/checkout", title: "", stage: "checkout", device: "mobile", source: "Direct", cartQty: 0, cartPaise: 0, firstSeen: now, lastSeen: now, expires: now + ALIVE_MS, pages: 1, session: sessionId };
    b.visitors.set(key, v);
  }
  const name = [c.firstName, c.lastName].map((x) => (x ?? "").trim()).filter(Boolean).join(" ").replace(/[<>]/g, "").slice(0, 40);
  const place = [(c.city ?? "").trim(), /^\d{6}$/.test(c.pincode ?? "") ? c.pincode : ""].filter(Boolean).join(" ").replace(/[<>]/g, "").slice(0, 40);
  const hadAddress = Boolean(v.place);
  if (name && !v.name) push(b, { kind: "details", text: `${name} is checking out`, sub: v.cartPaise ? inr(v.cartPaise) : undefined, session: sessionId });
  if (name) v.name = name;
  if (place && (c.address1 ?? "").trim().length >= 3) {
    v.place = place;
    if (!hadAddress) push(b, { kind: "details", text: `${v.name || "Customer"} added address`, sub: place, session: sessionId });
  }
  v.lastSeen = now; v.expires = Math.max(v.expires, now + ALIVE_MS);
}

/** Checkout sessions that still have someone on the page (not abandoned yet). */
export function liveSessions(storeIds: number[]) {
  const out = new Set<string>();
  const now = Date.now();
  for (const id of storeIds) for (const v of live.get(id)?.visitors.values() ?? []) if (v.session && v.expires > now) out.add(v.session);
  return out;
}

const inr = (p: number) => `₹${(p / 100).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
function pageName(path: string) {
  if (path === "/") return "Home page";
  if (path === "/products/all") return "All products";
  if (path === "/cart") return "Cart";
  if (path === "/checkout") return "Checkout";
  const m = path.match(/^\/(category|product|pages)\/([^/]+)/);
  if (m) return decodeURIComponent(m[2]).replace(/-/g, " ").replace(/^\w/, (c) => c.toUpperCase()).slice(0, 60);
  return path.slice(0, 60);
}

// Checkout sessions → store (cached, a checkout heartbeat only carries the session id)
const sessionStore = new Map<string, { storeId: number | null; source: string; at: number }>();
export async function storeForSession(sessionId: string) {
  const hit = sessionStore.get(sessionId);
  if (hit && Date.now() - hit.at < 30 * 60_000) return hit;
  const [s] = await db.select({ storeId: checkoutSessions.storeId, tracking: checkoutSessions.tracking }).from(checkoutSessions).where(eq(checkoutSessions.id, sessionId)).limit(1);
  if (sessionStore.size > 20_000) sessionStore.clear();
  const t = s?.tracking;
  const source = t?.src || (t?.fbc ? "facebook" : t?.gclid ? "google" : "") || (t?.sourceUrl && /utm_source=([^&]+)/.exec(t.sourceUrl)?.[1]) || "";
  const row = { storeId: s?.storeId ?? null, source, at: Date.now() };
  sessionStore.set(sessionId, row);
  return row;
}

const avatarHue = (id: string) => { let h = 0; for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) % 360; return h; };

/** Everything the Live view shows, for one store. */
export async function liveSnapshot(storeId: number) {
  const b = bucket(storeId);
  const now = Date.now();
  prune(b, now);
  const list = [...b.visitors.values()];
  const count = (f: (v: Visitor) => boolean) => list.filter(f).length;
  const tally = (key: (v: Visitor) => string) => {
    const m = new Map<string, number>();
    for (const v of list) m.set(key(v), (m.get(key(v)) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([label, n]) => ({ label, n }));
  };

  // Orders placed in the last 30 minutes join the activity feed
  const since = new Date(now - 30 * 60_000);
  const recent = await db.select({ id: orders.id, sessionId: orders.sessionId, total: orders.total, method: orders.paymentMethod, status: orders.status, createdAt: orders.createdAt, customer: orders.customer })
    .from(orders).where(and(eq(orders.storeId, storeId), gte(orders.createdAt, since), inArray(orders.status, ["paid", "cod_placed"])))
    .orderBy(desc(orders.createdAt)).limit(10).catch(() => []);
  const orderEvents = recent.map((o, i) => ({
    id: -1 - i, at: o.createdAt.getTime(), kind: "order" as const,
    text: `Order placed${o.customer?.city ? ` · ${o.customer.city}` : ""}`,
    sub: `${inr(o.total)} · ${o.method === "cod" ? "COD" : o.method === "partial" ? "Partial COD" : "Prepaid"}`,
  }));
  const ordered = new Set(recent.map((o) => o.sessionId).filter(Boolean));
  const events = [...b.events.filter((e) => !(e.kind === "left" && e.session && ordered.has(e.session))), ...orderEvents].sort((a, b) => b.at - a.at).slice(0, 25)
    .map((e) => ({ at: e.at, kind: e.kind, text: e.text, sub: e.sub, id: e.kind === "order" ? `o${e.at}` : `e${e.id}` }));

  const minute = Math.floor(now / 60_000);
  const byMinute = new Map(b.history.map((h) => [h.minute, h.n]));
  const history = Array.from({ length: HISTORY_MIN }, (_, i) => byMinute.get(minute - (HISTORY_MIN - 1 - i)) ?? 0);
  history[HISTORY_MIN - 1] = Math.max(history[HISTORY_MIN - 1], list.length);

  return {
    now,
    total: list.length,
    stages: Object.fromEntries(STAGES.map((s) => [s, count((v) => v.stage === s)])) as Record<Stage, number>,
    devices: { mobile: count((v) => v.device === "mobile"), desktop: count((v) => v.device === "desktop") },
    cartValuePaise: list.reduce((a, v) => a + (v.cartQty ? v.cartPaise : 0), 0),
    pages: tally((v) => v.title || pageName(v.path)),
    sources: tally((v) => v.source),
    visitors: list.sort((a, b) => a.firstSeen - b.firstSeen).slice(0, 60).map((v) => ({
      key: v.id.slice(-10), name: v.name || `Visitor ${v.id.replace(/[^a-z0-9]/gi, "").slice(-4).toUpperCase()}`, known: Boolean(v.name), hue: avatarHue(v.id),
      place: v.place ?? null, step: v.step ?? null,
      page: v.title || pageName(v.path), stage: v.stage, device: v.device, source: v.source,
      since: v.firstSeen, pages: v.pages, cartQty: v.cartQty, cartPaise: v.cartPaise,
    })),
    events,
    history,
    peak: { n: b.peak.n, at: b.peak.at },
  };
}
export type LiveSnapshot = Awaited<ReturnType<typeof liveSnapshot>>;

/** Just the number, for small badges. */
export function liveCount(storeId: number) {
  const b = live.get(storeId);
  if (!b) return 0;
  prune(b);
  return b.visitors.size;
}
