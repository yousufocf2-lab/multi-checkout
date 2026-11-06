import type { LoaderFunctionArgs, MetaFunction } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Link, useLoaderData } from "@remix-run/react";
import { Icon } from "~/components/Icons";
import { CtaBand, Faq } from "~/components/site/Blocks";
import { SiteLayout, crumbLd, faqLd, productLd, rv, siteMeta } from "~/components/site/SiteLayout";
import { siteData } from "~/lib/site.server";
import { PLANS, feePct, rupeesLabel } from "~/lib/plans";

export const meta: MetaFunction = () => siteMeta("Plans & pricing · Growpefy", "Choose a Growpefy monthly plan with a clear transaction fee. Monthly invoices include order and messaging usage, with GST shown separately.", "/pricing", { ld: [productLd, faqLd(BILLING_FAQ), crumbLd("Pricing", "/pricing")] });

export const loader = async ({ request }: LoaderFunctionArgs) => json(await siteData(request));

const INCLUDED = [
  "Unlimited stores on one login",
  "Fast one-page checkout with your branding",
  "Up to 3 payment gateways with automatic backup",
  "Prepaid discounts, partial COD, coupons and bank offers",
  "Free gifts at checkout",
  "RTO Suite: OTP, COD wait time, block lists, WhatsApp confirmation",
  "Courier tracking, delivery performance and RTO Shield",
  "Meta and Google Ads: spend, ROAS, cost per order and which one works better",
  "Orders, abandoned checkouts and CSV exports",
  "Help & support with callbacks and tracked complaints",
];

const BILLING_FAQ: [string, string][] = [
  ["When does my plan renew?", "Your billing period follows the date you started the plan. A monthly invoice is created on that date each month."],
  ["How are order fees calculated?", "The transaction fee shown for your plan applies to orders placed through Smart Checkout. OTP and WhatsApp usage is listed separately when a message is sent."],
  ["Is GST included in the plan price?", "No. GST at 18% is added to the taxable invoice amount and shown separately."],
  ["How do I pay an invoice?", "Open Plan & billing in your dashboard and pay an open invoice securely through PayU. Invoices can be downloaded as PDFs."],
  ["What happens if an invoice stays unpaid?", "You can pay during the invoice due period and the following 7-day grace period. After that, checkout pauses until the overdue invoice is paid."],
  ["What happens to my old wallet balance?", "Unused wallet balance and its previously paid GST are moved to your monthly billing account when you start a plan. A dropshipping wallet remains available for fulfilment charges."],
];

export default function Pricing() {
  const d = useLoaderData<typeof loader>();
  return (
    <SiteLayout loggedIn={d.loggedIn} company={d.company}>
      <section className="relative overflow-hidden border-b border-rule">
        <div aria-hidden className="pointer-events-none absolute inset-0 bg-[radial-gradient(50%_60%_at_50%_0%,rgba(11,93,75,.12),transparent_70%)]" />
        <div className="relative mx-auto max-w-3xl px-4 pb-14 pt-16 text-center sm:px-6 sm:pt-20">
          <p className="text-xs font-semibold uppercase tracking-[.14em] text-pine">Plans & pricing</p>
          <h1 className="mt-3 text-4xl font-semibold tracking-tight sm:text-5xl">A plan that fits your next stage.</h1>
          <p className="mx-auto mt-4 max-w-xl text-lg text-ink-soft">One clear monthly invoice for your plan, checkout transaction fees and the messages you use.</p>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-14 sm:px-6 sm:py-16">
        <div className="grid gap-5 md:grid-cols-3">
          {PLANS.map((p, i) => (
            <article key={p.id} className={`relative flex flex-col rounded-2xl border bg-white p-6 shadow-sm ${i === 1 ? "border-pine/40 ring-2 ring-pine/10" : "border-rule"}`}>
              {i === 1 && <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-pine px-3 py-1 text-[11px] font-semibold text-white">Popular choice</span>}
              <p className="text-sm font-semibold text-pine">{p.name}</p>
              <h2 className="mt-3 flex items-baseline gap-1"><span className="num text-4xl font-semibold tracking-tight">{rupeesLabel(p.monthlyRupees)}</span><span className="text-sm text-ink-soft">/ month</span></h2>
              <p className="mt-2 min-h-10 text-sm text-ink-soft">{p.tagline}</p>
              <div className="mt-5 rounded-xl bg-paper px-4 py-3"><p className="text-xs text-ink-soft">Smart Checkout transaction fee</p><p className="num mt-1 text-2xl font-semibold text-pine">{feePct(p)}</p><p className="text-xs text-ink-faint">per order</p></div>
              <ul className="mt-5 flex-1 space-y-2.5 text-sm">
                {[...p.highlights, ...INCLUDED.slice(0, 7)].map((t, n) => <li key={`${n}-${t}`} className="flex gap-2.5"><Icon name="check" className="mt-0.5 h-4 w-4 shrink-0 text-pine" />{t}</li>)}
              </ul>
              <Link to={d.loggedIn ? "/dashboard" : "/signup"} className={`${i === 1 ? "btn-primary" : "btn-secondary"} mt-6 w-full py-3 text-center`}>{d.loggedIn ? "Choose in dashboard" : "Get started"}</Link>
            </article>
          ))}
        </div>
        <p className="mt-5 text-center text-xs text-ink-soft">GST at 18% is added to the invoice and shown separately. OTP and WhatsApp charges are billed monthly by actual usage.</p>
        <div className="mx-auto mt-12 max-w-4xl rounded-2xl border border-rule bg-white p-6 sm:p-8" {...rv(1)}>
          <div className="grid gap-6 md:grid-cols-[.8fr_1.2fr] md:items-center">
            <div><h2 className="text-xl font-semibold">Everything you need to grow</h2><p className="mt-2 text-sm text-ink-soft">All three plans include the Growpefy commerce toolkit.</p><Link to={d.loggedIn ? "/dashboard" : "/signup"} className="btn-primary mt-5 inline-flex">{d.loggedIn ? "Go to dashboard" : "Get started"}</Link></div>
            <ul className="grid gap-2.5 text-sm sm:grid-cols-2">{INCLUDED.map((t) => <li key={t} className="flex gap-2.5"><Icon name="check" className="mt-0.5 h-4 w-4 shrink-0 text-pine" />{t}</li>)}</ul>
          </div>
        </div>
      </section>

      <section className="border-t border-rule bg-paper/60">
        <div className="mx-auto max-w-3xl px-4 py-16 sm:px-6">
          <h2 className="text-center text-2xl font-semibold tracking-tight sm:text-3xl" {...rv()}>Billing questions</h2>
          <div className="mt-8"><Faq items={BILLING_FAQ} /></div>
        </div>
      </section>

      <CtaBand loggedIn={d.loggedIn} />
    </SiteLayout>
  );
}
