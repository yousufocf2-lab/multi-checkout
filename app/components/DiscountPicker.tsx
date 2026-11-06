// "Create discount": pick the kind first (like Shopify), then its own form opens.
import { Link } from "@remix-run/react";
import { useEffect, useState } from "react";
import { Icon, type IconName } from "~/components/Icons";

const TYPES: { to: string; icon: IconName; title: string; text: string }[] = [
  { to: "discounts", icon: "discounts", title: "Amount off products", text: "% or ₹ off chosen products, with its own value for online and COD." },
  { to: "coupons", icon: "coupons", title: "Discount code", text: "A code customers type at checkout, like WELCOME10." },
  { to: "gifts", icon: "gift", title: "Free gift & bundles", text: "Buy X get Y free, Buy 2 get 1, Mix & Match." },
  { to: "offers", icon: "offers", title: "Bank & card offer", text: "“10% off on Kotak cards”, applied by your payment gateway." },
  { to: "payments", icon: "rupee", title: "Online payment discount", text: "Extra off for paying online, or a fee on COD, for the whole store." },
];

export function DiscountPicker({ storeId, label = "Create discount", primary = true }: { storeId: number; label?: string; primary?: boolean }) {
  const [open, setOpen] = useState(false);
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
          <div className="w-full max-w-[520px] animate-fadein overflow-hidden rounded-xl bg-white shadow-[0_0_0_1px_rgba(0,0,0,.08),0_24px_48px_-12px_rgba(0,0,0,.35)]">
            <header className="flex items-center justify-between border-b border-rule px-4 py-3">
              <h2 id="dp-title" className="text-[14px] font-semibold">Select discount type</h2>
              <button type="button" onClick={() => setOpen(false)} className="flex h-7 w-7 items-center justify-center rounded-lg text-ink-soft hover:bg-black/5" aria-label="Close"><Icon name="close" className="h-4 w-4" /></button>
            </header>
            <ul className="divide-y divide-rule">
              {TYPES.map((t) => (
                <li key={t.to}>
                  <Link to={`/dashboard/stores/${storeId}/${t.to}`} className="flex items-center gap-3 px-4 py-3 hover:bg-paper">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-paper-sunk"><Icon name={t.icon} className="h-4 w-4" /></span>
                    <span className="min-w-0 flex-1"><span className="block text-[13px] font-semibold">{t.title}</span><span className="block text-[12.5px] text-ink-soft">{t.text}</span></span>
                    <Icon name="chevron" className="h-4 w-4 -rotate-90 text-ink-faint" />
                  </Link>
                </li>
              ))}
            </ul>
            <footer className="flex justify-end border-t border-rule px-4 py-3"><button type="button" className="btn-secondary" onClick={() => setOpen(false)}>Cancel</button></footer>
          </div>
        </div>
      )}
    </>
  );
}
