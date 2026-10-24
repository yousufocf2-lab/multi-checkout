import { Link } from "@remix-run/react";
import { useEffect, useRef, useState } from "react";
import { CourierLogo } from "~/components/CourierLogo";
import { Icon, type IconName } from "~/components/Icons";
import { COURIERS } from "~/lib/courier-catalog";
import { rupees, WALLET_GST } from "~/lib/wallet";
import { rv } from "./SiteLayout";

export function SectionHead({ eyebrow, title, text, align = "center", dark = false }: { eyebrow: string; title: string; text?: string; align?: "center" | "left"; dark?: boolean }) {
  return (
    <div className={align === "center" ? "mx-auto max-w-2xl text-center" : "max-w-2xl"} {...rv()}>
      <p className={`text-xs font-semibold uppercase tracking-[.14em] ${dark ? "text-emerald-300" : "text-pine"}`}>{eyebrow}</p>
      <h2 className={`mt-3 text-3xl font-semibold tracking-tight sm:text-[40px] sm:leading-[1.1] ${dark ? "text-white" : ""}`}>{title}</h2>
      {text && <p className={`mt-4 text-[17px] leading-relaxed ${dark ? "text-slate-300" : "text-ink-soft"}`}>{text}</p>}
    </div>
  );
}

/** Rounded icon tile used on cards. */
export function IconTile({ icon, tone = "blue", className = "" }: { icon: IconName; tone?: "blue" | "mint" | "amber" | "rose" | "violet" | "navy"; className?: string }) {
  const t = {
    blue: "bg-pine-tint text-pine ring-emerald-100", mint: "bg-emerald-50 text-emerald-700 ring-emerald-100", amber: "bg-amber-50 text-amber-700 ring-amber-100",
    rose: "bg-rose-50 text-rose-700 ring-rose-100", violet: "bg-teal-50 text-teal-700 ring-teal-100", navy: "bg-white/10 text-emerald-300 ring-white/10",
  }[tone];
  return <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ring-1 transition-transform duration-300 group-hover:scale-110 ${t} ${className}`}><Icon name={icon} className="h-5 w-5" /></span>;
}

export function CtaBand({ loggedIn, title = "Ready to improve your checkout workflow?", text = "Explore Growpefy and see how the tools fit your store. Set up takes an afternoon, and our team helps you go live." }: { loggedIn: boolean; title?: string; text?: string }) {
  return (
    <section className="px-4 pb-20 sm:px-6">
      <div className="relative mx-auto max-w-6xl overflow-hidden rounded-3xl bg-[#0B1A16] px-6 py-14 text-center text-white sm:px-12 sm:py-16" {...rv()}>
        <div aria-hidden className="pointer-events-none absolute -left-24 -top-24 h-72 w-72 rounded-full bg-pine-tint0/25 blur-3xl" />
        <div aria-hidden className="pointer-events-none absolute -bottom-24 -right-16 h-72 w-72 rounded-full bg-emerald-400/20 blur-3xl" />
        <div aria-hidden className="pointer-events-none absolute inset-0 opacity-[.18] [background-image:linear-gradient(rgba(255,255,255,.08)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,.08)_1px,transparent_1px)] [background-size:40px_40px] [mask-image:radial-gradient(60%_70%_at_50%_50%,#000,transparent)]" />
        <h2 className="relative text-3xl font-semibold tracking-tight sm:text-[40px] sm:leading-tight">{title}</h2>
        <p className="relative mx-auto mt-3 max-w-xl text-slate-300">{text}</p>
        <div className="relative mt-8 flex flex-wrap justify-center gap-3">
          <Link to={loggedIn ? "/dashboard" : "/signup"} className="btn-primary px-6 py-3.5 text-[15px]">{loggedIn ? "Go to dashboard" : "Get started"}<Icon name="arrow" className="nudge h-4 w-4" /></Link>
          <Link to="/contact" className="btn border border-white/25 px-6 py-3.5 text-[15px] text-white hover:-translate-y-px hover:border-white/50 hover:bg-white/10"><Icon name="phone" className="h-4 w-4" />Request a callback</Link>
        </div>
      </div>
    </section>
  );
}

export type Rates = { saleFeeBps: number; otp: number; waConfirm: number; waTracking: number; waPromo: number; waRecovery?: number };

export function RateCard({ rates }: { rates: Rates }) {
  const rows: [IconName, string, string, string][] = [
    ["orders", "Order fee", `${rates.saleFeeBps / 100}%`, "of each order placed through the checkout (prepaid or COD)"],
    ["lock", "OTP verification", rupees(rates.otp), "per OTP sent"],
    ["chat", "WhatsApp order confirmation", rupees(rates.waConfirm), "per message"],
    ["shipping", "WhatsApp shipping updates", rupees(rates.waTracking), "per message"],
    ["sparkle", "WhatsApp promotional", rupees(rates.waPromo), "per message"],
  ];
  return (
    <div className="overflow-hidden rounded-2xl border border-rule bg-white shadow-lift">
      {rows.map(([icon, l, v, n], i) => (
        <div key={l} className={`group flex items-center gap-4 px-5 py-4 transition-colors hover:bg-paper/70 ${i ? "border-t border-rule" : ""}`}>
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-paper text-ink-soft transition-colors group-hover:bg-pine-tint group-hover:text-pine-dark"><Icon name={icon} className="h-4 w-4" /></span>
          <div className="min-w-0 flex-1"><p className="font-medium">{l}</p><p className="text-xs text-ink-faint">{n}</p></div>
          <p className="num shrink-0 text-lg font-semibold">{v}</p>
        </div>
      ))}
      <p className="border-t border-rule bg-paper/70 px-5 py-3 text-xs text-ink-faint">All prices exclude 18% GST. No setup fee, no monthly plan.</p>
    </div>
  );
}

/** Counts a number up when it first changes or scrolls into view. Shows the final value without JS. */
function useCount(target: number, ms = 650) {
  const [v, setV] = useState(target);
  const from = useRef(target);
  useEffect(() => {
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) { setV(target); from.current = target; return; }
    const start = performance.now(), a = from.current;
    let raf = 0;
    const tick = (t: number) => {
      const k = Math.min(1, (t - start) / ms), e = 1 - Math.pow(1 - k, 3);
      setV(Math.round(a + (target - a) * e));
      if (k < 1) raf = requestAnimationFrame(tick); else from.current = target;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, ms]);
  return v;
}

/** Wallet recharge breakdown: recharge → GST → total payable → wallet credit. Uses the real minimum and GST rate. */
export function WalletDemo({ minRecharge }: { minRecharge: number }) {
  const base = Math.max(minRecharge, 100000);
  const amounts = Array.from(new Set([minRecharge, 500000, 1000000, 2500000].filter((a) => a >= minRecharge))).slice(0, 4);
  const [amt, setAmt] = useState(amounts[1] ?? base);
  const gst = Math.round(amt * WALLET_GST);
  const total = amt + gst;
  const cAmt = useCount(amt), cGst = useCount(gst), cTotal = useCount(total), cCredit = useCount(amt, 900);
  return (
    <div className="rounded-2xl border border-rule bg-white p-5 shadow-lift sm:p-6">
      <div className="flex items-center justify-between gap-3">
        <p className="flex items-center gap-2 font-semibold"><Icon name="wallet" className="h-5 w-5 text-pine" />Top up your wallet</p>
        <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">GST invoice included</span>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4" role="radiogroup" aria-label="Recharge amount">
        {amounts.map((a) => (
          <button key={a} type="button" role="radio" aria-checked={a === amt} onClick={() => setAmt(a)}
            className={`num rounded-xl border px-3 py-2.5 text-sm font-semibold transition duration-200 hover:-translate-y-0.5 ${a === amt ? "border-pine bg-pine-tint text-pine-dark shadow-[0_6px_16px_-10px_rgba(11,93,75,.8)]" : "border-rule-strong text-ink-soft hover:border-ink/40"}`}>
            {rupees(a, 0)}
          </button>
        ))}
      </div>
      <dl className="mt-5 space-y-2.5 text-sm">
        <Row label="Recharge amount" value={rupees(cAmt)} />
        <Row label={`GST (${Math.round(WALLET_GST * 100)}%)`} value={`+ ${rupees(cGst)}`} muted />
        <div className="border-t border-dashed border-rule-strong" />
        <Row label="Total payable" value={rupees(cTotal)} strong />
      </dl>
      <div className="mt-4 flex items-center justify-between gap-3 rounded-xl bg-gradient-to-r from-pine to-[#0E7A62] px-4 py-3.5 text-white">
        <span className="flex items-center gap-2 text-sm font-medium"><Icon name="check" className="h-4 w-4" strokeWidth={2.4} />Added to your wallet</span>
        <span className="num text-xl font-semibold">{rupees(cCredit)}</span>
      </div>
      <p className="mt-3 text-xs leading-relaxed text-ink-faint">The full recharge amount becomes wallet credit; GST is billed on top and shown on your tax invoice. Minimum recharge {rupees(minRecharge, 0)}. See the <Link to="/refund-policy" className="underline underline-offset-2 hover:text-ink">refund policy</Link>.</p>
    </div>
  );
}

function Row({ label, value, muted, strong }: { label: string; value: string; muted?: boolean; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className={muted ? "text-ink-faint" : "text-ink-soft"}>{label}</dt>
      <dd className={`num ${strong ? "text-lg font-semibold text-ink" : muted ? "text-ink-soft" : "font-medium"}`}>{value}</dd>
    </div>
  );
}

/** Accordion FAQ with smooth open/close and keyboard support. */
export function Faq({ items }: { items: [string, string][] }) {
  const [open, setOpen] = useState<number | null>(0);
  return (
    <div className="divide-y divide-rule overflow-hidden rounded-2xl border border-rule bg-white">
      {items.map(([q, a], i) => {
        const on = open === i;
        return (
          <div key={q} {...rv(i)}>
            <h3>
              <button type="button" onClick={() => setOpen(on ? null : i)} aria-expanded={on} aria-controls={`faq-${i}`}
                className="group flex w-full items-center justify-between gap-4 px-5 py-5 text-left font-medium transition-colors hover:bg-paper/60 sm:px-6">
                {q}
                <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full border transition duration-200 ${on ? "rotate-45 border-pine bg-pine text-white" : "border-rule-strong text-ink-faint group-hover:border-ink/40 group-hover:text-ink"}`}><Icon name="plus" className="h-3.5 w-3.5" /></span>
              </button>
            </h3>
            <div id={`faq-${i}`} className={`acc ${on ? "open" : ""}`} role="region">
              <div><p className="px-5 pb-5 text-[15px] leading-relaxed text-ink-soft sm:px-6">{a}</p></div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ---------- integrations ----------

export const GATEWAY_TILES: { id: string; name: string; logo?: string }[] = [
  { id: "razorpay", name: "Razorpay", logo: "/brand/gateways/razorpay.webp" },
  { id: "cashfree", name: "Cashfree Payments", logo: "/brand/gateways/cashfree.webp" },
  { id: "payu", name: "PayU", logo: "/brand/gateways/payu.webp" },
  { id: "phonepe", name: "PhonePe", logo: "/brand/gateways/phonepe.webp" },
  { id: "paytm", name: "Paytm", logo: "/brand/gateways/paytm.webp" },
  { id: "easebuzz", name: "Easebuzz" },
  { id: "ccavenue", name: "CCAvenue" },
];

export function GatewayTile({ g, className = "" }: { g: (typeof GATEWAY_TILES)[number]; className?: string }) {
  return (
    <div className={`flex h-14 items-center justify-center rounded-xl border border-rule bg-white px-4 transition duration-200 hover:-translate-y-0.5 hover:border-rule-strong hover:shadow-lift ${className}`} title={g.name}>
      {g.logo ? <img src={g.logo} alt={g.name} loading="lazy" className="max-h-6 w-auto max-w-full object-contain" />
        : <span className="text-[15px] font-bold tracking-tight text-ink">{g.name}</span>}
    </div>
  );
}

/** Primary → Backup 1 → Backup 2: what happens when a gateway can't take the payment. */
export function GatewayFallback() {
  const steps: { label: string; name: string; note: string; state: "down" | "ok" | "idle" }[] = [
    { label: "Primary", name: "Gateway A", note: "Couldn't start the payment", state: "down" },
    { label: "Backup 1", name: "Gateway B", note: "Customer pays here", state: "ok" },
    { label: "Backup 2", name: "Gateway C", note: "Ready if B fails too", state: "idle" },
  ];
  return (
    <div className="relative rounded-2xl border border-white/10 bg-white/[.04] p-5 sm:p-6" aria-label="Gateway fallback example">
      <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">Example</p>
      <ol className="mt-4 space-y-3">
        {steps.map((s, i) => (
          <li key={s.label} className="relative" {...rv(i + 1)}>
            {i < steps.length - 1 && (
              <svg aria-hidden className="absolute left-[22px] top-[46px] h-6 w-2" viewBox="0 0 2 24"><line x1="1" y1="0" x2="1" y2="24" stroke={s.state === "down" ? "#2DD496" : "rgba(255,255,255,.25)"} strokeWidth="2" className={s.state === "down" ? "flow" : ""} /></svg>
            )}
            <div className={`flex items-center gap-3 rounded-xl border px-3.5 py-3 ${s.state === "ok" ? "border-emerald-400/50 bg-emerald-400/10" : s.state === "down" ? "border-white/10 bg-white/[.03]" : "border-dashed border-white/15"}`}>
              <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${s.state === "ok" ? "pulse bg-emerald-400 text-[#0B1A16]" : s.state === "down" ? "bg-rose-400/15 text-rose-300" : "bg-white/10 text-slate-400"}`}>
                <Icon name={s.state === "ok" ? "check" : s.state === "down" ? "close" : "clock"} className="h-4 w-4" strokeWidth={2.2} />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-white">{s.name} <span className="ml-1 rounded bg-white/10 px-1.5 py-px text-[10px] font-medium text-slate-300">{s.label}</span></p>
                <p className="text-xs text-slate-400">{s.note}</p>
              </div>
            </div>
          </li>
        ))}
      </ol>
      <p className="mt-4 text-xs leading-relaxed text-slate-400">Same order, same amount. If a payment fails, the customer's "Try again" opens the next gateway.</p>
    </div>
  );
}

export const API_COURIERS = COURIERS.filter((c) => c.kind === "api");
export const SHOPIFY_COURIERS = COURIERS.filter((c) => c.kind === "shopify" && c.id !== "other");

export function CourierRow() {
  return (
    <div className="flex flex-wrap gap-2">
      {API_COURIERS.map((c) => (
        <span key={c.id} className="flex items-center gap-2 rounded-full border border-rule bg-white py-1 pl-1 pr-3 text-sm font-medium shadow-sm transition hover:-translate-y-0.5 hover:shadow-lift">
          <CourierLogo c={c} size={28} />{c.name}
        </span>
      ))}
      <span className="flex items-center rounded-full bg-paper px-3 text-sm text-ink-soft">+ {SHOPIFY_COURIERS.length} more tracked from Shopify</span>
    </div>
  );
}

export function StatusPill({ live }: { live: boolean }) {
  return (
    <span className={`inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold ${live ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-800"}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${live ? "bg-emerald-500" : "bg-amber-500"}`} />{live ? "Live" : "Coming soon"}
    </span>
  );
}
