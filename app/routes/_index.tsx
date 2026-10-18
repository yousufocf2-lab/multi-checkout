import type { LoaderFunctionArgs, MetaFunction } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { Link, useLoaderData } from "@remix-run/react";
import { eq } from "drizzle-orm";
import { Icon, type IconName } from "~/components/Icons";
import { CtaBand, RateCard, SectionHead } from "~/components/site/Blocks";
import { SiteLayout, siteMeta } from "~/components/site/SiteLayout";
import { db, stores } from "~/db.server";
import { siteData } from "~/lib/site.server";
import { isAppHost, requestHost } from "~/lib/urls.server";
import { rupees } from "~/lib/wallet";

export const meta: MetaFunction = () =>
  siteMeta("Growpefy · Fast Shopify checkout with COD control, offers and ad analytics",
    "One checkout for all your Shopify stores. Cut RTO with COD rules, lift prepaid orders with offers and free gifts, and see ROAS and cost per order in one dashboard. No monthly fee.");

/** Platform domain → website. A store's checkout domain → that store's storefront. */
export async function loader({ request }: LoaderFunctionArgs) {
  if (!isAppHost(request)) {
    const [store] = await db.select({ url: stores.storefrontUrl }).from(stores).where(eq(stores.checkoutDomain, requestHost(request))).limit(1);
    if (store) throw redirect(store.url);
  }
  return json(await siteData(request));
}

const FEATURES: { icon: IconName; title: string; text: string; tint: string }[] = [
  { icon: "cart", title: "One-page fast checkout", text: "Address, payment and order in one clean page that opens straight from Buy Now and the cart. Your logo, colors and fonts.", tint: "bg-emerald-50 text-emerald-700" },
  { icon: "shipping", title: "COD control & RTO rules", text: "Turn COD on or off by pincode, order value and customer history. Block repeat COD after failed prepaid, add COD fees.", tint: "bg-orange-50 text-orange-700" },
  { icon: "discounts", title: "Prepaid offers that convert", text: "Extra discount for online payment, coupons and bank offers on PayU. Show customers exactly how much they save.", tint: "bg-sky-50 text-sky-700" },
  { icon: "gift", title: "Free gifts & Mix and Match", text: "Buy X get Y, free gifts and Buy 2 Get 1 deals, applied automatically at checkout with upsells to grow order value.", tint: "bg-rose-50 text-rose-700" },
  { icon: "ads", title: "Meta ads analytics", text: "ROAS and cost per order for every store, with ad recharges tracked including GST. Know which store is really making money.", tint: "bg-violet-50 text-violet-700" },
  { icon: "stores", title: "All stores, one dashboard", text: "Switch between stores in a click. Orders, abandoned checkouts, CSV exports, wallet and GST invoices in one place.", tint: "bg-amber-50 text-amber-700" },
];

const FAQ: [string, string][] = [
  ["Do I need to change my Shopify theme?", "Only one line. You paste our script in your theme and the cart's Checkout and Buy Now buttons open Growpefy checkout. Your theme, products and Shopify admin stay the same, and every order is created in Shopify."],
  ["Which payment gateway do you support?", "Customers pay through your own PayU account, so money settles directly to your bank. Cash on Delivery is built in with rules you control."],
  ["Is there a monthly fee?", "No. You recharge a prepaid wallet and pay only a small fee on each order placed through the checkout. See the pricing page for the full rate card."],
  ["Can I run more than one store?", "Yes. Connect as many Shopify stores as you like and manage them from one login. Each store can have its own checkout domain, design and offers."],
  ["What happens if my wallet balance runs out?", "Your checkout never stops taking orders. The wallet can go slightly below zero; past that limit promotional messages pause and some dashboard tools lock until you recharge."],
  ["Will I get a GST invoice?", "Yes. Every wallet recharge comes with a GST tax invoice you can download from the dashboard."],
];

export default function Home() {
  const d = useLoaderData<typeof loader>();
  return (
    <SiteLayout loggedIn={d.loggedIn} company={d.company}>
      {/* Hero */}
      <section className="relative overflow-hidden">
        <div aria-hidden className="pointer-events-none absolute inset-0 bg-[radial-gradient(60%_50%_at_80%_20%,rgba(45,212,150,.16),transparent_70%),radial-gradient(40%_40%_at_10%_90%,rgba(11,93,75,.08),transparent_70%)]" />
        <div aria-hidden className="pointer-events-none absolute inset-0 opacity-[.35] [background-image:linear-gradient(rgba(28,36,48,.05)_1px,transparent_1px),linear-gradient(90deg,rgba(28,36,48,.05)_1px,transparent_1px)] [background-size:44px_44px] [mask-image:radial-gradient(70%_60%_at_50%_30%,#000,transparent)]" />
        <div className="relative mx-auto grid max-w-6xl items-center gap-12 px-4 pb-16 pt-12 sm:px-6 sm:pt-20 lg:grid-cols-[1.1fr_1fr] lg:pb-24">
          <div>
            <p className="inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-800">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />Built for Shopify D2C brands in India
            </p>
            <h1 className="mt-5 text-[40px] font-semibold leading-[1.05] tracking-tight text-ink sm:text-6xl">
              Checkout that <span className="bg-gradient-to-r from-pine to-emerald-500 bg-clip-text text-transparent">grows</span> your store.
            </h1>
            <p className="mt-5 max-w-xl text-lg leading-relaxed text-ink-soft">
              One fast checkout for all your Shopify stores, with COD control, prepaid offers, free gifts and Meta ad analytics built in. Pay only when you sell.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link to={d.loggedIn ? "/dashboard" : "/signup"} className="btn-primary px-6 py-3.5 text-[15px]">{d.loggedIn ? "Go to dashboard" : "Start free"}<Icon name="chevron" className="h-4 w-4 -rotate-90" /></Link>
              <Link to="/pricing" className="btn-secondary px-6 py-3.5 text-[15px]">See pricing</Link>
            </div>
            <ul className="mt-8 flex flex-wrap gap-x-6 gap-y-2 text-sm text-ink-soft">
              {["No monthly fee", `${d.rates.saleFeeBps / 100}% per order`, "GST invoice on every recharge"].map((t) => (
                <li key={t} className="flex items-center gap-2"><Icon name="check" className="h-4 w-4 text-emerald-600" />{t}</li>
              ))}
            </ul>
          </div>
          <CheckoutMock />
        </div>
      </section>

      {/* Features */}
      <section id="features" className="scroll-mt-20 border-t border-rule bg-paper/50">
        <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
          <SectionHead eyebrow="Everything in one checkout" title="More prepaid orders. Fewer returns. Clear numbers." text="The tools Indian D2C brands patch together from five apps, built into one checkout and one dashboard." />
          <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((f) => (
              <div key={f.title} className="group rounded-2xl border border-rule bg-white p-6 transition hover:-translate-y-0.5 hover:shadow-lift">
                <span className={`flex h-11 w-11 items-center justify-center rounded-xl ${f.tint}`}><Icon name={f.icon} className="h-5 w-5" /></span>
                <h3 className="mt-5 text-[17px] font-semibold">{f.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-ink-soft">{f.text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Ads band */}
      <section className="bg-night text-white">
        <div className="mx-auto grid max-w-6xl items-center gap-12 px-4 py-20 sm:px-6 lg:grid-cols-2">
          <div>
            <p className="text-sm font-semibold text-emerald-300">Ads analytics</p>
            <h2 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">Know what every order really costs.</h2>
            <p className="mt-4 text-night-text">Connect your Meta ad account and Growpefy matches spend with real checkout orders. See ROAS, cost per order and ad recharges with GST for every store, side by side.</p>
            <ul className="mt-6 space-y-3 text-sm text-night-text">
              {["Cost per order tagged Excellent, Good, Average or Poor", "Ad recharges detected automatically, GST added back", "Compare stores to see where to put your next rupee"].map((t) => (
                <li key={t} className="flex gap-3"><Icon name="check" className="mt-0.5 h-4 w-4 shrink-0 text-emerald-300" />{t}</li>
              ))}
            </ul>
          </div>
          <AdsMock />
        </div>
      </section>

      {/* How it works */}
      <section id="how" className="scroll-mt-20">
        <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
          <SectionHead eyebrow="Live in an afternoon" title="Three steps to your new checkout" />
          <ol className="mt-12 grid gap-4 md:grid-cols-3">
            {[
              ["Connect Shopify", "Sign up, add your store and connect it with a Shopify app. Products, prices and stock stay in Shopify."],
              ["Add PayU and set rules", "Add your PayU keys, choose prepaid discounts, COD rules, offers and your checkout design."],
              ["Paste one script", "Add one line to your theme. Checkout and Buy Now open Growpefy, and orders land in Shopify."],
            ].map(([t, x], i) => (
              <li key={t} className="relative rounded-2xl border border-rule bg-white p-6">
                <span className="num flex h-9 w-9 items-center justify-center rounded-full bg-pine text-sm font-semibold text-white">{i + 1}</span>
                <h3 className="mt-5 text-[17px] font-semibold">{t}</h3>
                <p className="mt-2 text-sm leading-relaxed text-ink-soft">{x}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* Pricing teaser */}
      <section className="border-y border-rule bg-paper/50">
        <div className="mx-auto grid max-w-6xl items-center gap-10 px-4 py-20 sm:px-6 lg:grid-cols-[1fr_1.1fr]">
          <div>
            <p className="text-sm font-semibold text-pine">Simple pricing</p>
            <h2 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">Pay as you sell. No monthly fee.</h2>
            <p className="mt-4 text-ink-soft">Recharge a prepaid wallet (from {rupees(d.minRecharge, 0)} + GST) and we deduct a small fee only when an order is placed. Messages are charged only when sent.</p>
            <Link to="/pricing" className="btn-primary mt-7 px-6 py-3">See full pricing</Link>
          </div>
          <RateCard rates={d.rates} />
        </div>
      </section>

      {/* FAQ */}
      <section>
        <div className="mx-auto max-w-3xl px-4 py-20 sm:px-6">
          <SectionHead eyebrow="Questions" title="Frequently asked questions" />
          <div className="mt-10 divide-y divide-rule rounded-2xl border border-rule bg-white">
            {FAQ.map(([q, a]) => (
              <details key={q} className="group px-6 py-5 [&_summary::-webkit-details-marker]:hidden">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-medium">
                  {q}<Icon name="plus" className="h-4 w-4 shrink-0 text-ink-faint transition group-open:rotate-45" />
                </summary>
                <p className="mt-3 text-sm leading-relaxed text-ink-soft">{a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      <CtaBand loggedIn={d.loggedIn} />
    </SiteLayout>
  );
}

function CheckoutMock() {
  return (
    <div className="relative mx-auto w-full max-w-[360px]" aria-hidden>
      <div className="absolute -inset-6 rounded-[40px] bg-gradient-to-tr from-emerald-200/40 to-transparent blur-2xl" />
      <div className="relative rounded-[32px] border border-rule bg-white p-3 shadow-[0_30px_60px_-20px_rgba(11,93,75,.35)]">
        <div className="rounded-[24px] bg-paper/70 p-4">
          <div className="flex items-center justify-between">
            <span className="text-sm font-bold tracking-tight">YOUR BRAND</span>
            <span className="flex items-center gap-1 text-[10px] font-medium text-ink-faint"><Icon name="check" className="h-3 w-3" />Secure checkout</span>
          </div>
          <div className="mt-3 rounded-xl bg-gradient-to-r from-emerald-500 to-pine px-3 py-2 text-[11px] font-semibold text-white">🎁 Buy 2, Get 1 Free unlocked</div>
          <div className="mt-3 space-y-2 rounded-xl border border-rule bg-white p-3">
            {[["Wireless earbuds", "₹1,299", "bg-sky-100"], ["Smart watch", "₹2,499", "bg-amber-100"], ["Phone stand", "FREE", "bg-rose-100"]].map(([n, p, c]) => (
              <div key={n} className="flex items-center gap-2.5 text-xs">
                <span className={`h-9 w-9 rounded-lg ${c}`} />
                <span className="flex-1 font-medium">{n}</span>
                <span className={`num font-semibold ${p === "FREE" ? "text-emerald-600" : ""}`}>{p}</span>
              </div>
            ))}
          </div>
          <div className="mt-3 space-y-2">
            <div className="flex items-center justify-between rounded-xl border-2 border-pine bg-white px-3 py-2.5 text-xs">
              <span className="flex items-center gap-2 font-semibold"><span className="h-3.5 w-3.5 rounded-full border-4 border-pine" />Pay online</span>
              <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">Save ₹180</span>
            </div>
            <div className="flex items-center justify-between rounded-xl border border-rule bg-white px-3 py-2.5 text-xs text-ink-soft">
              <span className="flex items-center gap-2"><span className="h-3.5 w-3.5 rounded-full border border-rule-strong" />Cash on Delivery</span>
              <span className="text-[10px]">+₹49</span>
            </div>
          </div>
          <div className="mt-3 flex items-center justify-between text-xs"><span className="text-ink-soft">Total</span><span className="num text-base font-semibold">₹3,618</span></div>
          <div className="mt-3 rounded-xl bg-pine py-3 text-center text-sm font-semibold text-white">Pay ₹3,618</div>
        </div>
      </div>
      <div className="absolute -left-10 bottom-20 hidden rounded-xl border border-rule bg-white px-3 py-2 shadow-lift sm:block">
        <p className="text-[10px] text-ink-faint">Prepaid share</p><p className="num text-sm font-semibold text-pine">↑ more online orders</p>
      </div>
    </div>
  );
}

function AdsMock() {
  const rows: [string, string, string, string, string][] = [
    ["Store A", "₹42,300", "4.8x", "₹212", "bg-emerald-400/15 text-emerald-300"],
    ["Store B", "₹18,900", "3.1x", "₹486", "bg-lime-400/15 text-lime-300"],
    ["Store C", "₹9,750", "1.9x", "₹734", "bg-amber-400/15 text-amber-300"],
  ];
  const tag = ["Excellent", "Good", "Average"];
  return (
    <div className="rounded-2xl border border-night-line bg-night-soft p-5 shadow-2xl" aria-hidden>
      <div className="grid grid-cols-3 gap-3">
        {[["Ad spend", "₹70,950"], ["ROAS", "3.9x"], ["Cost per order", "₹318"]].map(([l, v]) => (
          <div key={l} className="rounded-xl bg-white/5 p-3"><p className="text-[11px] text-night-faint">{l}</p><p className="num mt-1 text-lg font-semibold">{v}</p></div>
        ))}
      </div>
      <div className="mt-4 overflow-hidden rounded-xl border border-night-line">
        {rows.map(([s, sp, r, c, t], i) => (
          <div key={s} className={`grid grid-cols-[1fr_auto_auto_auto] items-center gap-4 px-4 py-3 text-sm ${i ? "border-t border-night-line" : ""}`}>
            <span className="font-medium">{s}</span><span className="num text-night-text">{sp}</span><span className="num">{r}</span>
            <span className={`num rounded-md px-2 py-0.5 text-xs font-semibold ${t}`}>{c} · {tag[i]}</span>
          </div>
        ))}
      </div>
      <p className="mt-3 text-[11px] text-night-faint">Sample numbers for illustration.</p>
    </div>
  );
}
