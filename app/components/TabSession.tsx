// Ends the admin login when the dashboard is opened again after every admin tab was closed.
// Each tab keeps a mark in sessionStorage (it survives reloads, not closing the tab). A tab without the
// mark asks the other open admin tabs whether they're there; if none answers, the login is ended.
import { useEffect } from "react";

const MARK = "gp:tab";
const CHANNEL = "gp-admin-tabs";

/** Called on the login / signup pages: the tab that logs in is a live admin tab. */
export function markTabLoggedIn() {
  try { sessionStorage.setItem(MARK, "1"); } catch { /* storage off */ }
}

export function TabSession() {
  useEffect(() => {
    if (typeof BroadcastChannel === "undefined") return;
    let ch: BroadcastChannel;
    try { ch = new BroadcastChannel(CHANNEL); } catch { return; }
    ch.onmessage = (e) => { if (e.data === "anyone?") ch.postMessage("here"); };
    let has = false;
    try { has = sessionStorage.getItem(MARK) === "1"; } catch { has = true; }
    if (has) return () => ch.close();
    let answered = false;
    const listen = (e: MessageEvent) => { if (e.data === "here") answered = true; };
    ch.addEventListener("message", listen);
    ch.postMessage("anyone?");
    const t = window.setTimeout(() => {
      ch.removeEventListener("message", listen);
      if (answered) { markTabLoggedIn(); return; }
      fetch("/logout", { method: "POST", body: new URLSearchParams({ reason: "closed" }), credentials: "same-origin" })
        .finally(() => { window.location.replace(`/login?closed=1&next=${encodeURIComponent(location.pathname + location.search)}`); });
    }, 600);
    return () => { window.clearTimeout(t); ch.close(); };
  }, []);
  return null;
}
