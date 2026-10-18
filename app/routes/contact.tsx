import type { LoaderFunctionArgs, MetaFunction } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { Icon } from "~/components/Icons";
import { SiteLayout, siteMeta } from "~/components/site/SiteLayout";
import { siteData } from "~/lib/site.server";

export const meta: MetaFunction = () => siteMeta("Contact us · Growpefy", "Talk to the Growpefy team about checkout, pricing, onboarding or support.", "/contact");
export const loader = async ({ request }: LoaderFunctionArgs) => json(await siteData(request));

export default function Contact() {
  const d = useLoaderData<typeof loader>();
  const c = d.company;
  const wa = c.phone.replace(/[^\d]/g, "");
  return (
    <SiteLayout loggedIn={d.loggedIn} company={c}>
      <section className="mx-auto max-w-5xl px-4 py-16 sm:px-6 sm:py-20">
        <div className="max-w-2xl">
          <p className="text-sm font-semibold text-pine">Contact us</p>
          <h1 className="mt-3 text-4xl font-semibold tracking-tight sm:text-5xl">We'd love to hear from you.</h1>
          <p className="mt-4 text-lg text-ink-soft">Questions about onboarding, pricing or your account? Reach us and we'll reply within one working day.</p>
        </div>
        <div className="mt-12 grid gap-4 md:grid-cols-3">
          <Card icon="sparkle" title="Email">
            <a href={`mailto:${c.email}`} className="font-medium text-pine hover:underline">{c.email}</a>
            <p className="mt-1 text-xs text-ink-faint">Support, billing and partnerships</p>
          </Card>
          <Card icon="users" title="Phone / WhatsApp">
            {c.phone ? <>
              <a href={`tel:${c.phone}`} className="font-medium text-pine hover:underline">{c.phone}</a>
              {wa.length >= 10 && <p className="mt-1"><a href={`https://wa.me/${wa.length === 10 ? `91${wa}` : wa}`} className="text-xs font-medium text-ink-soft hover:underline" target="_blank" rel="noreferrer">Chat on WhatsApp</a></p>}
            </> : <p className="text-sm text-ink-soft">Write to us by email</p>}
            <p className="mt-1 text-xs text-ink-faint">Mon to Sat, 10 am to 7 pm IST</p>
          </Card>
          <Card icon="stores" title="Registered office">
            <p className="text-sm font-medium text-ink">{c.name}</p>
            {c.address && <p className="mt-1 text-sm text-ink-soft">{c.address}{c.state ? `, ${c.state}` : ""}</p>}
            {c.gstin && <p className="mt-1 text-xs text-ink-faint">GSTIN: {c.gstin}</p>}
          </Card>
        </div>
      </section>
    </SiteLayout>
  );
}

function Card({ icon, title, children }: { icon: "sparkle" | "users" | "stores"; title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-rule bg-white p-6">
      <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-50 text-emerald-700"><Icon name={icon} className="h-5 w-5" /></span>
      <p className="mt-4 text-xs font-semibold uppercase tracking-wider text-ink-faint">{title}</p>
      <div className="mt-2">{children}</div>
    </div>
  );
}
