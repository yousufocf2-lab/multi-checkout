// Face ID / fingerprint (passkey) buttons for the login page, the dashboard prompt and Login & security.
import { browserSupportsWebAuthn, platformAuthenticatorIsAvailable, startAuthentication, startRegistration } from "@simplewebauthn/browser";
import { useEffect, useState } from "react";
import { Spinner } from "~/components/ui";

async function post<T>(url: string, body: unknown): Promise<T> {
  const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), credentials: "same-origin" });
  const j = (await r.json().catch(() => ({}))) as T & { error?: string };
  if (!r.ok || j.error) throw new Error(j.error || "Something went wrong. Please try again.");
  return j;
}

/** "iPhone · Safari", "Android · Chrome", "Windows · Edge"… so people can tell their devices apart. */
export function deviceName() {
  const u = navigator.userAgent;
  const os = /iPhone/.test(u) ? "iPhone" : /iPad/.test(u) ? "iPad" : /Android/.test(u) ? "Android" : /Mac OS X/.test(u) ? "Mac" : /Windows/.test(u) ? "Windows" : "Device";
  const br = /Edg\//.test(u) ? "Edge" : /CriOS|Chrome\//.test(u) ? "Chrome" : /FxiOS|Firefox\//.test(u) ? "Firefox" : /Safari\//.test(u) ? "Safari" : "Browser";
  return `${os} · ${br}`;
}

const cancelled = (e: unknown) => /NotAllowedError|AbortError|cancel/i.test(String((e as Error)?.name) + String((e as Error)?.message));

export function useCanUsePasskeys() {
  const [ok, setOk] = useState<{ web: boolean; platform: boolean }>({ web: false, platform: false });
  useEffect(() => {
    if (!browserSupportsWebAuthn()) return;
    platformAuthenticatorIsAvailable().then((platform) => setOk({ web: true, platform })).catch(() => setOk({ web: true, platform: false }));
  }, []);
  return ok;
}

export const fingerprintLabel = () => (/iPhone|iPad|Mac OS X/.test(navigator.userAgent) ? "Face ID / Touch ID" : /Windows/.test(navigator.userAgent) ? "Windows Hello" : "fingerprint / face lock");

/** Login page: one tap with Face ID / fingerprint. */
export function PasskeyLogin({ next }: { next: string }) {
  const can = useCanUsePasskeys();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!can.web) return null;
  const go = async () => {
    setBusy(true); setError(null);
    try {
      const optionsJSON = await post<Parameters<typeof startAuthentication>[0]["optionsJSON"]>("/api/passkey/login", { step: "options" });
      const response = await startAuthentication({ optionsJSON });
      const r = await post<{ to: string }>("/api/passkey/login", { step: "verify", response, next });
      window.location.href = r.to;
    } catch (e) {
      setBusy(false);
      if (!cancelled(e)) setError(e instanceof Error ? e.message : "Couldn't log in with this device.");
    }
  };
  return (
    <div className="space-y-2">
      <button type="button" onClick={go} disabled={busy} className="btn-secondary w-full py-3">
        {busy ? <Spinner /> : <FingerprintIcon />}Log in with {can.platform ? fingerprintLabel() : "a passkey"}
      </button>
      {error && <p className="text-center text-xs text-bad" role="alert">{error}</p>}
    </div>
  );
}

/** Turns on Face ID / fingerprint login for this device. */
export function useAddPasskey(onDone?: () => void) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const add = async () => {
    setBusy(true); setError(null);
    try {
      const optionsJSON = await post<Parameters<typeof startRegistration>[0]["optionsJSON"]>("/api/passkey/register", { step: "options" });
      const response = await startRegistration({ optionsJSON });
      await post("/api/passkey/register", { step: "verify", response, device: deviceName() });
      setBusy(false);
      onDone?.();
    } catch (e) {
      setBusy(false);
      const name = String((e as Error)?.name ?? "");
      if (name === "InvalidStateError") setError("Face ID / fingerprint login is already on for this device.");
      else if (!cancelled(e)) setError(e instanceof Error ? e.message : "Couldn't set this up.");
    }
  };
  return { add, busy, error };
}

export async function removePasskeyRequest(id: number) {
  await post("/api/passkey/register", { step: "remove", id });
}

const DISMISS = "gp_passkey_prompt_v1";
/** Dashboard: a small card inviting people to turn on Face ID / fingerprint login on this device. */
export function PasskeyPrompt({ has }: { has: boolean }) {
  const can = useCanUsePasskeys();
  const [hidden, setHidden] = useState(true);
  const [done, setDone] = useState(false);
  useEffect(() => { try { setHidden(Boolean(localStorage.getItem(DISMISS))); } catch { setHidden(false); } }, []);
  const { add, busy, error } = useAddPasskey(() => { setDone(true); try { localStorage.setItem(DISMISS, "done"); } catch { /* ignore */ } });
  if (has || hidden || !can.platform) return null;
  const close = () => { setHidden(true); try { localStorage.setItem(DISMISS, String(Date.now())); } catch { /* ignore */ } };
  return (
    <div className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm">
      <span className="text-pine"><FingerprintIcon /></span>
      <p className="min-w-0 flex-1 text-ink">{done ? <b>Done. Next time, log in with {fingerprintLabel()}.</b> : <>Log in faster next time with <b>{fingerprintLabel()}</b>, no OTP or password.</>}{error && <span className="block text-xs text-bad">{error}</span>}</p>
      {!done && <button type="button" onClick={add} disabled={busy} className="btn-primary h-9 px-4 text-sm">{busy ? <Spinner /> : "Turn on"}</button>}
      <button type="button" onClick={close} className="text-xs font-medium text-ink-soft hover:text-ink">{done ? "Close" : "Not now"}</button>
    </div>
  );
}

export function FingerprintIcon({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" className={className} aria-hidden>
      <path d="M12 11v3a8 8 0 0 1-1.5 4.7" /><path d="M8.5 12a3.5 3.5 0 0 1 7 0v1.5a12 12 0 0 1-.9 4.6" /><path d="M5.3 15.8A10 10 0 0 1 5 13v-1a7 7 0 0 1 12.6-4.2" />
      <path d="M19 11.6V13a15.7 15.7 0 0 1-.6 4.3" /><path d="M3.6 9A9.9 9.9 0 0 1 12 2a9.9 9.9 0 0 1 6.3 2.3" />
    </svg>
  );
}
