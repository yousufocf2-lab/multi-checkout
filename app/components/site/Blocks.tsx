import { Link } from "@remix-run/react";
import { rupees } from "~/lib/wallet";

export function SectionHead({ eyebrow, title, text }: { eyebrow: string; title: string; text?: string }) {
  return (
    <div className="mx-auto max-w-2xl text-center">
      <p className="text-sm font-semibold text-pine">{eyebrow}</p>
      <h2 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">{title}</h2>
      {text && <p className="mt-4 text-ink-soft">{text}</p>}
    </div>
  );
}

export function CtaBand({ loggedIn }: { loggedIn: boolean }) {
  return (
    <section className="px-4 pb-20 sm:px-6">
      <div className="relative mx-auto max-w-6xl overflow-hidden rounded-3xl bg-gradient-to-br from-pine via-[#0A4F40] to-night px-6 py-14 text-center text-white sm:px-12">
        <div aria-hidden className="pointer-events-none absolute -right-20 -top-20 h-72 w-72 rounded-full bg-emerald-400/20 blur-3xl" />
        <h2 className="relative text-3xl font-semibold tracking-tight sm:text-4xl">Ready to grow with a better checkout?</h2>
        <p className="relative mx-auto mt-3 max-w-xl text-emerald-50/80">Create your account, connect your Shopify store and go live today.</p>
        <div className="relative mt-8 flex flex-wrap justify-center gap-3">
          <Link to={loggedIn ? "/dashboard" : "/signup"} className="btn bg-white px-6 py-3.5 text-[15px] text-pine hover:bg-emerald-50">{loggedIn ? "Go to dashboard" : "Sign up free"}</Link>
          <Link to="/contact" className="btn border border-white/30 px-6 py-3.5 text-[15px] text-white hover:bg-white/10">Talk to us</Link>
        </div>
      </div>
    </section>
  );
}

export function RateCard({ rates }: { rates: { saleFeeBps: number; otp: number; waConfirm: number; waTracking: number; waPromo: number } }) {
  const rows: [string, string, string][] = [
    ["Order fee", `${rates.saleFeeBps / 100}%`, "of each order placed (prepaid or COD)"],
    ["OTP verification", rupees(rates.otp), "per OTP sent"],
    ["WhatsApp order confirmation", rupees(rates.waConfirm), "per message"],
    ["WhatsApp shipping updates", rupees(rates.waTracking), "per message"],
    ["WhatsApp promotional", rupees(rates.waPromo), "per message"],
  ];
  return (
    <div className="overflow-hidden rounded-2xl border border-rule bg-white shadow-lift">
      {rows.map(([l, v, n], i) => (
        <div key={l} className={`flex items-center justify-between gap-4 px-6 py-4 ${i ? "border-t border-rule" : ""}`}>
          <div><p className="font-medium">{l}</p><p className="text-xs text-ink-faint">{n}</p></div>
          <p className="num shrink-0 text-lg font-semibold text-pine">{v}</p>
        </div>
      ))}
      <p className="border-t border-rule bg-paper/60 px-6 py-3 text-xs text-ink-faint">All prices exclude 18% GST. No setup fee, no monthly fee.</p>
    </div>
  );
}

