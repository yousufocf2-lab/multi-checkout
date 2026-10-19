import { Link, NavLink } from "@remix-run/react";
import { useEffect, useState } from "react";
import { BrandLockup } from "~/components/Brand";
import { Icon } from "~/components/Icons";

export const SITE_URL = "https://growpefy.com";

/** Meta tags for a public page. */
export function siteMeta(title: string, description: string, path = "/") {
  return [
    { title },
    { name: "description", content: description },
    { property: "og:title", content: title },
    { property: "og:description", content: description },
    { property: "og:type", content: "website" },
    { property: "og:url", content: `${SITE_URL}${path}` },
    { property: "og:image", content: `${SITE_URL}/brand/growpefy-logo.png` },
    { name: "twitter:card", content: "summary" },
    { tagName: "link", rel: "canonical", href: `${SITE_URL}${path}` },
  ];
}

const NAV = [
  { to: "/#features", label: "Features" },
  { to: "/pricing", label: "Pricing" },
  { to: "/#how", label: "How it works" },
  { to: "/contact", label: "Contact" },
];

export function SiteLayout({ loggedIn, company, children }: { loggedIn: boolean; company: { name: string; email: string; phone: string }; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 8);
    on(); window.addEventListener("scroll", on, { passive: true });
    return () => window.removeEventListener("scroll", on);
  }, []);
  return (
    <div className="min-h-screen bg-white text-ink">
      <header className={`sticky top-0 z-40 border-b transition ${scrolled ? "border-rule bg-white/90 backdrop-blur" : "border-transparent bg-white"}`}>
        <div className="mx-auto flex h-16 max-w-6xl items-center gap-6 px-4 sm:px-6">
          <Link to="/" aria-label="Growpefy home" className="shrink-0"><BrandLockup className="h-8" /></Link>
          <nav className="hidden flex-1 items-center gap-1 md:flex" aria-label="Main">
            {NAV.map((n) => (
              <NavLink key={n.to} to={n.to} className="rounded-lg px-3 py-2 text-sm font-medium text-ink-soft transition hover:bg-paper hover:text-ink">{n.label}</NavLink>
            ))}
          </nav>
          <div className="ml-auto hidden items-center gap-2 md:flex">
            {loggedIn ? (
              <Link to="/dashboard" className="btn-primary">Go to dashboard <Icon name="chevron" className="h-4 w-4 -rotate-90" /></Link>
            ) : (
              <>
                <Link to="/login" className="btn-quiet px-3 py-2 text-sm">Log in</Link>
                <Link to="/signup" className="btn-primary">Sign up free</Link>
              </>
            )}
          </div>
          <button type="button" className="ml-auto rounded-lg border border-rule-strong p-2 md:hidden" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-label="Menu">
            <Icon name={open ? "close" : "menu"} />
          </button>
        </div>
        {open && (
          <div className="border-t border-rule bg-white px-4 pb-4 md:hidden">
            <nav className="flex flex-col py-2" aria-label="Mobile">
              {NAV.map((n) => <Link key={n.to} to={n.to} onClick={() => setOpen(false)} className="rounded-lg px-2 py-2.5 font-medium text-ink-soft">{n.label}</Link>)}
            </nav>
            {loggedIn ? <Link to="/dashboard" className="btn-primary w-full py-3">Go to dashboard</Link> : (
              <div className="grid grid-cols-2 gap-2">
                <Link to="/login" className="btn-secondary py-3">Log in</Link>
                <Link to="/signup" className="btn-primary py-3">Sign up free</Link>
              </div>
            )}
          </div>
        )}
      </header>

      <main>{children}</main>

      <footer className="bg-night text-night-text">
        <div className="mx-auto grid max-w-6xl gap-10 px-4 py-14 sm:px-6 md:grid-cols-[1.4fr_1fr_1fr_1fr]">
          <div>
            <BrandLockup tone="light" className="h-8" />
            <p className="mt-4 max-w-xs text-sm leading-relaxed text-night-faint">Fast checkout, COD control, offers and ad analytics for D2C brands on Shopify, WooCommerce and custom websites.</p>
          </div>
          <FooterCol title="Product" links={[["Features", "/#features"], ["Pricing", "/pricing"], ["How it works", "/#how"], ["Sign up", "/signup"], ["Log in", "/login"]]} />
          <FooterCol title="Company" links={[["Contact us", "/contact"], ["Terms & Conditions", "/terms"], ["Privacy Policy", "/privacy"]]} />
          <FooterCol title="Policies" links={[["Refund & Cancellation", "/refund-policy"], ["Shipping & Delivery", "/shipping-policy"]]} />
        </div>
        <div className="border-t border-night-line">
          <div className="mx-auto flex max-w-6xl flex-col gap-2 px-4 py-5 text-xs text-night-faint sm:flex-row sm:items-center sm:justify-between sm:px-6">
            <p>© {new Date().getFullYear()} {company.name}. All rights reserved.</p>
            <p className="flex flex-wrap gap-x-4 gap-y-1">
              <a href={`mailto:${company.email}`} className="hover:text-white">{company.email}</a>
              {company.phone && <a href={`tel:${company.phone}`} className="hover:text-white">{company.phone}</a>}
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}

function FooterCol({ title, links }: { title: string; links: [string, string][] }) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wider text-white">{title}</p>
      <ul className="mt-4 space-y-2.5 text-sm">
        {links.map(([l, to]) => <li key={to}><Link to={to} className="text-night-faint transition hover:text-white">{l}</Link></li>)}
      </ul>
    </div>
  );
}

/** Long-form page (policies): readable column with a title block. */
export function LegalPage({ title, updated, children }: { title: string; updated: string; children: React.ReactNode }) {
  return (
    <div className="bg-paper/60">
      <div className="mx-auto max-w-3xl px-4 py-14 sm:px-6 sm:py-20">
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">{title}</h1>
        <p className="mt-2 text-sm text-ink-faint">Last updated: {updated}</p>
        <article className="legal mt-10 rounded-2xl border border-rule bg-white p-6 text-[15px] leading-7 text-ink-soft sm:p-10">{children}</article>
      </div>
    </div>
  );
}
