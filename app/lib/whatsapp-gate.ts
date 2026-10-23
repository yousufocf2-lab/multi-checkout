// WhatsApp verification + abandoned cart recovery rules, shared by server and browser.
import type { RecoverySettings, WaVerify, WaVerifyStatus } from "~/db/schema";

export const VERIFY_LABEL: Record<WaVerifyStatus | "none", string> = {
  none: "Not verified",
  submitted: "Waiting for review",
  requested: "More details needed",
  approved: "Verified",
  rejected: "Not approved",
};

export const verifyStatus = (v: WaVerify | null | undefined): WaVerifyStatus | "none" => v?.status ?? "none";

export const VERIFY_DOC_MAX = 5 * 1024 * 1024;
export const VERIFY_DOC_LIMIT = 8;
export const VERIFY_DOC_TYPES = ["application/pdf", "image/jpeg", "image/png", "image/webp"];

/** Video links we accept: any https link (Google Drive, YouTube, Dropbox, OneDrive…). */
export function cleanVideoUrl(v: string) {
  const t = v.trim();
  try {
    const u = new URL(t);
    return u.protocol === "https:" && u.hostname.includes(".") ? u.toString().slice(0, 500) : null;
  } catch {
    return null;
  }
}

// Abandoned cart: 1 or 2 messages, minutes after the customer leaves checkout
export const RECOVERY_MIN = 15;
export const RECOVERY_FIRST_MAX = 24 * 60;
export const RECOVERY_SECOND_MAX = 72 * 60;
export const RECOVERY_GAP = 60;
export const RECOVERY_DEFAULT = [30];

export function resolveRecovery(r: RecoverySettings | null | undefined) {
  const delays = (r?.delays ?? []).filter((n) => Number.isFinite(n) && n > 0).map((n) => Math.round(n)).slice(0, 2);
  return { on: Boolean(r?.on), delays: delays.length ? delays : RECOVERY_DEFAULT };
}

/** Checks the delays a store picked. Returns an error message or null. */
export function recoveryError(delays: number[]) {
  if (!delays.length || delays.length > 2) return "Choose 1 or 2 messages";
  const [a, b] = delays;
  if (!(a >= RECOVERY_MIN && a <= RECOVERY_FIRST_MAX)) return "Send the first message between 15 minutes and 24 hours after the customer leaves";
  if (b != null) {
    if (b > RECOVERY_SECOND_MAX) return "Send the second message within 3 days";
    if (b < a + RECOVERY_GAP) return "Keep at least 1 hour between the two messages";
  }
  return null;
}

export const fmtDelay = (min: number) => (min % 1440 === 0 ? `${min / 1440} day${min === 1440 ? "" : "s"}` : min % 60 === 0 ? `${min / 60} hour${min === 60 ? "" : "s"}` : `${min} minutes`);
