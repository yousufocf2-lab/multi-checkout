// Browser-only: tells Growpefy's server that a customer's checkout / thank-you page crashed (message + where),
// so it shows in the logs and in Checkout diagnostics. Never throws.
export function reportCrash(error: unknown) {
  try {
    const m = /\/c\/([\w-]{6,64})|\/order\/([\w-]{4,64})/.exec(location.pathname);
    if (!m) return;
    const e = error as Error;
    const body = JSON.stringify({ s: m[1] ?? "", o: m[2] ?? null, e: "js_error", d: { boundary: true, m: String(e?.message ?? error).slice(0, 300), stack: String(e?.stack ?? "").slice(0, 900), path: location.pathname, ua: navigator.userAgent.slice(0, 200), online: navigator.onLine, vis: document.visibilityState } });
    const base = import.meta.env.BASE_URL.startsWith("http") ? import.meta.env.BASE_URL : location.origin + "/";
    const url = new URL("api/cx-event", base).toString();
    if (!navigator.sendBeacon?.(url, body)) void fetch(url, { method: "POST", body, keepalive: true, mode: "no-cors" });
  } catch { /* reporting only */ }
}

/** A request that never got an answer (network dropped, app sent to the background, connection reset). */
export const isNetworkError = (error: unknown) =>
  !(error instanceof Response) && /load failed|failed to fetch|networkerror|network connection|network request failed|the internet connection|cancelled|aborted|timed out/i.test(String((error as Error)?.message ?? error));
