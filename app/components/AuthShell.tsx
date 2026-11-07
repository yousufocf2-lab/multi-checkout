import { Link } from "@remix-run/react";
import { useEffect } from "react";
import { BrandIcon, BrandLockup } from "./Brand";
import { markTabLoggedIn } from "./TabSession";

const POINTS = [
  { t: "Smart checkout", d: "COD, prepaid offers and OTP in one fast checkout." },
  { t: "Your own website", d: "Design pages, products and offers without code." },
  { t: "Orders to doorstep", d: "Shipping, RTO protection and tracking in one place." },
];

export function AuthShell({ title, subtitle, children, footer }: { title: string; subtitle: string; children: React.ReactNode; footer?: React.ReactNode }) {
  // The tab that logs in counts as an open admin tab (see TabSession)
  useEffect(() => { markTabLoggedIn(); }, []);
  return (
    <main className="grid min-h-screen bg-[#f6f6f4] lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)]">
      <aside className="relative hidden overflow-hidden bg-[#06261f] text-white lg:flex lg:flex-col lg:justify-between lg:p-12 xl:p-14">
        <div aria-hidden className="pointer-events-none absolute -left-40 -top-40 h-[520px] w-[520px] rounded-full bg-[radial-gradient(circle,rgba(47,201,140,.35),transparent_65%)]" />
        <div aria-hidden className="pointer-events-none absolute -bottom-48 -right-32 h-[560px] w-[560px] rounded-full bg-[radial-gradient(circle,rgba(11,93,75,.9),transparent_65%)]" />
        <div aria-hidden className="pointer-events-none absolute inset-0 opacity-[.07] [background-image:linear-gradient(rgba(255,255,255,.6)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,.6)_1px,transparent_1px)] [background-size:44px_44px]" />
        <Link to="/" aria-label="Growpefy home" className="relative w-fit"><BrandLockup tone="light" className="h-9" /></Link>
        <div className="relative max-w-[480px]">
          <p className="text-[12px] font-semibold uppercase tracking-[.18em] text-[#7fe0b4]">For India's D2C brands</p>
          <h2 className="mt-3 text-[40px] font-semibold leading-[1.1] tracking-tight xl:text-[46px]">Grow your brand.<br /><span className="text-[#7fe0b4]">We run the rest.</span></h2>
          <ul className="mt-9 space-y-5">
            {POINTS.map((p) => (
              <li key={p.t} className="flex gap-3.5">
                <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white/10 ring-1 ring-white/15">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#7fe0b4" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M5 12.5 10 17 19 7" /></svg>
                </span>
                <span><span className="block text-[15px] font-semibold">{p.t}</span><span className="block text-[14px] text-white/65">{p.d}</span></span>
              </li>
            ))}
          </ul>
        </div>
        <p className="relative text-[12.5px] text-white/50">© {new Date().getFullYear()} Growpefy · Made in India</p>
      </aside>

      <section className="flex min-h-screen flex-col px-5 py-8 sm:px-8">
        <div className="flex items-center justify-between lg:justify-end">
          <Link to="/" aria-label="Growpefy home" className="lg:hidden"><BrandLockup className="h-8" /></Link>
          <Link to="/" className="text-[13px] text-ink-soft transition hover:text-ink">← Back to website</Link>
        </div>
        <div className="flex flex-1 items-center justify-center py-8">
          <div className="w-full max-w-[400px]">
            <div className="rounded-[20px] bg-white p-7 shadow-[0_1px_2px_rgba(0,0,0,.06),0_12px_40px_-16px_rgba(0,0,0,.18)] ring-1 ring-black/[.06] sm:p-8">
              <h1 className="text-[24px] font-semibold tracking-tight">{title}</h1>
              <p className="mt-1 text-[14px] text-ink-soft">{subtitle}</p>
              <div className="mt-6">{children}</div>
            </div>
            {footer && <div className="mt-5 text-center text-[13px] leading-6 text-ink-soft">{footer}</div>}
          </div>
        </div>
      </section>
    </main>
  );
}

/** Small brand mark (kept for existing imports). */
export function Mark({ className = "h-7 w-7", tile = false }: { className?: string; tile?: boolean }) {
  return <BrandIcon className={className} tile={tile} />;
}
