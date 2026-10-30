import { useEffect } from "react";

declare global {
  interface Window {
    fbq?: ((...args: unknown[]) => void) & { callMethod?: unknown; queue?: unknown[]; loaded?: boolean; version?: string; push?: unknown };
    _fbq?: unknown;
  }
}

/** Customer details for Meta's advanced matching (plain text; the pixel hashes them before sending). */
export type PixelUser = { ph?: string; em?: string; fn?: string; ln?: string; ct?: string; st?: string; zp?: string; country?: string; external_id?: string };

function loadPixel(pixelId: string, user?: PixelUser) {
  if (typeof window === "undefined") return;
  if (!window.fbq) {
    /* eslint-disable */
    (function (f: any, b: Document, e: string, v: string) {
      if (f.fbq) return;
      const n: any = (f.fbq = function (...args: unknown[]) {
        n.callMethod ? n.callMethod.apply(n, args) : n.queue.push(args);
      });
      if (!f._fbq) f._fbq = n;
      n.push = n; n.loaded = true; n.version = "2.0"; n.queue = [];
      const t = b.createElement(e) as HTMLScriptElement;
      t.async = true; t.src = v;
      const s = b.getElementsByTagName(e)[0];
      s.parentNode!.insertBefore(t, s);
    })(window, document, "script", "https://connect.facebook.net/en_US/fbevents.js");
    /* eslint-enable */
  }
  const w = window as unknown as { __cxPixels?: Set<string> };
  w.__cxPixels ??= new Set();
  if (!w.__cxPixels.has(pixelId)) {
    const am = user ? Object.fromEntries(Object.entries(user).filter(([, v]) => typeof v === "string" && v.trim()).map(([k, v]) => [k, v!.trim().toLowerCase()])) : {};
    if (Object.keys(am).length) window.fbq!("init", pixelId, am);
    else window.fbq!("init", pixelId);
    window.fbq!("track", "PageView");
    w.__cxPixels.add(pixelId);
  }
}

/** Fires one Meta Pixel event (once per onceKey per browser). */
export function MetaPixel({ pixelId, event, data, eventId, onceKey, user }: {
  pixelId: string; event: string; data?: Record<string, unknown>; eventId?: string; onceKey?: string; user?: PixelUser;
}) {
  useEffect(() => {
    loadPixel(pixelId, user);
    const key = onceKey ? `cx_px_${onceKey}` : null;
    try { if (key && sessionStorage.getItem(key)) return; } catch { /* ignore */ }
    window.fbq!("trackSingle", pixelId, event, data ?? {}, eventId ? { eventID: eventId } : undefined);
    try { if (key) sessionStorage.setItem(key, "1"); } catch { /* ignore */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pixelId, event, eventId, onceKey]);
  return null;
}
