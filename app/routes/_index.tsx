import type { LoaderFunctionArgs, MetaFunction } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { Link, useLoaderData } from "@remix-run/react";
import { eq } from "drizzle-orm";
import { useEffect, useRef, useState } from "react";
import { CourierLogo } from "~/components/CourierLogo";
import { Icon, type IconName } from "~/components/Icons";
import {
  API_COURIERS, BrandLogo, CourierRow, CtaBand, Faq, GATEWAY_TILES, GatewayFallback, GatewayTile, IconTile, RateCard, SectionHead, StatusPill, WalletDemo,
} from "~/components/site/Blocks";
import { SiteLayout, faqLd, productLd, rv, siteMeta, verifyMeta } from "~/components/site/SiteLayout";
import { db, stores } from "~/db.server";
import { env } from "~/lib/env.server";
import { siteData } from "~/lib/site.server";
import { checkoutRoot, isAppHost, requestHost, slugFromHost } from "~/lib/urls.server";

export const meta: MetaFunction<typeof loader> = ({ data }) => [
  ...siteMeta("Growpefy · Shopify & WooCommerce checkout with COD & RTO control",
    "One-page checkout for Shopify and WooCommerce stores in India: COD verification and RTO control, up to 3 payment gateways with automatic backup, prepaid offers, WhatsApp cart recovery and Meta + Google Ads analytics. No monthly fee.",
    "/", { ld: [productLd, faqLd(FAQ)] }),
  ...verifyMeta(data?.verify),
];

/** Platform domain → website. A store's checkout domain → that store's storefront. */
export async function loader({ request }: LoaderFunctionArgs) {
  if (!isAppHost(request)) {
    const host = requestHost(request);
    const slug = slugFromHost(host);
    const [store] = await db.select({ url: stores.storefrontUrl }).from(stores).where(slug ? eq(stores.slug, slug) : eq(stores.checkoutDomain, host)).limit(1);
    if (store) throw redirect(store.url);
    if (slug || host === checkoutRoot()) throw redirect(env.appUrl);
  }
  return json(await siteData(request));
}

const FAQ: [string, string][] = [
  ["How long does setup take?", "Most stores go live in an afternoon: connect the store, add your payment gateway keys and set your COD and offer rules. On Shopify you add one script to your theme; on WooCommerce you install our plugin. Our team can help you through it on a call."],
  ["Which platforms are supported?", "Shopify and WooCommerce are both live. On Shopify, Checkout and Buy Now open Growpefy; on WooCommerce, our plugin sends the Checkout page to Growpefy. Every order is created back in your store with items, discounts and stock. Custom-built websites are coming soon."],
  ["Can I see my Meta and Google ads in Growpefy?", "Yes. Connect Meta Ads and Google Ads to see spend, cost per order and ROAS next to your real checkout orders, and which platform is working better. Purchases are sent back to Meta (Conversions API) and Google Ads so both can optimise."],
  ["Which payment gateways can I connect?", "PayU, Razorpay, Cashfree Payments, PhonePe, Paytm, Easebuzz and CCAvenue, using your own merchant account so money settles straight to your bank. You can connect up to three and choose the order: if the primary can't take a payment, the next one is used."],
  ["What does Growpefy charge?", "There's no monthly plan or setup fee. You recharge a prepaid wallet and a small fee is deducted per order placed through the checkout. OTPs and WhatsApp messages are charged only when sent. The full rate card is on the pricing page."],
  ["How do wallet credits and GST work?", "You pay the recharge amount plus 18% GST, and the full recharge amount is added to your wallet. Every recharge comes with a GST tax invoice you can download from the dashboard."],
  ["What happens if my wallet runs low?", "Your checkout keeps taking orders. The wallet can go slightly below zero; past that limit, promotional messages pause and some dashboard tools lock until you recharge. You get low-balance alerts before that."],
  ["Can I cancel?", "Yes, any time. There's no contract: remove the script from your theme and your store goes back to its old checkout. See the refund policy for unused wallet balance."],
  ["How does Growpefy help with COD risk?", "With rules you control: OTP before COD, a wait time between COD orders, block lists by number, pincode, city or state, WhatsApp order confirmation, and, when you connect your courier, each customer's delivery history to hide COD for repeat refusers."],
];

export default function Home() {
  const d = useLoaderData<typeof loader>();
  return (
    <SiteLayout loggedIn={d.loggedIn} company={d.company}>
      <Hero loggedIn={d.loggedIn} />
      <ProofStrip />
      <Problem />
      <Pillars />
      <Tour />
      <UseCases />
      <Integrations />
      <AdsBand />

      {/* Wallet & pricing */}
      <section className="border-y border-rule bg-paper/70">
        <div className="mx-auto grid max-w-6xl items-start gap-10 px-4 py-20 sm:px-6 sm:py-24 lg:grid-cols-[1fr_1.05fr]">
          <div>
            <SectionHead align="left" eyebrow="Wallet & pricing" title="Know exactly what you pay, before you pay." text="No monthly plan. Recharge a prepaid wallet and see the recharge amount, GST and total upfront. Fees come out only when orders are placed or messages are sent." />
            <div className="mt-8" {...rv(1)}><RateCard rates={d.rates} /></div>
            <Link to="/pricing" className="group mt-6 inline-flex items-center gap-1.5 font-semibold text-pine hover:text-pine-dark" {...rv(2)}>See plans and usage charges<Icon name="arrow" className="nudge h-4 w-4" /></Link>
          </div>
          <div className="lg:sticky lg:top-24" {...rv(1)}><WalletDemo minRecharge={d.minRecharge} /></div>
        </div>
      </section>

      <Security />

      <section>
        <div className="mx-auto max-w-3xl px-4 py-20 sm:px-6 sm:py-24">
          <SectionHead eyebrow="FAQs" title="Questions merchants ask us" />
          <div className="mt-10"><Faq items={FAQ} /></div>
          <p className="mt-6 text-center text-sm text-ink-soft" {...rv()}>Still have a question? <Link to="/contact" className="font-semibold text-pine underline-offset-2 hover:underline">Ask for a callback</Link>.</p>
        </div>
      </section>

      <CtaBand loggedIn={d.loggedIn} />
    </SiteLayout>
  );
}

// ---------------- 01 Hero ----------------

function Hero({ loggedIn }: { loggedIn: boolean }) {
  return (
    <section className="relative overflow-hidden">
      <div aria-hidden className="pointer-events-none absolute inset-0 bg-[radial-gradient(55%_50%_at_85%_10%,rgba(11,93,75,.12),transparent_70%),radial-gradient(40%_40%_at_70%_80%,rgba(45,212,150,.12),transparent_70%)]" />
      <div aria-hidden className="pointer-events-none absolute inset-0 opacity-50 [background-image:linear-gradient(rgba(11,22,48,.045)_1px,transparent_1px),linear-gradient(90deg,rgba(11,22,48,.045)_1px,transparent_1px)] [background-size:48px_48px] [mask-image:radial-gradient(70%_60%_at_60%_30%,#000,transparent)]" />
      <div className="relative mx-auto grid max-w-6xl items-center gap-14 px-4 pb-16 pt-12 sm:px-6 sm:pt-20 lg:grid-cols-[1.02fr_1fr] lg:pb-24">
        <div>
          <p className="inline-flex items-center gap-2 rounded-full border border-emerald-100 bg-pine-tint/80 px-3 py-1 text-[11px] font-semibold uppercase tracking-[.12em] text-pine-dark">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />Checkout + COD risk, in one workspace
          </p>
          <h1 className="mt-5 text-[40px] font-semibold leading-[1.04] tracking-tight sm:text-[58px]">
            Make every checkout decision <span className="relative whitespace-nowrap text-pine">work harder.<svg aria-hidden viewBox="0 0 300 12" className="absolute -bottom-1.5 left-0 h-2.5 w-full text-emerald-400" preserveAspectRatio="none"><path d="M2 9C60 3 140 2 298 7" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" /></svg></span>
          </h1>
          <p className="mt-6 max-w-xl text-lg leading-relaxed text-ink-soft">
            Build a checkout that fits your store, offer smarter payment choices, and control COD risk, all from one platform.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link to={loggedIn ? "/dashboard" : "/signup"} className="btn-primary px-6 py-3.5 text-[15px]">{loggedIn ? "Go to dashboard" : "Get started"}<Icon name="arrow" className="nudge h-4 w-4" /></Link>
            <a href="#how" className="btn-secondary px-6 py-3.5 text-[15px]">See how it works</a>
          </div>
          <div className="mt-8 border-t border-rule pt-5">
            <p className="text-xs font-medium text-ink-faint">Built for growing ecommerce brands</p>
            <ul className="mt-2.5 flex flex-wrap gap-x-5 gap-y-2 text-sm text-ink-soft">
              {[["rupee", `${GATEWAY_TILES.length} payment gateways`], ["shipping", `${API_COURIERS.length} courier APIs`], ["ads", "Meta + Google Ads analytics"]].map(([i, t]) => (
                <li key={t} className="flex items-center gap-1.5"><Icon name={i as IconName} className="h-4 w-4 text-pine" />{t}</li>
              ))}
            </ul>
            <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-3">
              <span className="text-xs font-medium text-ink-faint">Live on</span>
              <BrandLogo id="shopify" h={26} />
              <BrandLogo id="woocommerce" h={20} />
            </div>
          </div>
        </div>
        <HeroVisual />
      </div>
    </section>
  );
}

/** Checkout preview in the middle with three connected panels: payments & offers, a COD rule, recovery & analytics. */
function HeroVisual() {
  return (
    <div className="relative mx-auto w-full max-w-[460px] pb-6 lg:max-w-none" aria-hidden>
      <div className="absolute inset-x-6 bottom-0 top-10 rounded-[40px] bg-gradient-to-tr from-emerald-200/50 via-transparent to-emerald-200/40 blur-2xl" />
      {/* connector lines */}
      <svg className="absolute inset-0 hidden h-full w-full sm:block" viewBox="0 0 460 520" preserveAspectRatio="none">
        <path d="M120 120 C 70 140, 60 170, 40 190" className="flow" fill="none" stroke="#0B5D4B" strokeOpacity=".35" strokeWidth="1.5" />
        <path d="M340 300 C 390 300, 410 320, 425 340" className="flow" fill="none" stroke="#2DD496" strokeOpacity=".6" strokeWidth="1.5" />
        <path d="M150 430 C 110 450, 90 460, 60 470" className="flow" fill="none" stroke="#0B5D4B" strokeOpacity=".35" strokeWidth="1.5" />
      </svg>

      {/* checkout */}
      <div className="seq relative mx-auto w-[300px] rounded-[30px] border border-rule bg-white p-2.5 shadow-[0_40px_80px_-30px_rgba(11,22,48,.45)]" style={{ "--d": "80ms" } as React.CSSProperties}>
        <div className="rounded-[22px] bg-paper p-3.5">
          <div className="flex items-center justify-between">
            <span className="text-[13px] font-bold tracking-tight">YOUR BRAND</span>
            <span className="flex items-center gap-1 text-[10px] font-medium text-ink-faint"><Icon name="lock" className="h-3 w-3" />Secure checkout</span>
          </div>
          <div className="mt-3 flex items-center gap-2.5 rounded-xl border border-rule bg-white p-2.5">
            <span className="h-10 w-10 rounded-lg bg-gradient-to-br from-sky-100 to-emerald-200" />
            <span className="flex-1"><span className="block text-xs font-semibold">Wireless earbuds</span><span className="block text-[10px] text-ink-faint">Qty 1</span></span>
            <span className="num text-xs font-semibold">₹1,499</span>
          </div>
          <div className="mt-2.5 flex items-center gap-2 rounded-xl border border-dashed border-emerald-300 bg-emerald-50 px-2.5 py-2 text-[11px] font-semibold text-emerald-800">
            <Icon name="coupons" className="h-3.5 w-3.5" />SAVE10 applied · ₹150 off
          </div>
          <p className="mt-3 text-[10px] font-semibold uppercase tracking-wider text-ink-faint">Payment</p>
          <div className="mt-1.5 space-y-1.5">
            <div className="flex items-center justify-between rounded-xl border-2 border-pine bg-white px-2.5 py-2 text-[11px]">
              <span className="flex items-center gap-2 font-semibold"><span className="h-3.5 w-3.5 rounded-full border-4 border-pine" />Pay online · UPI, cards</span>
              <span className="rounded-full bg-emerald-50 px-1.5 py-0.5 text-[9px] font-bold text-emerald-700">₹50 OFF</span>
            </div>
            <div className="flex items-center justify-between rounded-xl border border-rule bg-white px-2.5 py-2 text-[11px] text-ink-soft">
              <span className="flex items-center gap-2"><span className="h-3.5 w-3.5 rounded-full border border-rule-strong" />Pay ₹99 now, rest on delivery</span>
            </div>
            <div className="flex items-center justify-between rounded-xl border border-rule bg-white px-2.5 py-2 text-[11px] text-ink-soft">
              <span className="flex items-center gap-2"><span className="h-3.5 w-3.5 rounded-full border border-rule-strong" />Cash on Delivery</span>
            </div>
          </div>
          <div className="mt-3 rounded-xl bg-pine py-2.5 text-center text-[13px] font-semibold text-white">Pay ₹1,299</div>
        </div>
      </div>

      {/* panel 1: payments & offers */}
      <div className="seq absolute -left-2 top-16 hidden w-[188px] rounded-2xl border border-rule bg-white/95 p-3 shadow-lift backdrop-blur sm:block lg:-left-12" style={{ "--d": "380ms" } as React.CSSProperties}>
        <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-pine"><Icon name="rupee" className="h-3 w-3" />Payments & offers</p>
        <ul className="mt-2 space-y-1.5 text-[11px]">
          {[["Primary", "Gateway A", true], ["Backup 1", "Gateway B", true], ["Prepaid discount", "₹50 off", true]].map(([l, v, on]) => (
            <li key={l as string} className="flex items-center justify-between gap-2"><span className="text-ink-soft">{l}</span><span className="flex items-center gap-1 font-semibold">{v}{on && <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />}</span></li>
          ))}
        </ul>
      </div>

      {/* panel 2: COD rule */}
      <div className="seq absolute -right-1 top-[44%] hidden w-[200px] rounded-2xl border border-emerald-200 bg-white/95 p-3 shadow-lift backdrop-blur sm:block lg:-right-14" style={{ "--d": "620ms" } as React.CSSProperties}>
        <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-emerald-700"><Icon name="shield" className="h-3 w-3" />COD risk rule</p>
        <p className="mt-1.5 text-[11px] leading-snug"><span className="font-semibold">2+ past RTOs</span> → hide COD</p>
        <div className="mt-2 flex items-center gap-2 rounded-lg bg-emerald-50 px-2 py-1.5 text-[10px] font-medium text-emerald-800"><Icon name="check" className="h-3 w-3" strokeWidth={2.4} />OTP verified before COD</div>
      </div>

      {/* panel 3: recovery & analytics */}
      <div className="seq absolute -left-1 bottom-0 hidden w-[210px] rounded-2xl border border-rule bg-white/95 p-3 shadow-lift backdrop-blur sm:block lg:-left-10" style={{ "--d": "860ms" } as React.CSSProperties}>
        <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-teal-700"><Icon name="trend" className="h-3 w-3" />Recovery & analytics</p>
        <div className="mt-2 flex items-end gap-1" >
          {[38, 52, 44, 66, 58, 74, 82].map((h, i) => <span key={i} className="w-full rounded-sm bg-gradient-to-t from-pine to-emerald-400" style={{ height: `${h * 0.42}px`, opacity: 0.45 + i * 0.08 }} />)}
        </div>
        <p className="mt-2 flex items-center gap-1.5 text-[10px] text-ink-soft"><Icon name="chat" className="h-3 w-3 text-emerald-600" />Abandoned cart reminder sent</p>
      </div>
      <p className="mt-3 text-center text-[11px] text-ink-faint sm:hidden">Sample checkout for illustration</p>
    </div>
  );
}

// ---------------- 02 Proof strip ----------------

function ProofStrip() {
  return (
    <section className="border-y border-rule bg-paper/60">
      <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
        <p className="text-center text-xs font-semibold uppercase tracking-[.14em] text-ink-faint" {...rv()}>Works with the tools you already use</p>
        <div className="mt-5 flex flex-wrap items-center justify-center gap-x-8 gap-y-4" {...rv(1)}>
          <span className="logo-mute"><BrandLogo id="shopify" h={28} /></span>
          <span className="logo-mute"><BrandLogo id="woocommerce" h={22} /></span>
          <span className="logo-mute"><BrandLogo id="meta" h={22} /></span>
          <span className="logo-mute"><BrandLogo id="google" h={26} /></span>
          {GATEWAY_TILES.filter((g) => g.logo).map((g) => <img key={g.id} src={g.logo} alt={g.name} loading="lazy" className="logo-mute h-6 w-auto" />)}
          {API_COURIERS.slice(0, 3).map((c) => <span key={c.id} className="logo-mute flex items-center gap-2 text-sm font-semibold"><CourierLogo c={c} size={26} />{c.name}</span>)}
          <span className="logo-mute flex items-center gap-2 text-sm font-semibold text-[#128C7E]"><Icon name="chat" className="h-5 w-5" />WhatsApp</span>
        </div>
      </div>
    </section>
  );
}

// ---------------- 03 Problem ----------------

function Problem() {
  const items: [IconName, string, string][] = [
    ["cart", "Checkout friction", "Long forms and slow pages lose customers who were ready to buy, especially on mobile."],
    ["alert", "COD uncertainty", "Fake orders and refused parcels eat margin, but turning COD off loses real buyers too."],
    ["layers", "Disconnected tools", "Offers in one app, OTP in another, courier data in a spreadsheet. Nothing talks to each other."],
    ["eye", "Weak visibility", "Hard to see which payment option, offer or ad actually brought a profitable order."],
  ];
  return (
    <section>
      <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6 sm:py-24">
        <SectionHead eyebrow="The problem" title="Where ecommerce orders quietly leak" text="Most stores lose money between 'Buy now' and 'Delivered', and the fixes are spread across too many tools." />
        <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {items.map(([icon, t, x], i) => (
            <div key={t} className="spot group rounded-2xl border border-rule bg-white p-6" {...rv(i)}>
              <IconTile icon={icon} tone={i === 1 ? "rose" : "blue"} />
              <h3 className="mt-5 text-[17px] font-semibold">{t}</h3>
              <p className="mt-2 text-sm leading-relaxed text-ink-soft">{x}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ---------------- 04 Three pillars ----------------

function Pillars() {
  const pillars: { icon: IconName; tone: "blue" | "mint" | "violet"; name: string; title: string; text: string; points: string[]; visual: React.ReactNode }[] = [
    {
      icon: "design", tone: "blue", name: "Checkout Builder", title: "A checkout that looks like your brand",
      text: "One fast page from Buy Now or the cart, with your logo, colors and fonts.",
      points: ["Mobile-first, phone number first", "Saved addresses behind OTP", "Coupons, bank offers and free gifts", "Prepaid, COD and partial COD"],
      visual: <MiniCheckout />,
    },
    {
      icon: "shield", tone: "mint", name: "COD Protection", title: "Keep COD for real buyers",
      text: "Rules you set decide who sees COD, using order history and courier data.",
      points: ["OTP before COD orders", "Block lists by phone, pincode, city or state", "Courier delivery history (RTO Shield)", "WhatsApp order confirmation"],
      visual: <MiniRule />,
    },
    {
      icon: "trend", tone: "violet", name: "Analytics & Recovery", title: "See what's working, win back carts",
      text: "Orders, abandoned checkouts and ad spend in one dashboard for every store.",
      points: ["Abandoned checkout recovery on WhatsApp", "Meta ads ROAS and cost per order", "Courier performance: delivered vs RTO", "Compare stores side by side"],
      visual: <MiniChart />,
    },
  ];
  return (
    <section id="platform" className="scroll-mt-20 border-t border-rule bg-gradient-to-b from-paper/70 to-white">
      <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6 sm:py-24">
        <SectionHead eyebrow="The platform" title="More control from checkout to delivery" text="Configure checkout experiences, payment incentives, COD verification and order-risk rules without juggling disconnected tools." />
        <div className="mt-12 grid gap-5 lg:grid-cols-3">
          {pillars.map((p, i) => (
            <article key={p.name} className="spot group flex flex-col overflow-hidden rounded-2xl border border-rule bg-white" {...rv(i)}>
              <div className="relative h-44 overflow-hidden border-b border-rule bg-paper/80">{p.visual}</div>
              <div className="flex flex-1 flex-col p-6">
                <div className="flex items-center gap-3"><IconTile icon={p.icon} tone={p.tone} className="h-9 w-9" /><p className="text-sm font-semibold text-ink-soft">{p.name}</p></div>
                <h3 className="mt-4 text-xl font-semibold tracking-tight">{p.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-ink-soft">{p.text}</p>
                <ul className="mt-4 space-y-2 text-sm">
                  {p.points.map((t) => <li key={t} className="flex gap-2.5"><Icon name="check" className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" strokeWidth={2.2} />{t}</li>)}
                </ul>
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

function MiniCheckout() {
  return (
    <div aria-hidden className="absolute left-1/2 top-6 w-[220px] -translate-x-1/2 rounded-2xl border border-rule bg-white p-3 shadow-lift transition-transform duration-500 group-hover:-translate-y-1.5">
      <div className="flex items-center gap-2 rounded-lg border-2 border-pine px-2 py-1.5"><Icon name="phone" className="h-3.5 w-3.5 text-ink-faint" /><span className="num text-xs font-semibold">+91 98••• •••21</span><Icon name="check" className="ml-auto h-3.5 w-3.5 text-emerald-600" strokeWidth={2.4} /></div>
      <div className="mt-2 rounded-lg bg-paper px-2 py-1.5 text-[10px] text-ink-soft"><span className="font-semibold text-ink">Home</span> · Sector 21, Gurugram</div>
      <div className="mt-2 rounded-lg bg-pine py-1.5 text-center text-[11px] font-semibold text-white">Continue</div>
    </div>
  );
}
function MiniRule() {
  return (
    <div aria-hidden className="absolute left-1/2 top-6 w-[230px] -translate-x-1/2 space-y-2 transition-transform duration-500 group-hover:-translate-y-1.5">
      {[["2 RTOs", "Hide COD", "bg-amber-50 text-amber-800"], ["5 RTOs", "Block orders", "bg-rose-50 text-rose-700"], ["New buyer", "OTP first", "bg-emerald-50 text-emerald-700"]].map(([a, b, c]) => (
        <div key={a} className="flex items-center justify-between rounded-xl border border-rule bg-white px-3 py-2 text-[11px] shadow-sm"><span className="font-semibold">{a}</span><Icon name="arrow" className="h-3 w-3 text-ink-faint" /><span className={`rounded-full px-2 py-0.5 font-semibold ${c}`}>{b}</span></div>
      ))}
    </div>
  );
}
function MiniChart() {
  return (
    <div aria-hidden className="absolute inset-x-6 top-6 rounded-2xl border border-rule bg-white p-3 shadow-lift transition-transform duration-500 group-hover:-translate-y-1.5">
      <div className="flex justify-between text-[10px] text-ink-faint"><span>Recovered checkouts</span><span className="font-semibold text-emerald-600">this week</span></div>
      <svg viewBox="0 0 200 60" className="mt-2 h-20 w-full">
        <defs><linearGradient id="mc" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="#0B5D4B" stopOpacity=".25" /><stop offset="1" stopColor="#0B5D4B" stopOpacity="0" /></linearGradient></defs>
        <path d="M0 50 L30 42 L60 46 L90 30 L120 34 L150 18 L200 10 L200 60 L0 60Z" fill="url(#mc)" />
        <path d="M0 50 L30 42 L60 46 L90 30 L120 34 L150 18 L200 10" fill="none" stroke="#0B5D4B" strokeWidth="2" strokeLinejoin="round" />
      </svg>
    </div>
  );
}

// ---------------- 05 Walkthrough ----------------

const TOUR: { icon: IconName; title: string; text: string; pane: () => JSX.Element }[] = [
  { icon: "stores", title: "Connect your store", text: "Sign up and connect Shopify or WooCommerce. Products, prices and stock stay where they are.", pane: PaneConnect },
  { icon: "rupee", title: "Add payments & gateways", text: "Add up to three gateways in priority order and set prepaid discounts and COD charges.", pane: PaneGateways },
  { icon: "shield", title: "Set COD & offer rules", text: "OTP, block lists, courier-based COD rules, coupons, bank offers and free gifts.", pane: PaneRules },
  { icon: "zap", title: "Go live", text: "Shopify: add one script to your theme. WooCommerce: install our plugin. Checkout opens Growpefy and orders land back in your store.", pane: PaneLive },
];
const STEP_MS = 6000;

function Tour() {
  const [i, setI] = useState(0);
  const [paused, setPaused] = useState(false);
  const [seen, setSeen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = box.current;
    if (!el || !("IntersectionObserver" in window)) return;
    const io = new IntersectionObserver(([e]) => setSeen(e.isIntersecting), { threshold: 0.35 });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  const reduce = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  const auto = seen && !paused && !reduce;
  useEffect(() => {
    if (!auto) return;
    const t = setTimeout(() => setI((n) => (n + 1) % TOUR.length), STEP_MS);
    return () => clearTimeout(t);
  }, [i, auto]);
  const Pane = TOUR[i].pane;
  return (
    <section id="how" className="scroll-mt-20 bg-[#0B1A16] text-white">
      <div className="relative mx-auto max-w-6xl overflow-hidden px-4 py-20 sm:px-6 sm:py-24">
        <div aria-hidden className="pointer-events-none absolute right-0 top-0 h-80 w-80 rounded-full bg-pine-tint0/20 blur-3xl" />
        <SectionHead dark eyebrow="How it works" title="Live in an afternoon, in four steps" text="A guided setup in the dashboard walks you through each step. Our team can join you on a call." />
        <div ref={box} className="relative mt-12 grid gap-6 lg:grid-cols-[minmax(0,.9fr)_minmax(0,1.1fr)]" onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)} onFocus={() => setPaused(true)} onBlur={() => setPaused(false)}>
          <div role="tablist" aria-label="Setup steps" className="space-y-2">
            {TOUR.map((s, n) => {
              const on = n === i;
              return (
                <button key={s.title} type="button" role="tab" aria-selected={on} aria-controls="tour-pane" onClick={() => setI(n)}
                  className={`group relative w-full overflow-hidden rounded-2xl border p-4 text-left transition duration-300 ${on ? "border-white/20 bg-white/[.07]" : "border-transparent hover:bg-white/[.04]"}`} {...rv(n)}>
                  <div className="flex items-start gap-4">
                    <span className={`num flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-semibold transition ${on ? "bg-emerald-400 text-[#0B1A16]" : "bg-white/10 text-slate-300 group-hover:bg-white/15"}`}>{n + 1}</span>
                    <div className="min-w-0">
                      <p className={`font-semibold ${on ? "text-white" : "text-slate-300"}`}>{s.title}</p>
                      <p className={`mt-1 text-sm leading-relaxed transition-colors ${on ? "text-slate-300" : "text-slate-500"}`}>{s.text}</p>
                    </div>
                  </div>
                  {on && <span key={`${i}-${auto}`} aria-hidden className={`absolute inset-x-0 bottom-0 h-0.5 bg-emerald-400 ${auto ? "tour-bar" : ""}`} style={{ "--t": `${STEP_MS}ms` } as React.CSSProperties} />}
                </button>
              );
            })}
          </div>
          <div id="tour-pane" role="tabpanel" className="relative min-h-[320px] rounded-2xl border border-white/10 bg-gradient-to-br from-white/[.07] to-white/[.02] p-4 sm:p-6" {...rv(1)}>
            <div key={i} className="pop h-full"><Pane /></div>
          </div>
        </div>
      </div>
    </section>
  );
}

function Browser({ children, title }: { children: React.ReactNode; title: string }) {
  return (
    <div className="overflow-hidden rounded-xl border border-white/10 bg-white text-ink shadow-2xl">
      <div className="flex items-center gap-1.5 border-b border-rule bg-paper px-3 py-2">
        {["bg-rose-300", "bg-amber-300", "bg-emerald-300"].map((c) => <span key={c} className={`h-2.5 w-2.5 rounded-full ${c}`} />)}
        <span className="ml-2 truncate text-[11px] text-ink-faint">{title}</span>
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}
function PaneConnect() {
  return (
    <Browser title="growpefy.com/dashboard/stores/new">
      <p className="text-sm font-semibold">Connect your store</p>
      <div className="mt-3 grid grid-cols-3 gap-2 text-center text-xs">
        <div className="flex flex-col items-center justify-center rounded-xl border border-pine bg-pine-tint p-3"><span className="flex h-6 items-center"><BrandLogo id="shopify" h={18} /></span><p className="mt-1.5 text-[10px] font-semibold text-pine">Live</p></div>
        <div className="flex flex-col items-center justify-center rounded-xl border border-pine bg-pine-tint p-3"><span className="flex h-6 items-center"><BrandLogo id="woocommerce" h={13} /></span><p className="mt-1.5 text-[10px] font-semibold text-pine">Live</p></div>
        <div className="rounded-xl border border-rule p-3 text-ink-faint"><Icon name="globe" className="mx-auto h-5 w-5" /><p className="mt-1 font-semibold">Custom site</p><p className="text-[10px]">Soon</p></div>
      </div>
      <div className="mt-3 rounded-lg border border-rule px-3 py-2 text-xs text-ink-soft">yourstore.myshopify.com · or your WordPress site</div>
      <div className="mt-3 flex items-center gap-2 rounded-lg bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-800"><Icon name="check" className="h-3.5 w-3.5" strokeWidth={2.4} />Products and stock read live from your store</div>
    </Browser>
  );
}
function PaneGateways() {
  return (
    <Browser title="Settings · Payment gateways">
      <p className="text-sm font-semibold">Payment gateways <span className="font-normal text-ink-faint">· up to 3</span></p>
      <div className="mt-3 space-y-2">
        {[["Primary", GATEWAY_TILES[0]], ["Backup 1", GATEWAY_TILES[1]], ["Backup 2", GATEWAY_TILES[2]]].map(([l, g]) => {
          const gw = g as (typeof GATEWAY_TILES)[number];
          return (
            <div key={l as string} className="flex items-center gap-3 rounded-xl border border-rule px-3 py-2">
              <span className="w-16 text-[11px] font-semibold text-ink-faint">{l as string}</span>
              <span className="flex h-7 flex-1 items-center">{gw.logo ? <img src={gw.logo} alt={gw.name} className="h-5 w-auto" /> : <span className="text-sm font-bold">{gw.name}</span>}</span>
              <span className="h-5 w-9 rounded-full bg-pine p-0.5"><span className="ml-auto block h-4 w-4 rounded-full bg-white" /></span>
            </div>
          );
        })}
      </div>
      <p className="mt-3 text-[11px] text-ink-faint">If the primary can't take a payment, checkout moves to the next one.</p>
    </Browser>
  );
}
function PaneRules() {
  return (
    <Browser title="RTO Suite · COD rules">
      <div className="space-y-2.5 text-xs">
        {[["Ask for OTP before COD", true], ["Wait 24 hours between COD orders", true], ["Hide COD after 2 RTOs (courier data)", true], ["Block listed pincodes", false]].map(([t, on]) => (
          <div key={t as string} className="flex items-center justify-between gap-3 rounded-xl border border-rule px-3 py-2.5">
            <span className="font-medium">{t as string}</span>
            <span className={`h-5 w-9 shrink-0 rounded-full p-0.5 transition ${on ? "bg-pine" : "bg-rule-strong"}`}><span className={`block h-4 w-4 rounded-full bg-white ${on ? "ml-auto" : ""}`} /></span>
          </div>
        ))}
      </div>
    </Browser>
  );
}
function PaneLive() {
  return (
    <Browser title="theme.liquid">
      <pre className="overflow-x-auto rounded-lg bg-[#0B1A16] p-3 text-[11px] leading-relaxed text-slate-300"><span className="text-slate-500">{"<!-- Growpefy checkout -->"}</span>{"\n"}<span className="text-emerald-300">{"<script"}</span> <span className="text-sky-300">src</span>=<span className="text-amber-200">"https://growpefy.com/embed.js"</span><span className="text-emerald-300">{"></script>"}</span></pre>
      <div className="mt-3 flex items-center gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2.5">
        <span className="pulse flex h-7 w-7 items-center justify-center rounded-full bg-emerald-500 text-white"><Icon name="check" className="h-4 w-4" strokeWidth={2.4} /></span>
        <div className="text-xs"><p className="font-semibold text-emerald-900">Checkout is live</p><p className="text-emerald-800">New orders appear in Shopify or WooCommerce as usual</p></div>
      </div>
    </Browser>
  );
}

// ---------------- 06 Use cases ----------------

function UseCases() {
  const items: [IconName, string, string][] = [
    ["sparkle", "New Shopify or WooCommerce store", "Launch with a polished checkout, prepaid offers and OTP from day one, without stitching apps together."],
    ["shield", "High-COD store", "Keep COD open for genuine buyers while OTP, block lists and courier history filter out repeat refusers."],
    ["stores", "Multi-store operator", "Run several stores from one login with one view of orders, wallets and ad performance."],
    ["trend", "Growing D2C brand", "Add backup gateways, recover abandoned checkouts and see cost per order as you scale ad spend."],
  ];
  return (
    <section>
      <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6 sm:py-24">
        <SectionHead eyebrow="Use cases" title="Built around the way your store operates" text="From payment-method rules and promotional offers to courier signals and multi-store visibility, set up a workflow that fits your business." />
        <div className="mt-12 grid gap-4 sm:grid-cols-2">
          {items.map(([icon, t, x], i) => (
            <div key={t} className="spot group flex gap-5 rounded-2xl border border-rule bg-white p-6" {...rv(i)}>
              <IconTile icon={icon} tone={(["blue", "mint", "violet", "amber"] as const)[i]} />
              <div>
                <h3 className="text-[17px] font-semibold">{t}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-ink-soft">{x}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ---------------- 07 Integrations ----------------

function Integrations() {
  return (
    <section id="integrations" className="scroll-mt-20 border-t border-rule">
      <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6 sm:py-24">
        <SectionHead eyebrow="Integrations" title="Connect what you already use" text="Your own payment gateways, the couriers you ship with, and the platforms you sell and advertise on. Status shown honestly." />

        {/* gateways + fallback USP */}
        <div className="relative mt-12 overflow-hidden rounded-3xl bg-[#0B1A16] p-6 text-white sm:p-10" {...rv()}>
          <div aria-hidden className="pointer-events-none absolute -right-24 -top-24 h-80 w-80 rounded-full bg-emerald-400/15 blur-3xl" />
          <div className="relative grid items-center gap-10 lg:grid-cols-[1.1fr_1fr]">
            <div>
              <p className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-xs font-semibold text-emerald-300"><Icon name="refresh" className="h-3.5 w-3.5" />Multi-gateway with automatic backup</p>
              <h3 className="mt-4 text-2xl font-semibold tracking-tight sm:text-3xl">Payments that keep going when a gateway doesn't.</h3>
              <p className="mt-3 text-slate-300">Connect up to three payment gateways on your own merchant accounts and choose the order. If the primary can't start a payment, or a payment fails, checkout moves to the next gateway, so the customer still pays.</p>
              <div className="mt-6 grid grid-cols-2 gap-2 sm:grid-cols-4">
                {GATEWAY_TILES.map((g) => <GatewayTile key={g.id} g={g} />)}
              </div>
              <p className="mt-4 text-xs text-slate-400">Money settles directly from your gateway to your bank. Growpefy never holds your customers' payments.</p>
            </div>
            <GatewayFallback />
          </div>
        </div>

        <div className="mt-5 grid gap-5 lg:grid-cols-[1.2fr_1fr]">
          <div className="spot group min-w-0 rounded-2xl border border-rule bg-white p-6" {...rv(1)}>
            <div className="flex items-center gap-3"><IconTile icon="shipping" tone="mint" /><div><h3 className="font-semibold">Couriers</h3><p className="text-sm text-ink-soft">Live API tracking, or read from your store orders with no API</p></div></div>
            <div className="mt-5"><CourierRow /></div>
            <p className="mt-4 text-xs text-ink-faint">Delivered and RTO rates per courier, shipment filters, and delivery history feeding RTO Shield.</p>
          </div>
          <div className="spot group min-w-0 rounded-2xl border border-rule bg-white p-6" {...rv(2)}>
            <div className="flex items-center gap-3"><IconTile icon="plug" tone="violet" /><div><h3 className="font-semibold">Platforms & marketing</h3><p className="text-sm text-ink-soft">Where you sell and advertise</p></div></div>
            <ul className="mt-5 divide-y divide-rule text-sm">
              {([["shopify", "Store platform", 22], ["woocommerce", "Store platform", 16], ["meta", "Ads, Pixel & Conversions API", 18], ["google", "Ads & conversion uploads", 22]] as const).map(([id, what, h]) => (
                <li key={id} className="flex items-center justify-between gap-3 py-2.5"><span className="flex min-w-0 items-center gap-3"><span className="flex w-[104px] shrink-0 items-center"><BrandLogo id={id} h={h} /></span><span className="truncate text-xs text-ink-soft">{what}</span></span><StatusPill live /></li>
              ))}
              {([["WhatsApp messages & recovery", true], ["Custom websites", false]] as const).map(([n, live]) => (
                <li key={n} className="flex items-center justify-between gap-3 py-2.5"><span className="font-medium">{n}</span><StatusPill live={live} /></li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}

// ---------------- 08 Ads ----------------

/** Meta + Google Ads in one place: spend, cost per order, which one works better. */
function AdsBand() {
  const points: [IconName, string, string][] = [
    ["ads", "Both ad accounts, one view", "Spend, ROAS and cost per order from Meta and Google Ads next to your real checkout orders."],
    ["trend", "See which one works", "Growpefy compares cost per order and tells you whether Meta or Google is doing better."],
    ["send", "Purchases sent back", "Orders go to Meta (Pixel + Conversions API) and Google Ads, including COD, so both optimise for buyers."],
  ];
  return (
    <section className="border-t border-rule bg-gradient-to-b from-paper/70 to-white">
      <div className="mx-auto grid max-w-6xl items-center gap-12 px-4 py-20 sm:px-6 sm:py-24 lg:grid-cols-[1fr_1.05fr]">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[.14em] text-pine" {...rv()}>Ads analytics</p>
          <h2 className="mt-3 text-3xl font-semibold tracking-tight sm:text-[40px] sm:leading-[1.1]" {...rv(1)}>Know which ads actually bring orders.</h2>
          <div className="mt-6 flex flex-wrap items-center gap-x-6 gap-y-3" {...rv(1)}><BrandLogo id="meta" h={26} /><BrandLogo id="google" h={32} /></div>
          <ul className="mt-8 space-y-5">
            {points.map(([icon, t, x], i) => (
              <li key={t} className="flex gap-4" {...rv(i + 2)}>
                <IconTile icon={icon} tone={(["blue", "mint", "violet"] as const)[i]} />
                <div><p className="font-semibold">{t}</p><p className="mt-1 text-sm leading-relaxed text-ink-soft">{x}</p></div>
              </li>
            ))}
          </ul>
        </div>
        <div className="spot rounded-3xl border border-rule bg-white p-5 shadow-lift sm:p-7" {...rv(2)}>
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm font-semibold">Meta vs Google · Last 30 days</p>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-good"><Icon name="trend" className="h-3.5 w-3.5" />Google is 22% cheaper per order</span>
          </div>
          <div className="mt-4 flex h-2.5 overflow-hidden rounded-full bg-paper-sunk"><div className="w-[58%] bg-[#0866FF]" /><div className="w-[42%] bg-[#F2A900]" /></div>
          <p className="mt-1.5 flex justify-between text-[11px] text-ink-faint"><span>Meta 58% of spend</span><span>Google 42% of spend</span></p>
          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            {([["meta", 22, "₹58,400", "412", "₹142", "3.4x", false], ["google", 28, "₹42,300", "382", "₹111", "4.1x", true]] as const).map(([id, h, spend, orders, cpo, roas, better]) => (
              <div key={id} className={`rounded-2xl border p-4 ${better ? "border-emerald-200 bg-emerald-50/40" : "border-rule"}`}>
                <div className="flex h-8 items-center justify-between gap-2"><BrandLogo id={id} h={h} />{better && <span className="rounded-full bg-emerald-500 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">Better</span>}</div>
                <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2.5 text-sm">
                  <div><dt className="text-[11px] text-ink-soft">Spend</dt><dd className="num font-semibold">{spend}</dd></div>
                  <div><dt className="text-[11px] text-ink-soft">Orders</dt><dd className="num font-semibold">{orders}</dd></div>
                  <div><dt className="text-[11px] text-ink-soft">Cost / order</dt><dd className="num font-semibold">{cpo}</dd></div>
                  <div><dt className="text-[11px] text-ink-soft">ROAS</dt><dd className="num font-semibold">{roas}</dd></div>
                </dl>
              </div>
            ))}
          </div>
          <p className="mt-4 text-[11px] text-ink-faint">Sample numbers for illustration.</p>
        </div>
      </div>
    </section>
  );
}

// ---------------- 09 Security ----------------

function Security() {
  const items: [IconName, string, string][] = [
    ["rupee", "Your money, your gateway", "Customers pay into your own gateway account. Settlements go straight to your bank."],
    ["lock", "Keys stay on the server", "Gateway and courier keys are stored server-side and never sent to the browser."],
    ["check", "Payments verified server-side", "Every payment is confirmed with the gateway before an order is marked paid."],
    ["layers", "No duplicate orders", "Each paid checkout creates exactly one order in your store, even if confirmations arrive twice."],
    ["shield", "Saved addresses behind OTP", "Returning customers see their saved address only after verifying their mobile number."],
    ["help", "People you can reach", "Request a callback or raise a complaint from your dashboard and track every reply."],
  ];
  return (
    <section>
      <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6 sm:py-24">
        <SectionHead eyebrow="Security & reliability" title="Built to be trusted with your orders" />
        <div className="mt-12 grid gap-x-8 gap-y-8 sm:grid-cols-2 lg:grid-cols-3">
          {items.map(([icon, t, x], i) => (
            <div key={t} className="group flex gap-4" {...rv(i)}>
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-rule bg-white text-pine shadow-sm transition duration-300 group-hover:-translate-y-0.5 group-hover:border-emerald-200 group-hover:bg-pine-tint"><Icon name={icon} className="h-[18px] w-[18px]" /></span>
              <div><h3 className="font-semibold">{t}</h3><p className="mt-1 text-sm leading-relaxed text-ink-soft">{x}</p></div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
