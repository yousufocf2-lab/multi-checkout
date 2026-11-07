// Growpefy Store → Website & domain: preview link and the store's own domain (www.brand.com).
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Form, useActionData, useLoaderData } from "@remix-run/react";
import { useEffect, useState } from "react";
import { Icon } from "~/components/Icons";
import { Card, Dialog } from "~/components/settings-ui";
import { storeHost } from "~/lib/urls.server";
import { and, eq, like, ne, sql } from "drizzle-orm";
import { Link } from "@remix-run/react";
import { orders, shippingRates, storePages } from "~/db.server";
import { onlineReady } from "~/lib/gateways/index.server";
import { themeRow } from "~/lib/themes.server";
import { storePath } from "~/lib/store-code";
import { CopyField, Notice, SubmitButton } from "~/components/ui";
import { db, stores } from "~/db.server";
import { kycGate, requireStore, requireViewer } from "~/lib/auth.server";
import { catalogAllowed, catalogStats } from "~/lib/catalog.server";
import { env } from "~/lib/env.server";
import { addHostname, cfConfigured, CONNECT_HOST, hostnameState, removeHostname } from "~/lib/cloudflare.server";

/** "https://Brand.com/" -> "www.brand.com"; "shop.brand.com" stays as it is. Null when it isn't a domain. */
function cleanDomain(raw: string) {
  const h = raw.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/[/?#].*$/, "").replace(/\.$/, "");
  if (!/^(?=.{4,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}$/.test(h)) return null;
  if (/(^|\.)growpefy\.com$|\.railway\.app$|myshopify\.com$/.test(h)) return null;
  return h.split(".").length === 2 ? `www.${h}` : h;
}

export async function loader({ request, params }: LoaderFunctionArgs) {
  const viewer = await requireViewer(request);
  const store = await requireStore(viewer, params.id);
  const site = catalogAllowed(viewer, store);
  // Moving from Shopify / WooCommerce: what's left before the domain can point at Growpefy
  const launch = site && store.platform !== "growpefy" ? await launchChecklist(store) : null;
  // Cloudflare mode: check the domain's state with Cloudflare while it isn't live yet
  let detail: string | null = null;
  if (site && cfConfigured() && store.storefrontDomain && store.storefrontDomainStatus !== "live") {
    try {
      const st = await hostnameState(store.storefrontDomain);
      if (st.state === "missing") await addHostname(store.storefrontDomain);
      if (st.state === "live") {
        await db.update(stores).set({ storefrontDomainStatus: "live", ...(store.platform === "growpefy" ? { storefrontUrl: `https://${store.storefrontDomain}` } : {}) }).where(eq(stores.id, store.id));
        store.storefrontDomainStatus = "live";
      }
      detail = st.detail;
    } catch (e) {
      console.error("[domain] cloudflare:", e instanceof Error ? e.message : e);
    }
  }
  return json({
    auto: cfConfigured(), detail,
    isAdmin: viewer.role === "admin",
    preview: `${env.appUrl}/s/${store.slug}`, site,
    platformHost: new URL(env.appUrl).host,
    checkoutHost: storeHost(store),
    checkoutDomain: store.checkoutDomain,
    storeWebsite: store.platform !== "growpefy" ? store.storefrontUrl?.replace(/^https?:\/\//, "").replace(/\/+$/, "") ?? null : null,
    platform: store.platform, storefrontEnabled: store.storefrontEnabled, launch,
    domain: store.storefrontDomain, target: cfConfigured() ? CONNECT_HOST() : store.storefrontDnsTarget, status: store.storefrontDomainStatus,
  });
}

async function launchChecklist(store: typeof stores.$inferSelect) {
  const [stats, theme, pages, rates, gpOrders] = await Promise.all([
    catalogStats(store.id), themeRow(store.id),
    db.select({ n: sql<number>`count(*)::int` }).from(storePages).where(and(eq(storePages.storeId, store.id), eq(storePages.published, true))),
    db.select({ n: sql<number>`count(*)::int` }).from(shippingRates).where(and(eq(shippingRates.storeId, store.id), eq(shippingRates.active, true))),
    db.select({ n: sql<number>`count(*)::int` }).from(orders).where(and(eq(orders.storeId, store.id), like(orders.shopifyOrderId, "gp:%"))),
  ]);
  const base = storePath(store.id);
  return [
    { id: "products", title: "Bring your products", text: "Products, variants, photos and categories from your old store. Photos are copied to Growpefy.", done: Number(stats.active) > 0, to: `${base}/catalog`, cta: "Import products" },
    { id: "theme", title: "Design the website", text: "Pick a theme, add your logo, banners and menu, then publish.", done: Boolean(theme?.publishedAt), to: `${base}/themes`, cta: "Open themes" },
    { id: "pages", title: "Add policy pages", text: "Privacy, refund, shipping, terms and contact. Payment gateways check these.", done: (pages[0]?.n ?? 0) >= 4, to: `${base}/pages`, cta: "Add pages" },
    { id: "payments", title: "Payment gateway", text: "Your gateway keeps working on the same domain.", done: onlineReady(store), to: `${base}/payments`, cta: "Check payments" },
    { id: "shipping", title: "Delivery charges", text: "Free or paid delivery, COD charges and areas you ship to.", done: (rates[0]?.n ?? 0) > 0, to: `${base}/shipping`, cta: "Set delivery" },
    { id: "test", title: "Place a test order", text: "Order from the Growpefy address before switching the domain.", done: (gpOrders[0]?.n ?? 0) > 0, to: `/s/${store.slug}`, cta: "Open website" },
    { id: "domain", title: "Point your domain here", text: "Last step. Your old store stops showing once the DNS changes.", done: store.storefrontDomainStatus === "live", to: "#connect", cta: "Connect domain" },
  ];
}

export async function action({ request, params }: ActionFunctionArgs) {
  const viewer = await requireViewer(request);
  const store = await requireStore(viewer, params.id);
  const fd = await request.formData();
  const intent = fd.get("intent");
  if (intent === "enableStore") {
    await db.update(stores).set({ storefrontEnabled: true }).where(eq(stores.id, store.id));
    return json({ ok: "Growpefy Store is on for this store. Follow the launch checklist below.", error: null });
  }
  if (!catalogAllowed(viewer, store)) throw new Response("Not found", { status: 404 });
  if (intent === "domain") {
    const g = kycGate(viewer, "connecting your domain");
    if (g) return json({ ok: null, error: g }, { status: 400 });
    const d = cleanDomain(String(fd.get("domain") ?? ""));
    if (!d) return json({ ok: null, error: "That doesn't look like a domain. Type it like brand.com" }, { status: 400 });
    const [taken] = await db.select({ id: stores.id }).from(stores).where(and(eq(stores.storefrontDomain, d), ne(stores.id, store.id))).limit(1);
    if (taken) return json({ ok: null, error: "This domain is already connected to another store." }, { status: 400 });
    if (cfConfigured()) {
      try { await addHostname(d); } catch (e) { return json({ ok: null, error: e instanceof Error ? e.message : "Couldn't add the domain" }, { status: 400 }); }
    }
    await db.update(stores).set({ storefrontDomain: d, storefrontDomainStatus: cfConfigured() ? "dns" : "requested", storefrontDnsTarget: null }).where(eq(stores.id, store.id));
    console.log(`[domain] store=${store.id} requested ${d}`);
    return json({ ok: cfConfigured() ? `Now add the record below where you bought ${d.replace(/^www\./, "")}.` : `Got it. We're preparing ${d}; you'll see the DNS record to add here shortly.`, error: null });
  }
  if (intent === "remove") {
    if (cfConfigured() && store.storefrontDomain) await removeHostname(store.storefrontDomain).catch((e) => console.error("[domain] remove:", e));
    await db.update(stores).set({ storefrontDomain: null, storefrontDomainStatus: null, storefrontDnsTarget: null, ...(store.platform === "growpefy" ? { storefrontUrl: `${env.appUrl}/s/${store.slug}` } : {}) }).where(eq(stores.id, store.id));
    return json({ ok: "Domain removed. Your website is still on the preview link.", error: null });
  }
  if (viewer.role === "admin" && intent === "target") {
    const t = String(fd.get("target") ?? "").trim().toLowerCase().replace(/\.$/, "");
    const live = fd.get("live") === "on";
    await db.update(stores).set({ storefrontDnsTarget: t || null, storefrontDomainStatus: live ? "live" : t ? "dns" : "requested", ...(live && store.platform === "growpefy" && store.storefrontDomain ? { storefrontUrl: `https://${store.storefrontDomain}` } : {}) }).where(eq(stores.id, store.id));
    return json({ ok: "Saved.", error: null });
  }
  return json({ ok: null, error: null });
}

type Row = { host: string; href: string; kind: string; note: string; status: "connected" | "pending" | "dns"; primary?: boolean; remove?: boolean };

export default function Website() {
  const d = useLoaderData<typeof loader>();
  const { isAdmin, preview, domain, target, status, auto, detail, site } = d;
  const a = useActionData<typeof action>();
  const [connect, setConnect] = useState(false);
  useEffect(() => { if (a?.ok) setConnect(false); }, [a]);
  const bare = domain?.replace(/^www\./, "");
  const live = status === "live";
  const previewHost = preview.replace(/^https?:\/\//, "");

  const rows: Row[] = [];
  if (site) {
    if (domain) rows.push({ host: domain, href: `https://${domain}`, kind: "Your domain", note: live ? "Customers see this address" : status === "dns" ? "Waiting for the DNS record" : "Being prepared", status: live ? "connected" : status === "dns" ? "dns" : "pending", primary: live, remove: true });
    rows.push({ host: previewHost, href: preview, kind: "Growpefy address", note: live ? "Free address, opens the same website" : "Free address that always works", status: "connected", primary: !live });
  } else if (d.storeWebsite) {
    rows.push({ host: d.storeWebsite, href: `https://${d.storeWebsite}`, kind: `${d.platform === "woocommerce" ? "WooCommerce" : "Shopify"} website`, note: "Your online store", status: "connected", primary: true });
  }
  if (d.checkoutHost) rows.push({ host: d.checkoutHost, href: `https://${d.checkoutHost}`, kind: d.checkoutDomain ? "Checkout domain" : "Growpefy checkout address", note: "Checkout and payment pages open here", status: "connected" });

  return (
    <div className="max-w-3xl space-y-4">
      {a?.ok && <Notice tone="success">{a.ok}</Notice>}
      {a?.error && <Notice tone="error">{a.error}</Notice>}

      <Card title="Domains" description="Every address your store and checkout open on. The primary domain is the one customers see."
        action={site && !domain ? <button type="button" className="btn-primary btn shrink-0" onClick={() => setConnect(true)}>Connect your domain</button> : undefined} flush>
        <div className="border-t border-rule">
          <div className="hidden grid-cols-[minmax(0,1fr)_180px_110px] gap-3 bg-[#f7f7f7] px-4 py-1.5 text-[12px] font-medium text-ink-soft sm:grid">
            <span>Domain</span><span>Type</span><span className="text-right">Status</span>
          </div>
          <ul className="divide-y divide-rule">
            {rows.map((r) => (
              <li key={r.host} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-0.5 px-4 py-2.5 sm:grid-cols-[minmax(0,1fr)_180px_110px]">
                <div className="flex min-w-0 items-center gap-2.5">
                  <Icon name="globe" className="h-4 w-4 shrink-0 text-ink-faint" />
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-1.5 text-[13px]">
                      <a href={r.href} target="_blank" rel="noreferrer" className="truncate font-medium hover:underline">{r.host}</a>
                      {r.primary && <span className="rounded-md bg-[#f1f1f1] px-1.5 py-px text-[11px] font-medium text-ink-soft">Primary</span>}
                    </p>
                    <p className="truncate text-[11.5px] text-ink-faint">{r.note}</p>
                  </div>
                </div>
                <span className="col-start-1 row-start-2 pl-[26px] text-[12px] text-ink-soft sm:col-start-2 sm:row-start-1 sm:pl-0 sm:text-[12.5px]">{r.kind}</span>
                <span className="col-start-2 row-span-2 row-start-1 flex items-center justify-end gap-2 sm:col-start-3 sm:row-span-1">
                  <span className={`whitespace-nowrap rounded-md px-1.5 py-px text-[11.5px] font-medium ${r.status === "connected" ? "bg-[#cdfee1] text-[#0c5132]" : "bg-[#fff1e3] text-[#5e4200]"}`}>
                    {r.status === "connected" ? "Connected" : r.status === "dns" ? "Action needed" : "Pending"}
                  </span>
                  {r.remove && (
                    <Form method="post" onSubmit={(e) => { if (!confirm(`Remove ${r.host}? Your website stays on ${previewHost}.`)) e.preventDefault(); }}>
                      <input type="hidden" name="intent" value="remove" />
                      <button className="flex h-6 w-6 items-center justify-center rounded-md text-ink-faint hover:bg-black/5 hover:text-[#8e1f0b]" aria-label={`Remove ${r.host}`} title="Remove domain"><Icon name="trash" className="h-3.5 w-3.5" /></button>
                    </Form>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </div>
        {!site && <p className="border-t border-rule px-4 py-2.5 text-[12px] text-ink-faint">Your website domain is managed in {d.platform === "woocommerce" ? "WordPress" : "Shopify"} right now.</p>}
      </Card>

      {!site && (
        <Card title={`Move your website to Growpefy Store`} description={`Run the whole website on Growpefy instead of ${d.platform === "woocommerce" ? "WooCommerce" : "Shopify"}: same domain, same product links, your products and photos copied over, orders and checkout in one place. Your current website keeps working until you switch the domain.`}>
          <Form method="post"><button name="intent" value="enableStore" className="btn-primary btn">Start moving</button></Form>
        </Card>
      )}

      {d.launch && <LaunchChecklist steps={d.launch} live={live} onConnect={() => (domain ? document.getElementById("dns")?.scrollIntoView({ behavior: "smooth" }) : setConnect(true))} />}

      {site && domain && !live && (
        <Card className="scroll-mt-4" id="dns" title={status === "requested" ? "We're preparing your domain" : `Point ${bare} to Growpefy`}
          description={status === "requested" ? "The record to add will appear here, usually within a few hours." : "Add this record where you bought the domain (GoDaddy, Hostinger, Cloudflare and others)."}>
          {target && (
            <div className="space-y-3">
              <div className="grid gap-2 sm:grid-cols-3">
                <CopyField label="Type" value="CNAME" />
                <CopyField label="Name / Host" value={domain.split(".").length > 2 ? domain.split(".").slice(0, -2).join(".") : "@"} />
                <CopyField label="Value / Points to" value={target} />
              </div>
              {domain.startsWith("www.") && <p className="text-[12.5px] text-ink-soft">Then turn on <b>forwarding</b> from {bare} to https://{domain} in the same place, so both addresses open your store. Delete any old A or CNAME records for www first.</p>}
              <p className="text-[12.5px] text-ink-soft">It usually starts working within 30 minutes (sometimes a few hours). The secure lock (https) is added automatically. Refresh this page to check.</p>
              {detail && <p className="text-[11.5px] text-ink-faint">Status: {detail}</p>}
            </div>
          )}
        </Card>
      )}

      {site && live && <p className="px-1 text-[12px] text-ink-faint">Your admin also opens at <b className="text-ink-soft">{domain}/admin</b>.</p>}

      <Dialog open={connect} onClose={() => setConnect(false)} title="Connect your domain"
        footer={<><button type="button" className="btn-secondary btn" onClick={() => setConnect(false)}>Cancel</button><SubmitButton form="gp-domain" intent="domain" className="btn-primary btn" busyText="Connecting">Next</SubmitButton></>}>
        <Form method="post" id="gp-domain" className="space-y-2">
          <label className="block"><span className="label block">Domain</span>
            <input name="domain" required placeholder="yourbrand.com" className="input" autoComplete="off" />
          </label>
          <p className="text-[12px] text-ink-faint">A domain you already own. We'll show the one record to add where you bought it. The secure lock (https) is free.</p>
        </Form>
      </Dialog>

      {isAdmin && domain && !auto && (
        <Card title="Growpefy team" description={`Add ${domain} on the hosting side, paste the CNAME target here, and tick Live once it is verified. Only the Growpefy team sees this box.`} className="border-dashed">
          <Form method="post" className="flex flex-wrap items-center gap-2">
            <input type="hidden" name="intent" value="target" />
            <input name="target" defaultValue={target ?? ""} placeholder="CNAME target" className="input min-w-0 flex-1" aria-label="CNAME target" />
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="live" defaultChecked={status === "live"} />Live</label>
            <SubmitButton className="btn-secondary" busyText="Saving">Save</SubmitButton>
          </Form>
        </Card>
      )}
    </div>
  );
}

function LaunchChecklist({ steps, live, onConnect }: { steps: { id: string; title: string; text: string; done: boolean; to: string; cta: string }[]; live: boolean; onConnect: () => void }) {
  const done = steps.filter((x) => x.done).length;
  const next = steps.find((x) => !x.done);
  return (
    <Card title={live ? "Your website runs on Growpefy" : "Launch checklist"} description={live ? "Everything is moved. You can close your old store's plan once you've checked a few orders." : `${done} of ${steps.length} done. Switch the domain last, after a test order.`} flush>
      <ol className="divide-y divide-rule border-t border-rule">
        {steps.map((x, i) => (
          <li key={x.id} className={`flex items-center gap-3 px-4 py-2.5 ${next?.id === x.id ? "bg-[#fafafa]" : ""}`}>
            {x.done
              ? <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#303030] text-white"><Icon name="check" className="h-3 w-3" strokeWidth={3} /></span>
              : <span className="num flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-[1.5px] border-dashed border-[#8a8a8a] text-[10.5px] text-ink-soft">{i + 1}</span>}
            <div className="min-w-0 flex-1">
              <p className={`text-[13px] font-medium ${x.done ? "text-ink-soft" : ""}`}>{x.title}</p>
              <p className="text-[12px] text-ink-faint">{x.text}</p>
            </div>
            {!x.done && (x.to.startsWith("#")
              ? <button type="button" onClick={onConnect} className={next?.id === x.id ? "btn-primary btn shrink-0" : "btn-secondary btn shrink-0"}>{x.cta}</button>
              : x.to.startsWith("/s/")
                ? <a href={x.to} target="_blank" rel="noreferrer" className={next?.id === x.id ? "btn-primary btn shrink-0" : "btn-secondary btn shrink-0"}>{x.cta}</a>
                : <Link to={x.to} className={next?.id === x.id ? "btn-primary btn shrink-0" : "btn-secondary btn shrink-0"}>{x.cta}</Link>)}
          </li>
        ))}
      </ol>
    </Card>
  );
}
