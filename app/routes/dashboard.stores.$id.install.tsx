import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Form, Link, useActionData, useLoaderData, useSearchParams } from "@remix-run/react";
import { CopyField, Notice, SubmitButton } from "~/components/ui";
import { and, desc, eq } from "drizzle-orm";
import { db, paymentEvents } from "~/db.server";
import { requireStore, requireViewer } from "~/lib/auth.server";
import { env } from "~/lib/env.server";
import { testMeta } from "~/lib/meta.server";
import { ADAPTERS, activeGateways } from "~/lib/gateways/index.server";
import { SLOT_LABELS, gatewayById, gatewayName } from "~/lib/gateways/catalog";
import { SHOPIFY_SCOPES } from "~/lib/scopes";
import { testConnection } from "~/lib/platform.server";
import { WOO_PLUGIN_PATH, WOO_PLUGIN_VERSION } from "~/lib/woo";
import { useState } from "react";
import { storeBaseUrl } from "~/lib/urls.server";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const s = await requireStore(await requireViewer(request), params.id);
  const [lastHook] = await db.select({ at: paymentEvents.createdAt, kind: paymentEvents.kind, status: paymentEvents.status })
    .from(paymentEvents).where(and(eq(paymentEvents.storeId, s.id), eq(paymentEvents.source, "webhook"))).orderBy(desc(paymentEvents.createdAt)).limit(1);
  return json({
    lastHook: lastHook ? { at: lastHook.at.toISOString(), kind: lastHook.kind, status: lastHook.status } : null,
    store: {
      id: s.id, slug: s.slug, shopDomain: s.shopDomain, checkoutDomain: s.checkoutDomain,
      hasToken: Boolean(s.adminToken), hasClient: Boolean(s.clientId && s.clientSecret),
      woo: s.platform === "woocommerce", wooSecret: s.platform === "woocommerce" ? s.wooSecret ?? "" : "", site: s.storefrontUrl,
      metaReady: Boolean(s.metaAdAccountId && s.metaAccessToken),
    },
    gateways: activeGateways(s).map((g, i) => ({ id: g.id, name: gatewayName(g.id), mode: g.mode, slot: SLOT_LABELS[i], webhook: Boolean(gatewayById(g.id)?.webhook) })),
    appUrl: env.appUrl,
    checkoutBase: storeBaseUrl(s),
  });
}

export async function action({ request, params }: ActionFunctionArgs) {
  const store = await requireStore(await requireViewer(request), params.id);
  const intent = (await request.formData()).get("intent");
  const run = async (fn: () => Promise<string>) => {
    try { return json({ intent, ok: await fn(), error: null }); }
    catch (e) { return json({ intent, ok: null, error: e instanceof Error ? e.message : String(e) }); }
  };
  if (intent === "testShopify") return run(async () => { const s = await testConnection(store); return `Connected to ${s.name} (${s.currencyCode})`; });
  if (intent === "testWoo") return run(async () => {
    const s = await testConnection(store) as { name: string; currencyCode: string; plugin?: string; wc?: string };
    return `Connected to ${s.name} (${s.currencyCode})${s.plugin ? ` · plugin ${s.plugin}` : ""}${s.wc ? ` · WooCommerce ${s.wc}` : ""}`;
  });
  if (intent === "testGateways") return run(async () => {
    const list = activeGateways(store);
    if (!list.length) throw new Error("No payment gateway is connected. Add one in Settings.");
    const lines = await Promise.all(list.map(async (g, i) => {
      try { return `${SLOT_LABELS[i]} · ${await ADAPTERS[g.id].test(g)}`; } catch (e) { return `${SLOT_LABELS[i]} · ${gatewayName(g.id)}: ${e instanceof Error ? e.message : String(e)}`; }
    }));
    return lines.join(" | ");
  });
  if (intent === "testMeta") return run(async () => {
    const r = await testMeta(store);
    return `Connected to ${r.account.name} (${r.account.status}, balance ₹${r.account.balance.toLocaleString("en-IN")})${r.pixel ? `. Pixel: ${r.pixel}` : ". No pixel set"}`;
  });
  return json({ intent, ok: null, error: "Unknown action" });
}

export default function Setup() {
  const { store, appUrl, checkoutBase, lastHook, gateways } = useLoaderData<typeof loader>();
  const res = useActionData<typeof action>();
  const [params] = useSearchParams();
  // Always the platform domain: it works even while a store's own checkout domain is being set up
  const snippet = `<script src="${appUrl}/embed.js?store=${store.slug}" defer></script>`;
  const result = (intent: string) =>
    res?.intent === intent ? <div className="mt-3"><Notice tone={res.ok ? "success" : "error"}>{res.ok ?? res.error}</Notice></div> : null;

  return (
    <div className="max-w-3xl space-y-5">
      {params.get("created") && <Notice tone="success">Store saved. Follow these steps to start taking orders.</Notice>}
      {params.get("connected") && <Notice tone="success">Shopify connected. Run the test below to confirm.</Notice>}

      <ol className="space-y-5">
        {store.woo ? <WooSteps store={store} appUrl={appUrl} result={result} /> : (
        <Step n={1} title="Connect Shopify" done={store.hasToken}>
          <p className="text-sm text-ink-soft">In your Shopify app (Dev Dashboard), set these values and turn on <b>Use legacy install flow</b>. Turn off <b>Embed app in Shopify admin</b>.</p>
          <div className="mt-4 space-y-3">
            <CopyField label="App URL" value={`${appUrl}/shopify/install`} />
            <CopyField label="Allowed redirection URL" value={`${appUrl}/shopify/callback`} />
            <CopyField label="Scopes" value={SHOPIFY_SCOPES} />
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            {store.hasClient ? (
              <a href={`/shopify/install?shop=${encodeURIComponent(store.shopDomain)}&store=${store.id}`} className="btn-primary">{store.hasToken ? "Reconnect Shopify" : "Connect with Shopify"}</a>
            ) : (
              <Link to="../settings" relative="path" className="btn-primary">Add Client ID and secret</Link>
            )}
            <Form method="post"><SubmitButton intent="testShopify" className="btn-secondary" busyText="Testing" disabled={!store.hasToken}>Test connection</SubmitButton></Form>
          </div>
          {result("testShopify")}
        </Step>
        )}

        <Step n={store.woo ? 3 : 2} title="Checkout address" done>
          <p className="text-sm text-ink-soft">Your checkout opens on <b className="text-ink">{checkoutBase.replace(/^https:\/\//, "")}</b>. Nothing to set up.</p>
          {store.checkoutDomain ? (
            <div className="mt-2 space-y-2 text-sm text-ink-soft">
              <p>You use your own domain. Make sure these are done, or clear the domain in <Link to="../settings" relative="path" className="underline">Settings</Link> to use the free address:</p>
              <ul className="list-disc space-y-1 pl-5">
                <li>Railway: Settings → Networking → Custom domain → add <b className="text-ink">{store.checkoutDomain}</b>.</li>
                <li>Your DNS: add a <b className="text-ink">CNAME</b> record named <b className="text-ink">{store.checkoutDomain.split(".")[0]}</b> pointing to the target Railway shows.</li>
              </ul>
            </div>
          ) : (
            <p className="mt-1 text-xs text-ink-faint">Want your own domain like checkout.yourstore.com? Add it in <Link to="../settings" relative="path" className="underline">Settings</Link>.</p>
          )}
        </Step>

        <Step n={store.woo ? 4 : 3} title="Payment gateways" done={gateways.length > 0}>
          {gateways.length ? (
            <ul className="space-y-1 text-sm text-ink-soft">
              {gateways.map((g) => <li key={g.id}><b className="text-ink">{g.slot}:</b> {g.name} <span className="text-xs">({g.mode === "live" ? "Live" : "Test mode"})</span></li>)}
            </ul>
          ) : (
            <p className="text-sm text-ink-soft">Add your payment gateway in <Link to="../settings" relative="path" className="underline">Settings</Link>. You can add up to 3: if the first has a problem, the next one takes over.</p>
          )}
          <p className="mt-2 text-sm text-ink-soft">Place one online and one COD test order before going live.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Form method="post"><SubmitButton intent="testGateways" className="btn-secondary" busyText="Testing" disabled={!gateways.length}>Test gateways</SubmitButton></Form>
            <Form method="post"><SubmitButton intent="testMeta" className="btn-secondary" busyText="Testing" disabled={!store.metaReady}>Test Meta ads</SubmitButton></Form>
          </div>
          {result("testGateways")}
          {result("testMeta")}
        </Step>

        <Step n={store.woo ? 5 : 4} title="Payment webhooks" done={Boolean(lastHook)}>
          <p className="text-sm text-ink-soft">
            Webhooks tell us about a payment even if the customer closes the browser before coming back.
            We always re-check each event with the gateway before changing an order.
          </p>
          <div className="mt-3 space-y-3">
            {gateways.filter((g) => g.webhook).map((g) => <CopyField key={g.id} label={`${g.name} webhook URL`} value={`${appUrl}/pg/${g.id}/webhook`} />)}
            {!gateways.some((g) => g.webhook) && <p className="text-sm text-ink-faint">Your gateways don't need a webhook.</p>}
          </div>
          <p className="mt-3 text-xs text-ink-faint">In each gateway's dashboard, open Webhooks (or Notifications) and add the URL for payment success and failure.</p>
          <p className="mt-2 text-sm">{lastHook
            ? <>Last webhook received {new Date(lastHook.at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" })} ({lastHook.kind}{lastHook.status ? `, ${lastHook.status}` : ""}).</>
            : <span className="text-ink-faint">No webhook received yet.</span>}</p>
        </Step>

        {store.woo && (
          <Step n={6} title="Turn on the Growpefy checkout">
            <p className="text-sm text-ink-soft">In <b>WooCommerce → Growpefy</b>, tick <b>Only for logged-in admins</b> first and place a test order from the cart. When it works, untick it so every customer gets the Growpefy checkout.</p>
            <ul className="mt-3 list-disc space-y-1 pl-5 text-xs text-ink-faint">
              <li>The cart's <b>Proceed to checkout</b> and any <b>Buy now</b> button that goes to the checkout page open Growpefy.</li>
              <li>If Growpefy can't be reached, customers see your normal WooCommerce checkout, so you never lose an order.</li>
              <li>Orders are created in WooCommerce with the payment method, discounts, shipping and stock reduced.</li>
            </ul>
          </Step>
        )}
        {!store.woo && <Step n={5} title="Add the checkout to your theme">
          <p className="text-sm text-ink-soft">Shopify admin → Online Store → Themes → <b>Duplicate</b> your theme → Edit code → <code>layout/theme.liquid</code>. Paste this just before <code>&lt;/body&gt;</code>, then preview the copy before publishing.</p>
          <div className="mt-3"><CopyField label="Theme script" value={snippet} /></div>
          <p className="mt-3 text-xs text-ink-faint">The cart's Checkout button and Buy it now open this checkout automatically. For a custom button, add the <code>data-cx-checkout</code> attribute or call <code>Growpefy.go()</code>.</p>
        </Step>}
      </ol>
    </div>
  );
}

function Step({ n, title, done, children }: { n: number; title: string; done?: boolean; children: React.ReactNode }) {
  return (
    <li className="panel flex gap-4 p-5">
      <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-sm font-semibold ${done ? "bg-pine text-white" : "border border-rule-strong text-ink-soft"}`} aria-label={done ? "Done" : `Step ${n}`}>
        {done ? "✓" : n}
      </span>
      <div className="min-w-0 flex-1">
        <h2 className="mb-1.5 text-[15px] font-semibold">{title}</h2>
        {children}
      </div>
    </li>
  );
}

type StoreView = { slug: string; woo: boolean; wooSecret: string; site: string };

/** WooCommerce: install the plugin, paste Store ID + secret, test, then turn it on in the plugin. */
function WooSteps({ store, appUrl, result }: { store: StoreView; appUrl: string; result: (intent: string) => React.ReactNode }) {
  const [show, setShow] = useState(false);
  const wp = store.site.replace(/\/+$/, "");
  return (
    <>
      <Step n={1} title="Install the Growpefy plugin on WordPress">
        <p className="text-sm text-ink-soft">Download the plugin, then in WordPress go to <b>Plugins → Add New Plugin → Upload Plugin</b>, choose the zip, <b>Install Now</b> and <b>Activate</b>. Needs WooCommerce 7+ and HTTPS.</p>
        <div className="mt-4 flex flex-wrap gap-2">
          <a href={WOO_PLUGIN_PATH} download className="btn-primary">Download plugin (v{WOO_PLUGIN_VERSION})</a>
          <a href={`${wp}/wp-admin/plugin-install.php?tab=upload`} target="_blank" rel="noreferrer" className="btn-secondary">Open WordPress upload page</a>
        </div>
      </Step>
      <Step n={2} title="Paste these in the plugin settings">
        <p className="text-sm text-ink-soft">WordPress → <b>WooCommerce → Growpefy</b>. Paste the three values and click <b>Save changes</b>.</p>
        <div className="mt-4 space-y-3">
          <CopyField label="Growpefy URL" value={appUrl} />
          <CopyField label="Store ID" value={store.slug} />
          {show ? <CopyField label="Secret key" value={store.wooSecret} /> : (
            <div>
              <span className="label">Secret key</span>
              <button type="button" onClick={() => setShow(true)} className="btn-secondary w-full justify-center">Show secret key</button>
              <p className="mt-1 text-xs text-ink-faint">Keep it private. Anyone with it could create orders in your store. You can make a new one in Settings.</p>
            </div>
          )}
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <Form method="post"><SubmitButton intent="testWoo" className="btn-secondary" busyText="Testing">Test connection</SubmitButton></Form>
        </div>
        {result("testWoo")}
      </Step>
    </>
  );
}

