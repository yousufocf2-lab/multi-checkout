// Other services: custom apps, online stores, websites and growth setup, built by the Growpefy team.
import type { LoaderFunctionArgs, MetaFunction } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Link, useLoaderData } from "@remix-run/react";
import { Icon, type IconName } from "~/components/Icons";
import { IconTile, SectionHead } from "~/components/site/Blocks";
import { SiteLayout, crumbLd, rv, siteMeta } from "~/components/site/SiteLayout";
import { siteData } from "~/lib/site.server";

export const meta: MetaFunction = () => siteMeta(
  "Other services · Apps, online stores & websites · Growpefy",
  "Beyond checkout, the Growpefy team builds custom Android apps, Shopify online stores and business websites, and sets up payments, WhatsApp and ads tracking for growing businesses.",
  "/services",
  { ld: [crumbLd("Other services", "/services")] },
);
export const loader = async ({ request }: LoaderFunctionArgs) => json(await siteData(request));

type Service = { icon: IconName; tone: "blue" | "mint" | "amber" | "violet" | "rose"; title: string; text: string; points: string[]; reason: string; featured?: boolean };

const SERVICES: Service[] = [
  {
    icon: "phone", tone: "blue", featured: true, reason: "app",
    title: "Custom Android apps",
    text: "Your own app with your brand, so customers can order again in a tap and your offers reach them as notifications.",
    points: ["Your name, logo and colours", "Products, cart, orders and online payments", "Customer login and order tracking", "Push notifications for offers", "Published on the Play Store, with support after launch"],
  },
  {
    icon: "cart", tone: "mint", reason: "website",
    title: "Shopify online stores",
    text: "A complete store that's ready to sell: design, products, payments and shipping, set up the way Indian shoppers buy.",
    points: ["Theme design for your brand", "Product, collection and page setup", "Payment gateway, COD and prepaid offers", "Shipping, courier and policy pages", "Growpefy checkout connected, if you want it"],
  },
  {
    icon: "globe", tone: "violet", reason: "website",
    title: "Business websites",
    text: "A fast, mobile-friendly website that explains what you do and turns visitors into calls, enquiries and bookings.",
    points: ["Custom design, no templates that look like everyone else", "Contact, callback and WhatsApp buttons", "Lead forms that land in one place", "Basic SEO and Google setup", "Domain and hosting guidance"],
  },
  {
    icon: "chat", tone: "mint", reason: "other",
    title: "WhatsApp automation",
    text: "Order updates, COD confirmation, cart recovery and welcome messages on WhatsApp, sent automatically.",
    points: ["WhatsApp Business API setup", "Message templates written and approved", "Order, COD and abandoned-cart flows", "Welcome messages for new leads"],
  },
  {
    icon: "ads", tone: "amber", reason: "other",
    title: "Ads tracking setup",
    text: "Meta and Google tracking set up correctly, so the ad platforms learn from real orders and your numbers add up.",
    points: ["Meta Pixel and Conversions API", "Google Ads conversion tracking", "Lead form campaigns", "Spend next to real orders in one dashboard"],
  },
  {
    icon: "rupee", tone: "rose", reason: "other",
    title: "Payments and gateway setup",
    text: "Get online payments working on your own merchant account, with backups so a failed payment doesn't cost you the order.",
    points: ["PayU, Razorpay, Cashfree and more", "Prepaid discounts and partial COD", "Backup gateway if one fails", "Help with gateway onboarding"],
  },
];

const STEPS: { icon: IconName; title: string; text: string }[] = [
  { icon: "phone", title: "Free call", text: "Tell us about your business and what you need. No obligation." },
  { icon: "layers", title: "Plan and quote", text: "We share the scope, timeline and a fixed price in writing." },
  { icon: "setup", title: "We build", text: "You see progress as we go and give feedback before launch." },
  { icon: "zap", title: "Launch and support", text: "We go live together and stay available after launch." },
];

export default function Services() {
  const d = useLoaderData<typeof loader>();
  const [app, ...rest] = SERVICES;
  return (
    <SiteLayout loggedIn={d.loggedIn} company={d.company}>
      {/* hero */}
      <section className="relative overflow-hidden">
        <div aria-hidden className="pointer-events-none absolute inset-0 bg-[radial-gradient(50%_60%_at_80%_0%,rgba(11,93,75,.12),transparent_70%),radial-gradient(40%_50%_at_0%_100%,rgba(45,212,150,.10),transparent_70%)]" />
        <div className="relative mx-auto max-w-6xl px-4 pb-14 pt-14 sm:px-6 sm:pb-20 sm:pt-20">
          <p className="text-xs font-semibold uppercase tracking-[.14em] text-pine">Other services</p>
          <h1 className="mt-3 max-w-3xl text-4xl font-semibold tracking-tight sm:text-[56px] sm:leading-[1.05]">Apps, stores and websites, <span className="text-pine">built by people who sell online.</span></h1>
          <p className="mt-6 max-w-2xl text-lg leading-relaxed text-ink-soft">Beyond the Growpefy checkout, our team builds the tools a growing business needs: your own app, an online store or website, and the payments, WhatsApp and ads setup behind them.</p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link to="/contact?reason=app" className="btn-primary px-6 py-3.5 text-[15px]">Talk to us about an app<Icon name="arrow" className="nudge h-4 w-4" /></Link>
            <Link to="/contact?reason=website" className="btn-secondary px-6 py-3.5 text-[15px]">Store or website</Link>
          </div>
        </div>
      </section>

      {/* services */}
      <section className="border-y border-rule bg-paper/70">
        <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6 sm:py-24">
          <SectionHead eyebrow="What we do" title="Pick what your business needs" text="Every project starts with a free call and a fixed quote. No surprise bills." />

          {/* featured: apps */}
          <article className="relative mt-12 grid gap-8 overflow-hidden rounded-3xl bg-[#0B1A16] p-6 text-white sm:p-10 lg:grid-cols-[1.1fr_.9fr]" {...rv()}>
            <div aria-hidden className="pointer-events-none absolute -right-20 -top-24 h-72 w-72 rounded-full bg-emerald-400/20 blur-3xl" />
            <div className="relative">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1 text-xs font-semibold text-emerald-300"><Icon name="sparkle" className="h-3.5 w-3.5" />Most asked for</span>
              <h2 className="mt-4 text-3xl font-semibold tracking-tight sm:text-[40px] sm:leading-[1.1]">{app.title}</h2>
              <p className="mt-4 max-w-xl text-[17px] leading-relaxed text-slate-300">{app.text}</p>
              <Link to={`/contact?reason=${app.reason}`} className="btn-primary mt-8 px-6 py-3.5 text-[15px]">Get a free consultation<Icon name="arrow" className="nudge h-4 w-4" /></Link>
            </div>
            <ul className="relative space-y-3 self-center">
              {app.points.map((p) => (
                <li key={p} className="flex items-start gap-3 rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-[15px]">
                  <Icon name="check" className="mt-0.5 h-4 w-4 shrink-0 text-emerald-300" strokeWidth={2.4} />{p}
                </li>
              ))}
            </ul>
          </article>

          <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {rest.map((s, i) => (
              <article key={s.title} className="group flex flex-col rounded-2xl border border-rule bg-white p-6 transition duration-300 hover:-translate-y-1 hover:shadow-lift" {...rv(i)}>
                <IconTile icon={s.icon} tone={s.tone} />
                <h3 className="mt-4 text-lg font-semibold">{s.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-ink-soft">{s.text}</p>
                <ul className="mt-4 flex-1 space-y-2">
                  {s.points.map((p) => (
                    <li key={p} className="flex items-start gap-2 text-sm text-ink-soft"><Icon name="check" className="mt-0.5 h-4 w-4 shrink-0 text-pine" strokeWidth={2.4} />{p}</li>
                  ))}
                </ul>
                <Link to={`/contact?reason=${s.reason}`} className="mt-6 inline-flex items-center gap-1.5 text-sm font-semibold text-pine hover:text-pine-dark">Ask about this<Icon name="arrow" className="nudge h-4 w-4" /></Link>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* how we work */}
      <section>
        <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6 sm:py-24">
          <SectionHead eyebrow="How we work" title="From first call to launch in four steps" />
          <ol className="relative mt-14 grid gap-6 md:grid-cols-4">
            <div aria-hidden className="absolute left-[12%] right-[12%] top-6 hidden h-px bg-emerald-200 md:block" />
            {STEPS.map((s, i) => (
              <li key={s.title} className="group relative text-center" {...rv(i)}>
                <span className="relative mx-auto flex h-12 w-12 items-center justify-center rounded-full border border-rule bg-white text-pine shadow-sm transition duration-300 group-hover:-translate-y-1 group-hover:bg-pine group-hover:text-white"><Icon name={s.icon} className="h-5 w-5" /></span>
                <p className="mt-4 font-semibold"><span className="num text-ink-faint">{i + 1}.</span> {s.title}</p>
                <p className="mx-auto mt-1 max-w-[220px] text-sm leading-relaxed text-ink-soft">{s.text}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* CTA */}
      <section className="px-4 pb-20 sm:px-6">
        <div className="relative mx-auto max-w-6xl overflow-hidden rounded-3xl bg-[#0B1A16] px-6 py-14 text-center text-white sm:px-12 sm:py-16" {...rv()}>
          <div aria-hidden className="pointer-events-none absolute -left-24 -top-24 h-72 w-72 rounded-full bg-emerald-400/20 blur-3xl" />
          <h2 className="relative text-3xl font-semibold tracking-tight sm:text-[40px] sm:leading-tight">Have something in mind?</h2>
          <p className="relative mx-auto mt-3 max-w-xl text-slate-300">Request a callback and tell us what you need. We'll call you, understand your business and share a fixed quote.</p>
          <div className="relative mt-8 flex flex-wrap justify-center gap-3">
            <Link to="/contact?reason=app" className="btn-primary px-6 py-3.5 text-[15px]"><Icon name="phone" className="h-4 w-4" />Request a callback</Link>
          </div>
        </div>
      </section>
    </SiteLayout>
  );
}
