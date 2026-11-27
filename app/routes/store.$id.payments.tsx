// Settings → Payments: connect payment gateways with their API keys, and turn payment methods on or off.
// Discounts and fees per method live in Payment offers & fees (Smart Checkout).
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Form, Link, useActionData, useLoaderData, useNavigation } from "@remix-run/react";
import { and, asc, eq, ne } from "drizzle-orm";
import { useState } from "react";
import { GatewaysEditor } from "~/components/GatewaysEditor";
import { Icon } from "~/components/Icons";
import { Card } from "~/components/settings-ui";
import { SmartNote } from "~/components/SmartLock";
import { Notice, SubmitButton } from "~/components/ui";
import { db, stores } from "~/db.server";
import { kycGate, requireStore, requireViewer } from "~/lib/auth.server";
import { GATEWAYS } from "~/lib/gateways/catalog";
import { onlineReady, ownSiteHost, payViaBase } from "~/lib/gateways/index.server";
import { METHOD_LABEL, resolvePaymentMethods, type PayMethod } from "~/lib/payment-methods";
import { storePath } from "~/lib/store-code";
import { parseGateways } from "~/lib/store-form.server";
import { storeForClient } from "~/lib/store-view.server";
import { clearTokenCache } from "~/lib/platform.server";
import { forgetProxyCheck } from "~/lib/proxy-checkout.server";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const store = await requireStore(await requireViewer(request), params.id);
  const view = storeForClient(store);
  const pm = resolvePaymentMethods(store.paymentMethods, store);
  // Other stores of the same owner whose website can take this store's payments
  // (website on Growpefy with a live domain, or a Shopify website with App Proxy)
  const viaChoices = (store.ownerId
    ? await db.select().from(stores).where(and(eq(stores.ownerId, store.ownerId), ne(stores.id, store.id))).orderBy(asc(stores.id))
    : []).map((c) => ({ id: c.id, name: c.name, base: payViaBase(c) })).filter((c): c is { id: number; name: string; base: string } => Boolean(c.base));
  return json({
    payViaStoreId: store.payViaStoreId, viaChoices: viaChoices.map((c) => ({ id: c.id, name: c.name, site: c.base.replace(/^https?:\/\//, "").replace(/\/+$/, "") })),
    storeId: store.id, smart: store.smartCheckout, online: onlineReady(store), platform: store.platform,
    storefrontUrl: store.storefrontUrl, payuViaStorefront: store.payuViaStorefront, ownSite: ownSiteHost(store),
    gateways: view.gatewayViews, webhookBase: view.webhookBase,
    methods: { prepaid: pm.prepaid.on, cod: pm.cod.on, partial: pm.partial.on },
    supported: GATEWAYS.map((g) => g.name),
  });
}

export async function action({ request, params }: ActionFunctionArgs) {
  const viewer = await requireViewer(request);
  const store = await requireStore(viewer, params.id);
  const fd = await request.formData();
  const intent = String(fd.get("intent") ?? "");

  if (intent === "gateways") {
    const g = parseGateways(fd, store);
    const before = new Set((store.gateways ?? []).map((x) => x.id));
    const gate = g.gateways.some((x) => !before.has(x.id)) ? kycGate(viewer, "adding a payment gateway") : null;
    if (gate) return json({ ok: null, error: gate, kyc: true, errors: g.errors }, { status: 400 });
    if (Object.keys(g.errors).length) return json({ ok: null, error: "Fix the highlighted gateway and save again.", kyc: false, errors: g.errors }, { status: 400 });
    // "Take payments through another store's website": only a Shopify store of the same owner
    const viaRaw = Number(fd.get("payViaStoreId") ?? 0);
    let payViaStoreId: number | null = null;
    if (viaRaw && viaRaw !== store.id && store.ownerId) {
      const [via] = await db.select().from(stores).where(and(eq(stores.id, viaRaw), eq(stores.ownerId, store.ownerId))).limit(1);
      if (!via || !payViaBase(via)) return json({ ok: null, error: "That store can't take this store's payments.", kyc: false, errors: {} as Record<string, string> }, { status: 400 });
      payViaStoreId = via.id;
    }
    await db.update(stores).set({
      payViaStoreId,
      gateways: g.gateways, payuKey: g.payuKey, payuSalt: g.payuSalt, payuMode: g.payuMode,
      ...(store.platform === "shopify" ? { payuViaStorefront: fd.get("payuViaStorefront") === "on" } : {}),
    }).where(eq(stores.id, store.id));
    clearTokenCache(store.id);
    forgetProxyCheck(store.id);
    return json({ ok: "Payment gateways saved", error: null, kyc: false, errors: {} as Record<string, string> });
  }

  if (intent === "methods") {
    const pm = resolvePaymentMethods(store.paymentMethods, store);
    const want = { prepaid: fd.get("prepaid") === "on", cod: fd.get("cod") === "on", partial: store.smartCheckout && fd.get("partial") === "on" };
    if (!want.prepaid && !want.cod) return json({ ok: null, error: "Keep at least one payment method on.", kyc: false, errors: {} }, { status: 400 });
    if ((want.prepaid || want.partial) && !onlineReady(store)) {
      return json({ ok: null, error: "Connect a payment gateway above first. Prepaid and Partial COD need one.", kyc: false, errors: {} }, { status: 400 });
    }
    const all = { ...pm, prepaid: { ...pm.prepaid, on: want.prepaid }, cod: { ...pm.cod, on: want.cod }, partial: { ...pm.partial, on: want.partial } };
    await db.update(stores).set({ paymentMethods: all, codEnabled: want.cod }).where(eq(stores.id, store.id));
    return json({ ok: "Payment methods saved", error: null, kyc: false, errors: {} });
  }
  return json({ ok: null, error: "Unknown action", kyc: false, errors: {} }, { status: 400 });
}

const METHODS: { id: PayMethod; icon: "rupee" | "box" | "wallet"; text: string }[] = [
  { id: "prepaid", icon: "rupee", text: "UPI, cards, net banking and wallets through your gateway." },
  { id: "cod", icon: "box", text: "Customer pays in cash when the order arrives." },
  { id: "partial", icon: "wallet", text: "A small advance online now, the rest in cash on delivery." },
];

export default function Payments() {
  const d = useLoaderData<typeof loader>();
  const a = useActionData<typeof action>();
  const nav = useNavigation();
  const busy = (i: string) => nav.state !== "idle" && nav.formData?.get("intent") === i;
  const [on, setOn] = useState(d.methods);
  const changed = on.prepaid !== d.methods.prepaid || on.cod !== d.methods.cod || on.partial !== d.methods.partial;
  const base = storePath(d.storeId);

  return (
    <div className="max-w-3xl space-y-4">
      {a?.ok && <Notice tone="success">{a.ok}</Notice>}
      {a?.error && <Notice tone="error">{a.error}{a.kyc && <> <a href="/onboarding" className="font-semibold underline">Complete KYC</a></>}</Notice>}

      <Card title="Payment gateways" description={`Connect your own gateway account with its API keys. Money goes straight to your bank. Add up to 3: if the first one has a problem, the next takes over. Supported: ${d.supported.join(", ")}.`}
        action={<span className={`shrink-0 whitespace-nowrap rounded-md px-1.5 py-px text-[11.5px] font-medium ${d.online ? "bg-[#cdfee1] text-[#0c5132]" : "bg-[#fff1e3] text-[#5e4200]"}`}>{d.online ? "Taking online payments" : "Not connected"}</span>}>
        <Form method="post" className="space-y-3">
          <GatewaysEditor initial={d.gateways} errors={(a?.errors ?? {}) as Record<string, string>} webhookBase={d.webhookBase} />
          {d.ownSite ? (
            <p className="flex items-start gap-2 rounded-lg bg-[#f1f8f5] px-3 py-2.5 text-[12.5px] text-ink-soft shadow-[inset_0_0_0_1px_#d5ebe1]">
              <Icon name="globe" className="mt-0.5 h-3.5 w-3.5 shrink-0 text-pine" />
              <span>Payments start from <b className="font-medium text-ink">{d.ownSite}</b>. In your gateway account, the registered website should be <b className="font-medium text-ink">https://{d.ownSite}</b>.</span>
            </p>
          ) : d.platform === "shopify" && (
            <label className="flex cursor-pointer items-start gap-2.5 rounded-lg px-3 py-2.5 shadow-[inset_0_0_0_1px_#ebebeb]">
              <input type="checkbox" name="payuViaStorefront" defaultChecked={d.payuViaStorefront} className="mt-0.5 h-4 w-4" />
              <span className="text-[13px]"><b className="font-medium">Start payments from your own website</b>
                <span className="block text-[12px] text-ink-faint">For gateways that only accept your registered website (PayU, Cashfree, CCAvenue). Payments start from {d.storefrontUrl.replace(/^https?:\/\//, "")}/apps/growpefy/…</span></span>
            </label>
          )}
          {d.viaChoices.length > 0 && <PayVia d={d} />}
          <div className="flex justify-end"><SubmitButton intent="gateways" className="btn-primary btn" busyText="Saving">Save gateways</SubmitButton></div>
        </Form>
      </Card>

      <Card title="Payment methods" description="What customers can choose at checkout." flush>
        <Form method="post">
          <input type="hidden" name="intent" value="methods" />
          <ul className="divide-y divide-rule border-t border-rule">
            {METHODS.map((m) => {
              const locked = m.id === "partial" && !d.smart;
              const needsGateway = m.id !== "cod" && !d.online;
              return (
                <li key={m.id} className={`flex items-center gap-3 px-4 py-3 ${locked ? "opacity-60" : ""}`}>
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#f1f1f1] text-ink-soft"><Icon name={m.icon} className="h-4 w-4" /></span>
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px] font-medium">{METHOD_LABEL[m.id]}</p>
                    <p className="text-[12px] text-ink-soft">{m.text}{needsGateway && !locked ? " Needs a gateway." : ""}</p>
                  </div>
                  <label className="relative inline-flex cursor-pointer items-center">
                    <input type="checkbox" name={m.id} checked={on[m.id]} disabled={locked} onChange={(e) => setOn((x) => ({ ...x, [m.id]: e.target.checked }))} className="peer sr-only" aria-label={METHOD_LABEL[m.id]} />
                    <span className="h-5 w-9 rounded-full bg-[#d4d4d4] transition peer-checked:bg-[#303030] peer-disabled:cursor-not-allowed" />
                    <span className="absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white shadow transition peer-checked:translate-x-4" />
                  </label>
                </li>
              );
            })}
          </ul>
          {!d.smart && <div className="border-t border-rule px-4 py-3"><SmartNote storeId={d.storeId}>Partial COD, a prepaid discount or a COD fee need Smart Checkout.</SmartNote></div>}
          <div className="flex items-center justify-between gap-3 border-t border-rule px-4 py-3">
            {d.smart
              ? <Link to={`${base}/payment-rules`} className="text-[12.5px] font-medium text-[#005bd3] hover:underline">Discounts, fees and rules for each method</Link>
              : <span className="text-[12px] text-ink-faint">Standard checkout: every method costs the customer the same.</span>}
            <button className="btn-primary btn" disabled={!changed || busy("methods")}>{busy("methods") ? "Saving" : "Save"}</button>
          </div>
        </Form>
      </Card>
    </div>
  );
}

/** Take this store's online payments through another store's website, e.g. to test with that store's PayU account. */
function PayVia({ d }: { d: { payViaStoreId: number | null; viaChoices: { id: number; name: string; site: string }[] } }) {
  const [via, setVia] = useState(String(d.payViaStoreId ?? ""));
  const pick = d.viaChoices.find((c) => String(c.id) === via);
  return (
    <div className={`rounded-lg px-3 py-2.5 ${pick ? "bg-[#fff8eb] shadow-[inset_0_0_0_1px_#f3dfb5]" : "shadow-[inset_0_0_0_1px_#ebebeb]"}`}>
      <label className="block text-[13px]"><b className="font-medium">Take payments through another store's website</b>
        <span className="block text-[12px] text-ink-faint">For using another of your stores' gateway account (for example while testing). The payment page and the gateway's return URL (PayU surl / furl) use that store's domain. Orders stay in this store.</span>
        <select name="payViaStoreId" value={via} onChange={(e) => setVia(e.target.value)} className="input mt-2 max-w-sm py-1.5 text-[13px]">
          <option value="">Off: this store's own website</option>
          {d.viaChoices.map((c) => <option key={c.id} value={c.id}>{c.name} · {c.site}</option>)}
        </select>
      </label>
      {pick && (
        <p className="mt-2 text-[12px] leading-relaxed text-ink-soft">
          Payments will start at <b className="font-medium text-ink">{pick.site}/pay/…</b> and PayU returns to <b className="font-medium text-ink">{pick.site}/pg/payu/return</b>.
          {pick.site.includes("/apps/") && <>{pick.name}'s Shopify app needs App Proxy (<a href={`https://${pick.site}/ping`} target="_blank" rel="noreferrer" className="font-medium text-pine underline">test it</a>). </>}The gateway keys above must be the account registered for {pick.site.split("/")[0]}.
        </p>
      )}
    </div>
  );
}
