// A round, rotating dot-globe (canvas, no libraries). Drag to spin, pinch / +/− to zoom, tap a marker for details.
// Land is ~7,000 dots precomputed in public/globe-land.json; visitors and recent orders are drawn on top.
import { useEffect, useImperativeHandle, useRef, useState, forwardRef } from "react";
import { Icon } from "./Icons";

export type GlobePoint = { k: string; lat: number; lon: number; place: string; stage?: string; page?: string; source?: string; device?: string; name?: string | null; store?: string | null; cartPaise?: number };
export type GlobeOrder = { id: string; lat: number; lon: number; place: string; at: number; amountPaise: number; store?: string | null };
export type GlobeHandle = { focus: (lat: number, lon: number) => void };

type Cluster = { key: string; lat: number; lon: number; place: string; visitors: GlobePoint[]; orders: GlobeOrder[] };

const RAD = Math.PI / 180;
let landCache: Float32Array | null = null;
let landLoading: Promise<Float32Array> | null = null;
function loadLand() {
  if (landCache) return Promise.resolve(landCache);
  landLoading ??= fetch("/globe-land.json", { cache: "force-cache" }).then((r) => r.json()).then((a: number[]) => {
    // unit vectors (x, y, z) for each dot
    const out = new Float32Array((a.length / 2) * 3);
    for (let i = 0, j = 0; i < a.length; i += 2, j += 3) {
      const lat = (a[i] / 10) * RAD, lon = (a[i + 1] / 10) * RAD;
      out[j] = Math.cos(lat) * Math.sin(lon); out[j + 1] = Math.sin(lat); out[j + 2] = Math.cos(lat) * Math.cos(lon);
    }
    landCache = out;
    return out;
  });
  return landLoading;
}

const inr = (p: number) => `₹${Math.round(p / 100).toLocaleString("en-IN")}`;

/** Groups markers that sit on the same spot (same city) so they show as one marker with a count. */
function clusterOf(points: GlobePoint[], orders: GlobeOrder[]): Cluster[] {
  const m = new Map<string, Cluster>();
  const key = (lat: number, lon: number) => `${Math.round(lat * 2) / 2},${Math.round(lon * 2) / 2}`;
  for (const p of points) {
    const k = key(p.lat, p.lon);
    const c = m.get(k) ?? { key: k, lat: p.lat, lon: p.lon, place: p.place, visitors: [], orders: [] };
    c.visitors.push(p); m.set(k, c);
  }
  for (const o of orders) {
    const k = key(o.lat, o.lon);
    const c = m.get(k) ?? { key: k, lat: o.lat, lon: o.lon, place: o.place, visitors: [], orders: [] };
    c.orders.push(o); m.set(k, c);
  }
  return [...m.values()];
}

export const LiveGlobe = forwardRef<GlobeHandle, { points: GlobePoint[]; orders: GlobeOrder[]; height?: number; start?: { lat: number; lon: number }; showStore?: boolean }>(
function LiveGlobe({ points, orders, height = 440, start = { lat: 21, lon: 79 }, showStore = false }, ref) {
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const view = useRef({ lon: start.lon, lat: Math.max(-60, Math.min(60, start.lat)) * 0.6, zoom: 1, vx: 0, vy: 0, dragging: false, idleSince: 0, target: null as null | { lon: number; lat: number; zoom: number } });
  const data = useRef<{ clusters: Cluster[] }>({ clusters: [] });
  const screen = useRef<{ c: Cluster; x: number; y: number; r: number }[]>([]);
  const [picked, setPicked] = useState<{ c: Cluster; x: number; y: number } | null>(null);
  const [ready, setReady] = useState(false);
  const pickedKey = useRef<string | null>(null);

  data.current.clusters = clusterOf(points, orders);
  pickedKey.current = picked?.c.key ?? null;

  useImperativeHandle(ref, () => ({
    focus: (lat, lon) => { view.current.target = { lat: Math.max(-70, Math.min(70, lat)), lon, zoom: Math.max(view.current.zoom, 1.6) }; view.current.idleSince = performance.now(); },
  }), []);

  // Keep the popup in sync with fresh data (same place, new counts)
  useEffect(() => {
    if (!picked) return;
    const c = data.current.clusters.find((x) => x.key === picked.c.key);
    if (!c) setPicked(null); else if (c !== picked.c) setPicked((p) => (p ? { ...p, c } : p));
  }, [points, orders]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const cv = canvas.current!, box = wrap.current!;
    const ctx = cv.getContext("2d");
    if (!ctx) return;
    let land: Float32Array | null = null;
    let raf = 0, visible = true, alive = true;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    void loadLand().then((l) => { if (alive) { land = l; setReady(true); } });

    let W = 0, H = 0, dpr = 1;
    const resize = () => {
      dpr = Math.min(2, window.devicePixelRatio || 1);
      W = box.clientWidth; H = box.clientHeight;
      cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
      cv.style.width = `${W}px`; cv.style.height = `${H}px`;
    };
    resize();
    const ro = new ResizeObserver(resize); ro.observe(box);
    const io = new IntersectionObserver(([e]) => { visible = e.isIntersecting; }, { threshold: 0 }); io.observe(box);

    const dark = () => Boolean(box.closest('[data-theme="dark"]'));

    const draw = (t: number) => {
      raf = requestAnimationFrame(draw);
      if (!visible || document.visibilityState !== "visible") return;
      const v = view.current;
      // motion: target fly-to, inertia, slow spin when idle
      if (v.target) {
        const dl = ((((v.target.lon - v.lon) % 360) + 540) % 360) - 180;
        v.lon += dl * 0.08; v.lat += (v.target.lat - v.lat) * 0.08; v.zoom += (v.target.zoom - v.zoom) * 0.08;
        if (Math.abs(dl) < 0.05 && Math.abs(v.target.lat - v.lat) < 0.05) v.target = null;
      } else if (!v.dragging) {
        v.lon += v.vx; v.lat = Math.max(-75, Math.min(75, v.lat + v.vy));
        v.vx *= 0.94; v.vy *= 0.94;
        if (!reduce && !pickedKey.current && t - v.idleSince > 2500 && Math.abs(v.vx) < 0.01) v.lon += 0.045;
      }
      const R = Math.min(W, H) * 0.44 * v.zoom;
      const cx = W / 2, cy = H / 2;
      const l0 = v.lon * RAD, p0 = v.lat * RAD;
      const sl = Math.sin(l0), cl = Math.cos(l0), sp = Math.sin(p0), cp = Math.cos(p0);
      const isDark = dark();
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);

      // atmosphere glow + sphere
      const glow = ctx.createRadialGradient(cx, cy, R * 0.9, cx, cy, R * 1.18);
      glow.addColorStop(0, isDark ? "rgba(56,189,248,.22)" : "rgba(56,189,248,.20)"); glow.addColorStop(1, "rgba(56,189,248,0)");
      ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(cx, cy, R * 1.18, 0, Math.PI * 2); ctx.fill();
      const sea = ctx.createRadialGradient(cx - R * 0.35, cy - R * 0.4, R * 0.1, cx, cy, R);
      if (isDark) { sea.addColorStop(0, "#1c2b3f"); sea.addColorStop(1, "#0d1622"); }
      else { sea.addColorStop(0, "#f4fbff"); sea.addColorStop(0.7, "#dcf0fb"); sea.addColorStop(1, "#bfe3f6"); }
      ctx.fillStyle = sea; ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.fill();

      // land dots (front side only, fading near the edge)
      if (land) {
        const size = Math.max(1.3, Math.min(3, R / 115));
        const base = isDark ? [94, 234, 212] : [13, 168, 150];
        for (let a = 0; a < 4; a++) {
          // 4 alpha bands drawn in one path each (much faster than one path per dot)
          ctx.beginPath();
          const lo = a / 4, hi = (a + 1) / 4;
          for (let i = 0; i < land.length; i += 3) {
            const x0 = land[i], y0 = land[i + 1], z0 = land[i + 2];
            // rotate around Y by -lon, then around X by lat
            const x1 = x0 * cl - z0 * sl, z1 = x0 * sl + z0 * cl;
            const y2 = y0 * cp - z1 * sp, z2 = y0 * sp + z1 * cp;
            if (z2 <= 0.02) continue;
            const k = Math.min(1, z2 * 1.4);
            if (k < lo || k > hi) continue;
            const px = cx + x1 * R, py = cy - y2 * R;
            if (px < -4 || px > W + 4 || py < -4 || py > H + 4) continue;
            ctx.rect(px - size / 2, py - size / 2, size, size);
          }
          ctx.fillStyle = `rgba(${base[0]},${base[1]},${base[2]},${0.35 + hi * 0.65})`;
          ctx.fill();
        }
      }

      // markers
      const hits: { c: Cluster; x: number; y: number; r: number }[] = [];
      for (const c of data.current.clusters) {
        const la = c.lat * RAD, lo = c.lon * RAD;
        const x0 = Math.cos(la) * Math.sin(lo), y0 = Math.sin(la), z0 = Math.cos(la) * Math.cos(lo);
        const x1 = x0 * cl - z0 * sl, z1 = x0 * sl + z0 * cl;
        const y2 = y0 * cp - z1 * sp, z2 = y0 * sp + z1 * cp;
        if (z2 <= 0.05) continue;
        const px = cx + x1 * R, py = cy - y2 * R;
        const n = c.visitors.length, isOrder = c.orders.length > 0;
        const r = Math.min(9, 3.6 + Math.sqrt(n + c.orders.length) * 1.3);
        const color = isOrder && !n ? "#8b5cf6" : "#0ea5e9";
        const phase = ((t / 1000 + (c.key.length % 7) * 0.31) % 2) / 2;
        if (!reduce) {
          ctx.beginPath(); ctx.arc(px, py, r + phase * 16, 0, Math.PI * 2);
          ctx.fillStyle = isOrder ? `rgba(139,92,246,${0.35 * (1 - phase)})` : `rgba(14,165,233,${0.3 * (1 - phase)})`; ctx.fill();
        }
        if (isOrder && n) { ctx.beginPath(); ctx.arc(px, py, r + 3, 0, Math.PI * 2); ctx.fillStyle = "#8b5cf6"; ctx.fill(); }
        ctx.beginPath(); ctx.arc(px, py, r, 0, Math.PI * 2);
        ctx.fillStyle = color; ctx.fill();
        ctx.lineWidth = 2; ctx.strokeStyle = pickedKey.current === c.key ? "#0f172a" : "#ffffff"; ctx.stroke();
        if (n + c.orders.length > 1) {
          ctx.fillStyle = "#fff"; ctx.font = `600 ${r > 6 ? 10 : 9}px system-ui, sans-serif`; ctx.textAlign = "center"; ctx.textBaseline = "middle";
          ctx.fillText(String(n || c.orders.length), px, py + 0.5);
        }
        hits.push({ c, x: px, y: py, r: r + 6 });
      }
      screen.current = hits;
      // keep the popup attached to its marker while the globe turns
      if (pickedKey.current) {
        const h = hits.find((x) => x.c.key === pickedKey.current);
        const el = box.querySelector<HTMLElement>("[data-globe-pop]");
        if (el) { if (h) { el.style.transform = `translate(${h.x}px, ${h.y}px)`; el.style.opacity = "1"; } else el.style.opacity = "0"; }
      }
    };
    raf = requestAnimationFrame(draw);

    // ----- input: drag, pinch, wheel (ctrl / trackpad pinch), tap -----
    const ptrs = new Map<number, { x: number; y: number }>();
    let last = { x: 0, y: 0 }, moved = 0, pinch = 0;
    const down = (e: PointerEvent) => {
      cv.setPointerCapture(e.pointerId);
      ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
      last = { x: e.clientX, y: e.clientY }; moved = 0;
      view.current.dragging = true; view.current.target = null;
      if (ptrs.size === 2) { const [a, b] = [...ptrs.values()]; pinch = Math.hypot(a.x - b.x, a.y - b.y); }
    };
    const move = (e: PointerEvent) => {
      if (!ptrs.has(e.pointerId)) {
        // hover cursor
        const r = cv.getBoundingClientRect();
        const hit = screen.current.some((h) => Math.hypot(h.x - (e.clientX - r.left), h.y - (e.clientY - r.top)) < h.r);
        cv.style.cursor = hit ? "pointer" : "grab";
        return;
      }
      ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const v = view.current;
      if (ptrs.size === 2) {
        const [a, b] = [...ptrs.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (pinch) v.zoom = Math.max(0.8, Math.min(4, v.zoom * (d / pinch)));
        pinch = d; moved += 10; return;
      }
      const dx = e.clientX - last.x, dy = e.clientY - last.y;
      last = { x: e.clientX, y: e.clientY };
      moved += Math.abs(dx) + Math.abs(dy);
      const R = Math.min(W, H) * 0.44 * v.zoom;
      const k = 57 / R; // degrees per pixel
      v.lon -= dx * k; v.lat = Math.max(-75, Math.min(75, v.lat + dy * k));
      v.vx = -dx * k * 0.6; v.vy = dy * k * 0.6;
      cv.style.cursor = "grabbing";
    };
    const up = (e: PointerEvent) => {
      ptrs.delete(e.pointerId);
      if (ptrs.size < 2) pinch = 0;
      if (ptrs.size) return;
      view.current.dragging = false; view.current.idleSince = performance.now();
      if (moved < 6) {
        const r = cv.getBoundingClientRect();
        const x = e.clientX - r.left, y = e.clientY - r.top;
        let best: (typeof screen.current)[number] | null = null, bd = Infinity;
        for (const h of screen.current) { const d = Math.hypot(h.x - x, h.y - y); if (d < h.r && d < bd) { best = h; bd = d; } }
        setPicked(best ? { c: best.c, x: best.x, y: best.y } : null);
      }
    };
    const wheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return; // plain scrolling keeps scrolling the page
      e.preventDefault();
      view.current.zoom = Math.max(0.8, Math.min(4, view.current.zoom * Math.exp(-e.deltaY * 0.01)));
    };
    cv.addEventListener("pointerdown", down); cv.addEventListener("pointermove", move);
    cv.addEventListener("pointerup", up); cv.addEventListener("pointercancel", up);
    cv.addEventListener("wheel", wheel, { passive: false });
    return () => {
      alive = false; cancelAnimationFrame(raf); ro.disconnect(); io.disconnect();
      cv.removeEventListener("pointerdown", down); cv.removeEventListener("pointermove", move);
      cv.removeEventListener("pointerup", up); cv.removeEventListener("pointercancel", up); cv.removeEventListener("wheel", wheel);
    };
  }, []);

  const zoomBy = (f: number) => { const v = view.current; v.target = { lat: v.lat, lon: v.lon, zoom: Math.max(0.8, Math.min(4, v.zoom * f)) }; v.idleSince = performance.now(); };
  const reset = () => { view.current.target = { lat: start.lat * 0.6, lon: start.lon, zoom: 1 }; setPicked(null); };

  return (
    <div ref={wrap} className="relative w-full select-none overflow-hidden" style={{ height }}>
      <canvas ref={canvas} className="block touch-none" style={{ cursor: "grab" }} aria-label="Globe showing where visitors are right now" role="img" />
      {!ready && <div className="absolute inset-0 flex items-center justify-center text-[12px] text-ink-faint">Loading globe…</div>}

      {picked && (
        <div data-globe-pop className="pointer-events-none absolute left-0 top-0 z-10 transition-opacity" style={{ transform: `translate(${picked.x}px, ${picked.y}px)` }}>
          <div className="pointer-events-auto absolute bottom-3 left-1/2 w-64 -translate-x-1/2 rounded-xl bg-white p-3 text-[12px] shadow-[0_0_0_1px_rgba(0,0,0,.08),0_16px_40px_-12px_rgba(0,0,0,.35)]">
            <div className="flex items-start justify-between gap-2">
              <p className="text-[13px] font-semibold leading-tight">{picked.c.place || "Unknown place"}</p>
              <button type="button" onClick={() => setPicked(null)} className="-mr-1 -mt-1 rounded p-1 text-ink-faint hover:bg-black/[.05]" aria-label="Close"><Icon name="close" className="h-3 w-3" /></button>
            </div>
            <p className="mt-0.5 text-ink-soft">
              {picked.c.visitors.length > 0 && <><b className="num text-[#0284c7]">{picked.c.visitors.length}</b> visitor{picked.c.visitors.length === 1 ? "" : "s"} now</>}
              {picked.c.visitors.length > 0 && picked.c.orders.length > 0 && " · "}
              {picked.c.orders.length > 0 && <><b className="num text-[#7c3aed]">{picked.c.orders.length}</b> order{picked.c.orders.length === 1 ? "" : "s"} (30 min)</>}
            </p>
            <ul className="mt-2 max-h-40 space-y-1.5 overflow-y-auto">
              {picked.c.visitors.slice(0, 6).map((p) => (
                <li key={p.k} className="rounded-lg bg-paper px-2 py-1.5">
                  <p className="truncate font-medium">{p.name ?? p.page}</p>
                  <p className="truncate text-[11px] text-ink-faint">{[showStore ? p.store : null, p.name ? p.page : null, p.source, p.device === "desktop" ? "Desktop" : "Mobile", p.cartPaise ? `Cart ${inr(p.cartPaise)}` : null].filter(Boolean).join(" · ")}</p>
                </li>
              ))}
              {picked.c.orders.slice(0, 4).map((o) => (
                <li key={o.id} className="rounded-lg bg-[#f5f3ff] px-2 py-1.5 text-[#5b21b6]">
                  <p className="font-medium">Order {inr(o.amountPaise)}</p>
                  <p className="text-[11px] opacity-80">{[showStore ? o.store : null, new Date(o.at).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" })].filter(Boolean).join(" · ")}</p>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      <div className="absolute bottom-3 right-3 flex flex-col overflow-hidden rounded-lg bg-white/90 shadow-[0_0_0_1px_rgba(0,0,0,.08)] backdrop-blur">
        <button type="button" onClick={() => zoomBy(1.35)} className="flex h-8 w-8 items-center justify-center text-ink-soft hover:bg-black/[.04] hover:text-ink" aria-label="Zoom in"><Icon name="plus" className="h-4 w-4" /></button>
        <span className="h-px bg-rule" />
        <button type="button" onClick={() => zoomBy(1 / 1.35)} className="flex h-8 w-8 items-center justify-center text-ink-soft hover:bg-black/[.04] hover:text-ink" aria-label="Zoom out"><Icon name="minus" className="h-4 w-4" /></button>
        <span className="h-px bg-rule" />
        <button type="button" onClick={reset} className="flex h-8 w-8 items-center justify-center text-ink-soft hover:bg-black/[.04] hover:text-ink" aria-label="Back to India" title="Back to India"><Icon name="home" className="h-3.5 w-3.5" /></button>
      </div>
      <div className="pointer-events-none absolute bottom-3 left-3 flex items-center gap-3 rounded-lg bg-white/85 px-2.5 py-1.5 text-[11px] text-ink-soft shadow-[0_0_0_1px_rgba(0,0,0,.06)] backdrop-blur">
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-[#0ea5e9] ring-2 ring-white" />Visitors now</span>
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-[#8b5cf6] ring-2 ring-white" />Orders (30 min)</span>
      </div>
    </div>
  );
});
