import { useEffect } from "react";

declare global {
  interface Window { dataLayer?: unknown[]; gtag?: (...args: unknown[]) => void }
}

/** Fires a Google Ads purchase conversion once per order per browser. transaction_id lets Google drop duplicates. */
export function GoogleTag({ tagId, label, value, orderId }: { tagId: string; label: string; value: number; orderId: string }) {
  useEffect(() => {
    const key = `cx_gt_${orderId}`;
    try { if (sessionStorage.getItem(key)) return; } catch { /* ignore */ }
    if (!window.gtag) {
      window.dataLayer = window.dataLayer || [];
      // eslint-disable-next-line prefer-rest-params
      window.gtag = function () { window.dataLayer!.push(arguments); };
      const s = document.createElement("script");
      s.async = true;
      s.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(tagId)}`;
      document.head.appendChild(s);
      window.gtag("js", new Date());
    }
    window.gtag("config", tagId);
    window.gtag("event", "conversion", { send_to: `${tagId}/${label}`, value, currency: "INR", transaction_id: orderId });
    try { sessionStorage.setItem(key, "1"); } catch { /* ignore */ }
  }, [tagId, label, value, orderId]);
  return null;
}
