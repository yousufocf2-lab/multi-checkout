// Growpefy's own Google Ads tag (for promoting Growpefy). Loaded only on the public website, signup and onboarding.
// Not secret: the tag ID and label are visible in any page's source.
import { useEffect } from "react";

export const ADS_TAG_ID = "AW-18535106225";
const LEAD_LABEL = "yKdYCNK1nagdELGNnYZF"; // "Submit lead form" conversion

declare global {
  interface Window { dataLayer?: unknown[]; gtag?: (...args: unknown[]) => void }
}

function load() {
  if (typeof window === "undefined") return;
  if (!window.gtag) {
    window.dataLayer = window.dataLayer || [];
    // eslint-disable-next-line prefer-rest-params
    window.gtag = function () { window.dataLayer!.push(arguments); };
    window.gtag("js", new Date());
    const s = document.createElement("script");
    s.async = true;
    s.src = `https://www.googletagmanager.com/gtag/js?id=${ADS_TAG_ID}`;
    document.head.appendChild(s);
  }
  const w = window as unknown as { __gpAdsTag?: boolean };
  if (!w.__gpAdsTag) { window.gtag!("config", ADS_TAG_ID); w.__gpAdsTag = true; }
}

/** Loads the tag (also keeps the ad click ID so a later signup counts for the ad). */
export function useAdsTag() {
  useEffect(() => { load(); }, []);
}

/** Counts one lead (signup or callback). `key` makes sure the same lead is counted once per browser. */
export function fireLead(key: string) {
  load();
  try { if (localStorage.getItem(`gp_lead_${key}`)) return; localStorage.setItem(`gp_lead_${key}`, "1"); } catch { /* still send */ }
  window.gtag!("event", "conversion", { send_to: `${ADS_TAG_ID}/${LEAD_LABEL}`, value: 1.0, currency: "INR" });
}
