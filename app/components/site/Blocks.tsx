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
        <p className="relative mx-auto mt-3 max-w-xl text-emerald-50/80">Create your account, connect your store and go live today.</p>
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


const LOGOS: [string, string][] = [
  ["razorpay", "Razorpay"], ["cashfree", "Cashfree Payments"], ["payu", "PayU"], ["phonepe", "PhonePe"], ["paytm", "Paytm PG"],
  ["stripe", "Stripe"], ["paypal", "PayPal"], ["braintree", "Braintree"], ["square", "Square"],
];
export const INDIA_GATEWAYS = ["Razorpay", "Cashfree", "PayU", "PhonePe", "Paytm", "CCAvenue", "Easebuzz", "Instamojo", "BillDesk", "Zaakpay", "Juspay", "Worldline", "MobiKwik", "PayGlocal"];
export const GLOBAL_GATEWAYS = ["Stripe", "PayPal", "Braintree", "Square", "Adyen", "Checkout.com", "Worldpay", "Airwallex", "2Checkout", "Authorize.Net", "Mollie", "Paddle", "FastSpring", "PayPro Global", "Nuvei", "Fonepay"];

/** "Bring your own gateway" section with partner logos. */
export function Gateways({ compact = false }: { compact?: boolean }) {
  return (
    <section className={compact ? "" : "border-y border-rule bg-white"}>
      <div className={`mx-auto max-w-6xl px-4 sm:px-6 ${compact ? "" : "py-16"}`}>
        {!compact && <SectionHead eyebrow="Your gateway, your money" title="Bring the payment gateway you already use" text="Customers pay through your own gateway account, so money settles straight to your bank. Switch or add gateways any time." />}
        <div className={`${compact ? "" : "mt-10"} group relative overflow-hidden [mask-image:linear-gradient(90deg,transparent,#000_8%,#000_92%,transparent)]`}>
          {/* Two copies side by side; sliding by half loops seamlessly. Pauses on hover, static for reduced motion. */}
          <div className="flex w-max animate-marquee gap-4 py-1 group-hover:[animation-play-state:paused] motion-reduce:animate-none motion-reduce:flex-wrap motion-reduce:justify-center">
            {[0, 1].map((copy) => LOGOS.map(([f, name]) => (
              <div key={`${copy}-${f}`} aria-hidden={copy === 1 || undefined}
                className={`flex h-16 w-40 shrink-0 items-center justify-center rounded-xl border border-rule bg-white px-4 transition hover:border-rule-strong hover:shadow-sm ${copy === 1 ? "motion-reduce:hidden" : ""}`}>
                <img src={`/brand/gateways/${f}.webp`} alt={copy === 1 ? "" : name} loading="lazy" className="max-h-7 w-auto max-w-full object-contain" />
              </div>
            )))}
          </div>
        </div>
        {!compact && (
          <div className="mt-8 grid gap-4 md:grid-cols-2">
            <GatewayList title="India" items={INDIA_GATEWAYS} />
            <GatewayList title="International" items={GLOBAL_GATEWAYS} />
          </div>
        )}
        <p className="mt-5 text-center text-xs text-ink-faint">PayU is live today. Razorpay and Cashfree are next, with more gateways rolling out. Need one urgently? <Link to="/contact" className="font-medium text-pine underline underline-offset-2">Tell us</Link>.</p>
      </div>
    </section>
  );
}

function GatewayList({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="rounded-2xl border border-rule bg-paper/50 p-5">
      <p className="text-xs font-semibold uppercase tracking-wider text-ink-faint">{title}</p>
      <ul className="mt-3 flex flex-wrap gap-1.5">
        {items.map((g) => <li key={g} className="rounded-full border border-rule bg-white px-2.5 py-1 text-xs font-medium text-ink-soft">{g}</li>)}
      </ul>
    </div>
  );
}

const PLATFORMS: { name: string; text: string; status: "live" | "soon" }[] = [
  { name: "Shopify", text: "Add one script to your theme. Checkout and Buy Now open Growpefy and orders sync back.", status: "live" },
  { name: "WooCommerce / WordPress", text: "A plugin that sends the cart to Growpefy and writes orders back into WooCommerce.", status: "soon" },
  { name: "Custom websites", text: "Built your own site in VS Code, React or PHP? Send the cart with one API call or a script tag.", status: "soon" },
];

/** Which store platforms Growpefy works with. */
export function Platforms() {
  return (
    <div className="grid gap-4 md:grid-cols-3">
      {PLATFORMS.map((p) => (
        <div key={p.name} className="rounded-2xl border border-rule bg-white p-6">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-[17px] font-semibold">{p.name}</h3>
            <span className={`shrink-0 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold ${p.status === "live" ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-800"}`}>{p.status === "live" ? "Live" : "Coming soon"}</span>
          </div>
          <p className="mt-2 text-sm leading-relaxed text-ink-soft">{p.text}</p>
        </div>
      ))}
    </div>
  );
}
