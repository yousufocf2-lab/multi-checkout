// "Create discount": pick the kind first (like Shopify), then its own form opens.
import { Link } from "@remix-run/react";
import { useEffect, useState } from "react";
import { Icon, type IconName } from "~/components/Icons";
import { storePath } from "~/lib/store-code";
import { useBodyScrollLock } from "./useBodyScrollLock";

const TYPES: { to: string; icon: IconName; title: string; text: string }[] = [
  { to: "coupons", icon: "coupons", title: "Coupon code", text: "Customer types a code at checkout" },
  { to: "discounts", icon: "zap", title: "Automatic offer", text: "Applies on its own, no code" },
  { to: "offers", icon: "offers", title: "Bank & card offer", text: "Extra off for a bank or card" },
  { to: "payments", icon: "rupee", title: "Prepaid discount", text: "Reward customers who pay online" },
  { to: "gifts", icon: "gift", title: "Free gift", text: "Add a gift with chosen products" },
  { to: "gifts", icon: "cart", title: "Buy X Get Y", text: "Buy some, get something free" },
  { to: "gifts#mix", icon: "layers", title: "Bundle & quantity", text: "More off when they buy more" },
  { to: "shipping", icon: "shipping", title: "Free shipping", text: "No delivery charge above a value" },
];

export function DiscountPicker({ storeId, label = "Create discount", primary = true }: { storeId: number; label?: string; primary?: boolean }) {
  const [open, setOpen] = useState(false);
  useBodyScrollLock(open);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);
  return (
    <>
      <button type="button" className={primary ? "btn-primary" : "btn-secondary"} onClick={() => setOpen(true)}>{label}</button>
      {open && (
        <div className="fixed inset-0 z-[80] flex items-start justify-center bg-black/30 px-4 pt-[12vh]" role="dialog" aria-modal="true" aria-labelledby="dp-title" onMouseDown={(e) => { if (e.target === e.currentTarget) setOpen(false); }}>
          <div className="max-h-[88dvh] w-full max-w-[680px] animate-fadein overflow-y-auto overscroll-contain rounded-xl bg-white shadow-[0_0_0_1px_rgba(0,0,0,.08),0_24px_48px_-12px_rgba(0,0,0,.35)]">
            <header className="flex items-center justify-between border-b border-rule px-4 py-3">
              <h2 id="dp-title" className="text-[14px] font-semibold">Create discount</h2>
              <button type="button" onClick={() => setOpen(false)} className="flex h-7 w-7 items-center justify-center rounded-lg text-ink-soft hover:bg-black/5" aria-label="Close"><Icon name="close" className="h-4 w-4" /></button>
            </header>
            <div className="grid gap-2.5 p-4 sm:grid-cols-3">
              {TYPES.map((t) => (
                <Link key={t.title} to={`${storePath(storeId)}/${t.to}`} onClick={() => setOpen(false)}
                  className="group flex flex-col items-start gap-2 rounded-xl p-3.5 shadow-[inset_0_0_0_1px_rgb(var(--rule))] transition hover:bg-paper hover:shadow-[inset_0_0_0_1px_rgb(var(--rule-strong))]">
                  <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#e3f1ec] text-[#0b5d4b]"><Icon name={t.icon} className="h-4 w-4" /></span>
                  <span><span className="block text-[13px] font-semibold">{t.title}</span><span className="block text-[12px] text-ink-soft">{t.text}</span></span>
                </Link>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
