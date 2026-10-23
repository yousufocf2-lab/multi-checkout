import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Form, Link, useActionData, useLoaderData, useSearchParams } from "@remix-run/react";
import { CopyField, Notice, SubmitButton } from "~/components/ui";
import { and, desc, eq } from "drizzle-orm";
import { db, paymentEvents } from "~/db.server";
import { requireStore, requireViewer } from "~/lib/auth.server";
import { env } from "~/lib/env.server";
import { testMeta } from "~/lib/meta.server";
import { testPayu } from "~/lib/payu.server";
import { SHOPIFY_SCOPES } from "~/lib/scopes";
import { testConnection } from "~/lib/shopify.server";
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
      payuReady: Boolean(s.payuKey && s.payuSalt), payuMode: s.payuMode, metaReady: Boolean(s.metaAdAccountId && s.metaAccessToken),
    },
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
  if (intent === "testPayu") return run(() => testPayu(store));
  if (intent === "testMeta") return run(async () => {
    const r = await testMeta(store);
    return `Connected to ${r.account.name} (${r.account.status}, balance ₹${r.account.balance.toLocaleString("en-IN")})${r.pixel ? `. Pixel: ${r.pixel}` : ". No pixel set"}`;
  });
  return json({ intent, ok: null, error: "Unknown action" });
}

export default function Setup() {
  const { store, appUrl, checkoutBase, lastHook } = useLoaderData<typeof loader>();
  const res = useActionData<typeof action>();
  const [params] = useSearchParams();
  const snippet = `<script src="${checkoutBase}/embed.js?store=${store.slug}" defer></script>`;
  const result = (intent: string) =>
    res?.intent === intent ? <div className="mt-3"><Notice tone={res.ok ? "success" : "error"}>{res.ok ?? res.error}</Notice></div> : null;

  return (
    <div className="max-w-3xl space-y-5">
      {params.get("created") && <Notice tone="success">Store saved. Follow these steps to start taking orders.</Notice>}
      {params.get("connected") && <Notice tone="success">Shopify connected. Run the test below to confirm.</Notice>}

      <ol className="space-y-5">
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

        <Step n={2} title="Checkout address" done>
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

        <Step n={3} title="Test payments" done={store.payuReady}>
          <p className="text-sm text-ink-soft">{store.payuReady ? `PayU is in ${store.payuMode} mode.` : "Add your PayU key and salt in Settings."} Place one online and one COD test order before going live.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Form method="post"><SubmitButton intent="testPayu" className="btn-secondary" busyText="Testing" disabled={!store.payuReady}>Test PayU</SubmitButton></Form>
            <Form method="post"><SubmitButton intent="testMeta" className="btn-secondary" busyText="Testing" disabled={!store.metaReady}>Test Meta ads</SubmitButton></Form>
          </div>
          {result("testPayu")}
          {result("testMeta")}
        </Step>

        <Step n={4} title="Connect PayU webhooks" done={Boolean(lastHook)}>
          <p className="text-sm text-ink-soft">
            Webhooks let PayU tell us about a payment even if the customer closes the browser before coming back, and about refunds.
            We always re-check each event with PayU before changing an order.
          </p>
          <div className="mt-3"><CopyField label="Webhook URL" value={`${checkoutBase}/payu/webhook`} /></div>
          <ol className="mt-3 list-decimal space-y-1 pl-5 text-sm text-ink-soft">
            <li>PayU dashboard → Developers (or Settings) → Webhooks.</li>
            <li>Add this URL for <b className="text-ink">Payment success</b>, <b className="text-ink">Payment failure</b> and <b className="text-ink">Refund</b>.</li>
            <li>Save, then place a test order. The status below updates when the first webhook arrives.</li>
          </ol>
          <p className="mt-3 text-xs text-ink-faint">If you can't find Webhooks in your dashboard, ask PayU support to set this URL for your merchant key.</p>
          <p className="mt-2 text-sm">{lastHook
            ? <>Last webhook received {new Date(lastHook.at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" })} ({lastHook.kind}{lastHook.status ? `, ${lastHook.status}` : ""}).</>
            : <span className="text-ink-faint">No webhook received yet.</span>}</p>
        </Step>

        <Step n={5} title="Add the checkout to your theme">
          <p className="text-sm text-ink-soft">Shopify admin → Online Store → Themes → <b>Duplicate</b> your theme → Edit code → <code>layout/theme.liquid</code>. Paste this just before <code>&lt;/body&gt;</code>, then preview the copy before publishing.</p>
          <div className="mt-3"><CopyField label="Theme script" value={snippet} /></div>
          <p className="mt-3 text-xs text-ink-faint">The cart's Checkout button and Buy it now open this checkout automatically. For a custom button, add the <code>data-cx-checkout</code> attribute or call <code>Growpefy.go()</code>.</p>
        </Step>
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
