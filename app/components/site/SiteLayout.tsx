import { Link, useLocation } from "@remix-run/react";
import { useEffect, useState } from "react";
import { BrandLockup } from "~/components/Brand";
import { Icon } from "~/components/Icons";
import { SUPPORT_EMAIL, SUPPORT_HOURS } from "~/lib/support";

export const SITE_URL = "https://growpefy.com";

type Ld = Record<string, unknown>;
const ORG_ID = `${SITE_URL}/#organization`;

/** Structured data every public page carries: who we are and the site itself. */
export const BASE_LD: Ld[] = [
  {
    "@context": "https://schema.org", "@type": "Organization", "@id": ORG_ID,
    name: "Growpefy", url: SITE_URL, logo: `${SITE_URL}/brand/growpefy-logo.png`,
    email: "support@growpefy.com",
    contactPoint: [{ "@type": "ContactPoint", contactType: "customer support", email: "support@growpefy.com", areaServed: "IN", availableLanguage: ["en", "hi"] }],
  },
  { "@context": "https://schema.org", "@type": "WebSite", "@id": `${SITE_URL}/#website`, name: "Growpefy", url: SITE_URL, publisher: { "@id": ORG_ID }, inLanguage: "en-IN" },
];

/** FAQ rich result data from [question, answer] pairs. */
export const faqLd = (items: [string, string][]): Ld => ({
  "@context": "https://schema.org", "@type": "FAQPage",
  mainEntity: items.map(([q, a]) => ({ "@type": "Question", name: q, acceptedAnswer: { "@type": "Answer", text: a } })),
});

/** Breadcrumb trail: Home › page. */
export const crumbLd = (name: string, path: string): Ld => ({
  "@context": "https://schema.org", "@type": "BreadcrumbList",
  itemListElement: [
    { "@type": "ListItem", position: 1, name: "Home", item: SITE_URL },
    { "@type": "ListItem", position: 2, name, item: `${SITE_URL}${path}` },
  ],
});

/** The product itself (homepage and pricing). */
export const productLd: Ld = {
  "@context": "https://schema.org", "@type": "SoftwareApplication", name: "Growpefy",
  applicationCategory: "BusinessApplication", applicationSubCategory: "Ecommerce checkout",
  operatingSystem: "Web", url: SITE_URL, image: `${SITE_URL}/brand/og-image.jpg`, publisher: { "@id": ORG_ID },
  description: "One-page checkout for Shopify stores with COD and RTO controls, up to three payment gateways with automatic backup, offers, abandoned cart recovery and Meta and Google ads analytics.",
  offers: { "@type": "Offer", price: "0", priceCurrency: "INR", description: "No setup fee or monthly plan. Prepaid wallet with a small fee per order." },
  featureList: [
    "One-page checkout", "COD verification with OTP", "RTO Shield using courier history", "Up to 3 payment gateways with automatic backup",
    "Prepaid discounts, partial COD, coupons and bank offers", "Abandoned checkout recovery on WhatsApp", "Meta and Google ads analytics", "Multi-store dashboard",
  ],
};

/** Meta tags for a public page, plus JSON-LD structured data. */
export function siteMeta(title: string, description: string, path = "/", opts: { ld?: Ld[]; image?: string; noindex?: boolean } = {}) {
  const image = opts.image ?? `${SITE_URL}/brand/og-image.jpg`;
  return [
    { title },
    { name: "description", content: description },
    ...(opts.noindex ? [{ name: "robots", content: "noindex, follow" }] : [{ name: "robots", content: "index, follow, max-image-preview:large" }]),
    { property: "og:site_name", content: "Growpefy" },
    { property: "og:locale", content: "en_IN" },
    { property: "og:title", content: title },
    { property: "og:description", content: description },
    { property: "og:type", content: "website" },
    { property: "og:url", content: `${SITE_URL}${path}` },
    { property: "og:image", content: image },
    { property: "og:image:width", content: "1200" },
    { property: "og:image:height", content: "630" },
    { property: "og:image:alt", content: "Growpefy: checkout and COD risk management for ecommerce brands" },
    { name: "twitter:card", content: "summary_large_image" },
    { name: "twitter:title", content: title },
    { name: "twitter:description", content: description },
    { name: "twitter:image", content: image },
    { tagName: "link", rel: "canonical", href: `${SITE_URL}${path}` },
    ...[...BASE_LD, ...(opts.ld ?? [])].map((d) => ({ "script:ld+json": d })),
  ];
}

/** Search engine ownership tags (Google Search Console, Bing). Set in Railway; shown on the homepage only. */
export function verifyMeta(v: { google?: string | null; bing?: string | null } | undefined) {
  return [
    ...(v?.google ? [{ name: "google-site-verification", content: v.google }] : []),
    ...(v?.bing ? [{ name: "msvalidate.01", content: v.bing }] : []),
  ];
}

/** Props for an element that fades up when scrolled into view. `i` staggers siblings. */
export const rv = (i = 0) => ({ "data-reveal": "", style: { "--d": `${Math.min(i, 8) * 70}ms` } as React.CSSProperties });

const NAV = [
  { to: "/#platform", label: "Product" },
  { to: "/#integrations", label: "Integrations" },
  { to: "/pricing", label: "Pricing" },
  { to: "/about", label: "About" },
  { to: "/contact", label: "Contact" },
];

/** Scroll reveal + pointer spotlight for `.spot` cards. Content stays visible without JS. */
function useSiteMotion(key: string) {
  useEffect(() => {
    const root = document.documentElement;
    const els = Array.from(document.querySelectorAll<HTMLElement>("[data-reveal]:not(.in)"));
    const vh = window.innerHeight;
    // anything already on screen shows at once, so nothing flashes on load
    for (const el of els) { const r = el.getBoundingClientRect(); if (r.top < vh * 0.95 && r.bottom > 0) el.classList.add("in"); }
    root.classList.add("js-reveal");
    const io = "IntersectionObserver" in window ? new IntersectionObserver((entries) => {
      for (const e of entries) if (e.isIntersecting) { e.target.classList.add("in"); io?.unobserve(e.target); }
    }, { rootMargin: "0px 0px -8% 0px", threshold: 0.08 }) : null;
    for (const el of els) if (!el.classList.contains("in")) { if (io) io.observe(el); else el.classList.add("in"); }

    const move = (ev: PointerEvent) => {
      const card = (ev.target as HTMLElement | null)?.closest?.<HTMLElement>(".spot");
      if (!card) return;
      const r = card.getBoundingClientRect();
      card.style.setProperty("--mx", `${ev.clientX - r.left}px`);
      card.style.setProperty("--my", `${ev.clientY - r.top}px`);
    };
    document.addEventListener("pointermove", move, { passive: true });
    return () => { io?.disconnect(); document.removeEventListener("pointermove", move); };
  }, [key]);
}

export function SiteLayout({ loggedIn, company, children }: { loggedIn: boolean; company: { name: string; email: string; phone: string }; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const loc = useLocation();
  useSiteMotion(loc.pathname);
  useEffect(() => setOpen(false), [loc.pathname, loc.hash]);
  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 8);
    on(); window.addEventListener("scroll", on, { passive: true });
    return () => window.removeEventListener("scroll", on);
  }, []);
  const isActive = (to: string) => (to.startsWith("/#") ? loc.pathname === "/" && loc.hash === to.slice(1) : loc.pathname === to);
  return (
    <div className="site min-h-screen bg-white text-ink">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[60] focus:rounded-lg focus:bg-white focus:px-3 focus:py-2 focus:shadow-lift">Skip to content</a>
      <header className={`sticky top-0 z-40 border-b transition-[background-color,border-color,box-shadow] duration-300 ${scrolled || open ? "border-rule bg-white/85 shadow-[0_8px_24px_-20px_rgba(11,22,48,.4)] backdrop-blur-md" : "border-transparent bg-white"}`}>
        <div className="mx-auto flex h-16 max-w-6xl items-center gap-6 px-4 sm:px-6">
          <Link to="/" aria-label="Growpefy home" className="shrink-0 transition-opacity hover:opacity-80"><BrandLockup className="h-8" /></Link>
          <nav className="hidden flex-1 items-center gap-0.5 md:flex" aria-label="Main">
            {NAV.map((n) => (
              <Link key={n.to} to={n.to} aria-current={isActive(n.to) ? "page" : undefined} className={`nav-link rounded-lg px-3 py-2 text-sm font-medium transition-colors hover:text-ink ${isActive(n.to) ? "active text-ink" : "text-ink-soft"}`}>{n.label}</Link>
            ))}
          </nav>
          <div className="ml-auto hidden items-center gap-2 md:flex">
            {loggedIn ? (
              <Link to="/dashboard" className="btn-primary">Go to dashboard <Icon name="arrow" className="nudge h-4 w-4" /></Link>
            ) : (
              <>
                <Link to="/login" className="btn-quiet px-3 py-2 text-sm">Log in</Link>
                <Link to="/signup" className="btn-primary">Get started <Icon name="arrow" className="nudge h-4 w-4" /></Link>
              </>
            )}
          </div>
          <button type="button" className="ml-auto flex h-10 w-10 items-center justify-center rounded-lg border border-rule-strong md:hidden" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-controls="site-menu" aria-label={open ? "Close menu" : "Open menu"}>
            <Icon name={open ? "close" : "menu"} />
          </button>
        </div>
        <div id="site-menu" className={`acc md:hidden ${open ? "open" : ""}`}>
          <div>
            <div className="border-t border-rule px-4 pb-4">
              <nav className="flex flex-col py-2" aria-label="Mobile">
                {NAV.map((n) => <Link key={n.to} to={n.to} className="flex items-center justify-between rounded-lg px-2 py-3 font-medium text-ink-soft hover:bg-paper hover:text-ink">{n.label}<Icon name="chevron" className="h-4 w-4 -rotate-90 text-ink-faint" /></Link>)}
              </nav>
              {loggedIn ? <Link to="/dashboard" className="btn-primary w-full py-3">Go to dashboard</Link> : (
                <div className="grid grid-cols-2 gap-2">
                  <Link to="/login" className="btn-secondary py-3">Log in</Link>
                  <Link to="/signup" className="btn-primary py-3">Get started</Link>
                </div>
              )}
            </div>
          </div>
        </div>
      </header>

      <main id="main">{children}</main>

      <footer className="relative overflow-hidden bg-[#0B1A16] text-slate-300">
        <div aria-hidden className="pointer-events-none absolute -top-40 left-1/2 h-80 w-[48rem] -translate-x-1/2 rounded-full bg-pine-tint0/10 blur-3xl" />
        <div className="relative mx-auto grid max-w-6xl gap-10 px-4 py-14 sm:px-6 md:grid-cols-[1.5fr_1fr_1fr_1fr]">
          <div>
            <BrandLockup tone="light" className="h-8" />
            <p className="mt-4 max-w-xs text-sm leading-relaxed text-slate-400">Checkout, payment choices and COD risk controls for growing ecommerce brands, in one workspace.</p>
            <a href={`mailto:${SUPPORT_EMAIL}`} className="group mt-5 inline-flex items-center gap-2 text-sm font-medium text-white">
              <Icon name="mail" className="h-4 w-4 text-emerald-300" />{SUPPORT_EMAIL}<Icon name="arrow" className="nudge h-3.5 w-3.5 text-slate-400" />
            </a>
            <p className="mt-1.5 flex items-center gap-2 text-xs text-slate-400"><Icon name="clock" className="h-3.5 w-3.5" />{SUPPORT_HOURS}</p>
          </div>
          <FooterCol title="Product" links={[["Platform", "/#platform"], ["Integrations", "/#integrations"], ["Pricing", "/pricing"], ["Get started", "/signup"], ["Log in", "/login"]]} />
          <FooterCol title="Company" links={[["About us", "/about"], ["Contact & callback", "/contact"], ["Terms & Conditions", "/terms"], ["Privacy Policy", "/privacy"]]} />
          <FooterCol title="Policies" links={[["Refund & Cancellation", "/refund-policy"], ["Shipping & Delivery", "/shipping-policy"]]} />
        </div>
        <div className="relative border-t border-white/10">
          <div className="mx-auto flex max-w-6xl flex-col gap-2 px-4 py-5 text-xs text-slate-500 sm:flex-row sm:items-center sm:justify-between sm:px-6">
            <p>© {new Date().getFullYear()} {company.name}. All rights reserved.</p>
            <p className="flex items-center gap-1.5"><Icon name="lock" className="h-3.5 w-3.5" />Payments go straight to each store's own gateway account.</p>
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
        {links.map(([l, to]) => (
          <li key={to}><Link to={to} className="inline-block text-slate-400 transition hover:translate-x-0.5 hover:text-white">{l}</Link></li>
        ))}
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
