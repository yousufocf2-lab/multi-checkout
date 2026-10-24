import type { LoaderFunctionArgs, MetaFunction } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Link, useLoaderData } from "@remix-run/react";
import { Icon, type IconName } from "~/components/Icons";
import { CtaBand, IconTile, SectionHead } from "~/components/site/Blocks";
import { SiteLayout, rv, siteMeta } from "~/components/site/SiteLayout";
import { siteData } from "~/lib/site.server";
import { SUPPORT_EMAIL } from "~/lib/support";

export const meta: MetaFunction = () => siteMeta("About us · Growpefy", "Growpefy brings checkout customization, payment choices and COD risk controls together, so ecommerce teams can manage more of the order journey from one workspace.", "/about");
export const loader = async ({ request }: LoaderFunctionArgs) => json(await siteData(request));

const VALUES: { icon: IconName; tone: "blue" | "mint" | "amber" | "violet"; title: string; text: string }[] = [
  { icon: "rupee", tone: "mint", title: "Merchant money stays with the merchant", text: "Customers pay into your own gateway account. We never sit between you and your settlements." },
  { icon: "eye", tone: "blue", title: "Honest numbers", text: "No inflated dashboards or guaranteed uplift claims. We show what happened, so you can decide what to change." },
  { icon: "layers", tone: "violet", title: "Fewer tools, more control", text: "Checkout, offers, COD rules, courier data and recovery should work together, not in five separate apps." },
  { icon: "globe", tone: "amber", title: "Built for how India buys", text: "COD, partial COD, UPI, pincodes, OTP and WhatsApp aren't edge cases here. They're the default." },
];

const JOURNEY: { icon: IconName; title: string; text: string }[] = [
  { icon: "cart", title: "Checkout", text: "Phone-first, one page, your branding, saved addresses behind OTP." },
  { icon: "rupee", title: "Payment", text: "Up to three gateways with automatic backup, prepaid and partial COD offers." },
  { icon: "shield", title: "Risk", text: "OTP, block lists and courier history decide who gets COD." },
  { icon: "shipping", title: "Delivery", text: "Every AWB tracked, delivered vs RTO per courier." },
  { icon: "refresh", title: "Recovery", text: "Abandoned checkouts brought back on WhatsApp." },
];

export default function About() {
  const d = useLoaderData<typeof loader>();
  return (
    <SiteLayout loggedIn={d.loggedIn} company={d.company}>
      {/* hero */}
      <section className="relative overflow-hidden">
        <div aria-hidden className="pointer-events-none absolute inset-0 bg-[radial-gradient(50%_60%_at_80%_0%,rgba(11,93,75,.12),transparent_70%),radial-gradient(40%_50%_at_0%_100%,rgba(45,212,150,.10),transparent_70%)]" />
        <div className="relative mx-auto max-w-6xl px-4 pb-16 pt-14 sm:px-6 sm:pb-20 sm:pt-20">
          <p className="text-xs font-semibold uppercase tracking-[.14em] text-pine">About Growpefy</p>
          <h1 className="mt-3 max-w-3xl text-4xl font-semibold tracking-tight sm:text-[56px] sm:leading-[1.05]">We build the order layer between <span className="text-pine">“Buy now”</span> and <span className="text-emerald-600">“Delivered”</span>.</h1>
          <p className="mt-6 max-w-2xl text-lg leading-relaxed text-ink-soft">Growpefy brings checkout customization, payment choices and COD risk controls together, so ecommerce teams can manage more of the order journey from one workspace.</p>
        </div>
      </section>

      {/* story */}
      <section className="border-y border-rule bg-paper/70">
        <div className="mx-auto grid max-w-6xl gap-12 px-4 py-20 sm:px-6 lg:grid-cols-[1fr_1.1fr]">
          <div {...rv()}>
            <p className="text-xs font-semibold uppercase tracking-[.14em] text-pine">Our story</p>
            <h2 className="mt-3 text-3xl font-semibold tracking-tight sm:text-[40px] sm:leading-[1.1]">Started by people who run online stores.</h2>
          </div>
          <div className="space-y-5 text-[17px] leading-relaxed text-ink-soft" {...rv(1)}>
            <p>Growpefy started inside a D2C business. Running Shopify stores day to day, we kept hitting the same walls: a checkout that didn't feel like our brand, COD parcels coming back unopened, a failed payment with no backup gateway to fall back on, and courier data stuck in spreadsheets.</p>
            <p>Every fix meant another app, another login and another monthly bill, and none of them talked to each other. So we built the tools we needed in one place, first for our own stores, then for other brands facing the same problems.</p>
            <p className="font-medium text-ink">Today Growpefy helps stores configure checkout, offer smarter payment options, manage COD risk and see how every order performs.</p>
          </div>
        </div>
      </section>

      {/* journey */}
      <section>
        <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6 sm:py-24">
          <SectionHead eyebrow="What we build" title="One workspace for the whole order journey" />
          <ol className="relative mt-14 grid gap-4 md:grid-cols-5">
            <div aria-hidden className="absolute left-[10%] right-[10%] top-6 hidden h-px bg-gradient-to-r from-emerald-200 via-emerald-200 to-emerald-200 md:block" />
            {JOURNEY.map((j, i) => (
              <li key={j.title} className="group relative text-center" {...rv(i)}>
                <span className="relative mx-auto flex h-12 w-12 items-center justify-center rounded-full border border-rule bg-white text-pine shadow-sm transition duration-300 group-hover:-translate-y-1 group-hover:border-emerald-300 group-hover:bg-pine group-hover:text-white group-hover:shadow-[0_10px_24px_-10px_rgba(11,93,75,.8)]"><Icon name={j.icon} className="h-5 w-5" /></span>
                <p className="mt-4 font-semibold">{j.title}</p>
                <p className="mx-auto mt-1 max-w-[200px] text-sm leading-relaxed text-ink-soft">{j.text}</p>
              </li>
            ))}
          </ol>
          <div className="mt-12 text-center" {...rv()}><Link to="/#platform" className="group inline-flex items-center gap-1.5 font-semibold text-pine hover:text-pine-dark">Explore the platform<Icon name="arrow" className="nudge h-4 w-4" /></Link></div>
        </div>
      </section>

      {/* values */}
      <section className="bg-[#0B1A16] text-white">
        <div className="relative mx-auto max-w-6xl overflow-hidden px-4 py-20 sm:px-6 sm:py-24">
          <div aria-hidden className="pointer-events-none absolute -left-20 top-10 h-72 w-72 rounded-full bg-pine-tint0/20 blur-3xl" />
          <SectionHead dark eyebrow="What we believe" title="The principles behind every feature" />
          <div className="relative mt-12 grid gap-4 sm:grid-cols-2">
            {VALUES.map((v, i) => (
              <div key={v.title} className="spot spot-dark group rounded-2xl border border-white/10 bg-white/[.04] p-6" {...rv(i)}>
                <IconTile icon={v.icon} tone="navy" />
                <h3 className="mt-5 text-lg font-semibold">{v.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-slate-300">{v.text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* how we work */}
      <section>
        <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6 sm:py-24">
          <SectionHead eyebrow="Working with us" title="You won't be left alone with a setup guide" />
          <div className="mt-12 grid gap-4 md:grid-cols-3">
            {([
              ["phone", "Onboarding on a call", "We help you connect the store, add gateway keys and set your first rules, on a call if you like."],
              ["flag", "Support you can track", "Raise a complaint from your dashboard and follow every reply until it's resolved."],
              ["mail", "A real inbox", `Write to ${SUPPORT_EMAIL} and a person replies, usually within one working day.`],
            ] as [IconName, string, string][]).map(([icon, t, x], i) => (
              <div key={t} className="spot group rounded-2xl border border-rule bg-white p-6" {...rv(i)}>
                <IconTile icon={icon} tone={(["blue", "mint", "violet"] as const)[i]} />
                <h3 className="mt-5 text-[17px] font-semibold">{t}</h3>
                <p className="mt-2 text-sm leading-relaxed text-ink-soft">{x}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <CtaBand loggedIn={d.loggedIn} title="Let's talk about your store" text="Tell us how you sell today and we'll show you how Growpefy fits. Ask for a callback or get started on your own." />
    </SiteLayout>
  );
}
