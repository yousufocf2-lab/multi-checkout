import type { LoaderFunctionArgs, MetaFunction } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Link, useLoaderData } from "@remix-run/react";
import { useState } from "react";
import { Icon } from "~/components/Icons";
import { CtaBand, RateCard } from "~/components/site/Blocks";
import { SiteLayout, siteMeta } from "~/components/site/SiteLayout";
import { siteData } from "~/lib/site.server";
import { rupees, WALLET_GST } from "~/lib/wallet";

export const meta: MetaFunction = () => siteMeta("Pricing · Growpefy", "No monthly fee. Recharge a prepaid wallet and pay a small fee only on orders placed through your checkout. GST invoice on every recharge.", "/pricing");

export const loader = async ({ request }: LoaderFunctionArgs) => json(await siteData(request));

const INCLUDED = [
  "Unlimited Shopify stores on one login",
  "Fast one-page checkout with your branding",
  "Prepaid discounts, coupons and PayU bank offers",
  "COD rules, COD fee and repeat-COD blocking",
  "Free gifts, Buy X Get Y and Mix & Match deals",
  "Upsells at checkout",
  "Meta ads ROAS and cost per order",
  "Orders, abandoned checkouts and CSV exports",
  "GST invoice for every wallet recharge",
];

export default function Pricing() {
  const d = useLoaderData<typeof loader>();
  const min = d.minRecharge;
  return (
    <SiteLayout loggedIn={d.loggedIn} company={d.company}>
      <section className="relative overflow-hidden border-b border-rule">
        <div aria-hidden className="pointer-events-none absolute inset-0 bg-[radial-gradient(50%_60%_at_50%_0%,rgba(45,212,150,.14),transparent_70%)]" />
        <div className="relative mx-auto max-w-3xl px-4 pb-14 pt-16 text-center sm:px-6 sm:pt-20">
          <p className="text-sm font-semibold text-pine">Pricing</p>
          <h1 className="mt-3 text-4xl font-semibold tracking-tight sm:text-5xl">Pay only when you sell.</h1>
          <p className="mx-auto mt-4 max-w-xl text-lg text-ink-soft">No setup fee. No monthly plan. Recharge a prepaid wallet and a small fee is deducted when an order is placed.</p>
        </div>
      </section>

      <section className="mx-auto grid max-w-6xl gap-8 px-4 py-16 sm:px-6 lg:grid-cols-[1.1fr_1fr]">
        <div>
          <h2 className="text-xl font-semibold">Rate card</h2>
          <p className="mt-1 text-sm text-ink-soft">Same for every store. Volume pricing available, <Link to="/contact" className="font-medium text-pine underline underline-offset-2">talk to us</Link>.</p>
          <div className="mt-5"><RateCard rates={d.rates} /></div>
          <div className="mt-6 rounded-2xl border border-rule bg-paper/60 p-6">
            <h3 className="font-semibold">How the wallet works</h3>
            <ul className="mt-3 space-y-2.5 text-sm text-ink-soft">
              <li className="flex gap-3"><Icon name="wallet" className="mt-0.5 h-4 w-4 shrink-0 text-pine" />Minimum recharge {rupees(min, 0)} + 18% GST ({rupees(Math.round(min * (1 + WALLET_GST)), 0)} total). The full {rupees(min, 0)} is added to your wallet.</li>
              <li className="flex gap-3"><Icon name="rupee" className="mt-0.5 h-4 w-4 shrink-0 text-pine" />Pay online with UPI, cards or net banking. You get a GST tax invoice instantly.</li>
              <li className="flex gap-3"><Icon name="check" className="mt-0.5 h-4 w-4 shrink-0 text-pine" />Your checkout never stops. Low-balance alerts remind you to recharge in time.</li>
            </ul>
          </div>
        </div>
        <div className="space-y-6">
          <Calculator bps={d.rates.saleFeeBps} />
          <div className="rounded-2xl border border-rule bg-white p-6">
            <h3 className="font-semibold">Everything included</h3>
            <ul className="mt-4 grid gap-2.5 text-sm">
              {INCLUDED.map((t) => <li key={t} className="flex gap-3"><Icon name="check" className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />{t}</li>)}
            </ul>
            <Link to={d.loggedIn ? "/dashboard" : "/signup"} className="btn-primary mt-6 w-full py-3">{d.loggedIn ? "Go to dashboard" : "Sign up free"}</Link>
          </div>
        </div>
      </section>

      <CtaBand loggedIn={d.loggedIn} />
    </SiteLayout>
  );
}

function Calculator({ bps }: { bps: number }) {
  const [orders, setOrders] = useState(1000);
  const [aov, setAov] = useState(1200);
  const fee = Math.round(orders * aov * bps) / 100; // paise
  return (
    <div className="rounded-2xl border-2 border-pine/20 bg-gradient-to-b from-emerald-50/70 to-white p-6">
      <h3 className="font-semibold">Estimate your monthly cost</h3>
      <div className="mt-5 space-y-5">
        <Slider label="Orders per month" value={orders} min={50} max={20000} step={50} onChange={setOrders} format={(v) => v.toLocaleString("en-IN")} />
        <Slider label="Average order value" value={aov} min={199} max={5000} step={50} onChange={setAov} format={(v) => `₹${v.toLocaleString("en-IN")}`} />
      </div>
      <div className="mt-6 rounded-xl bg-white p-4 shadow-sm">
        <p className="text-sm text-ink-soft">Order fees per month</p>
        <p className="num mt-1 text-3xl font-semibold text-pine">{rupees(fee, 0)}</p>
        <p className="mt-1 text-xs text-ink-faint">{(bps / 100)}% of {rupees(orders * aov * 100, 0)} sales, plus GST. Messages extra, only if you use them.</p>
      </div>
    </div>
  );
}

function Slider({ label, value, min, max, step, onChange, format }: { label: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void; format: (v: number) => string }) {
  return (
    <label className="block">
      <span className="flex items-center justify-between text-sm"><span className="text-ink-soft">{label}</span><span className="num font-semibold">{format(value)}</span></span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} className="mt-2 w-full accent-[rgb(var(--brand))]" />
    </label>
  );
}
