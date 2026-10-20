import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import crypto from "node:crypto";
import { json } from "@remix-run/node";
import { Form, Link, useActionData, useLoaderData } from "@remix-run/react";
import { asc, eq } from "drizzle-orm";
import { useState } from "react";
import { Icon, type IconName } from "~/components/Icons";
import { RangePicker } from "~/components/Overview";
import { Notice, PageHeader, SubmitButton } from "~/components/ui";
import { db, platformSettings, stores, users, wallets } from "~/db.server";
import { requireAdmin } from "~/lib/auth.server";
import { addDays, resolveRange } from "~/lib/dates";
import { INDIAN_STATES } from "~/lib/states";
import { TX_LABELS, mergeRates, rupees, type TxType } from "~/lib/wallet";
import { getPlatform, platformPayu, rechargeSummary, stateOf, usageSummary, walletsFor } from "~/lib/wallet.server";
import { testPayu } from "~/lib/payu.server";
import { messaging, otpMode } from "~/lib/rto.server";

export async function loader({ request }: LoaderFunctionArgs) {
  await requireAdmin(request);
  const sp = new URLSearchParams(new URL(request.url).searchParams);
  if (!sp.get("range")) sp.set("range", "this_month");
  const range = resolveRange(sp);
  const from = new Date(`${range.since}T00:00:00+05:30`);
  const to = new Date(`${addDays(range.until, 1)}T00:00:00+05:30`);

  const allStores = await db.select({ id: stores.id, name: stores.name, ownerId: stores.ownerId, logoUrl: stores.logoUrl }).from(stores).orderBy(asc(stores.name));
  const [ws, owners, p] = await Promise.all([walletsFor(allStores.map((s) => s.id)), db.select({ id: users.id, name: users.name }).from(users), getPlatform()]);
  const ids = ws.map((w) => w.id);
  const [usage, recharges] = await Promise.all([usageSummary(ids, from, to), rechargeSummary(null, from, to)]);
  const perWallet = await Promise.all(ws.map(async (w) => ({ id: w.id, usage: await usageSummary([w.id], from, to) })));
  const ownerName = new Map(owners.map((o) => [o.id, o.name]));
  const creds = platformPayu(p);
  const m = await messaging();

  return json({
    range,
    rows: allStores.map((s) => {
      const w = ws.find((x) => x.storeId === s.id)!;
      const u = perWallet.find((x) => x.id === w.id)?.usage ?? [];
      const spent = -u.filter((x) => ["sale_fee", "otp", "wa_confirm", "wa_tracking", "wa_promo", "refund_reversal"].includes(x.type)).reduce((n, x) => n + x.amount, 0);
      return { storeId: s.id, name: s.name, logoUrl: s.logoUrl, owner: s.ownerId ? ownerName.get(s.ownerId) ?? null : null, balance: w.balancePaise, state: stateOf(w), status: w.status, special: Boolean(w.rates), spent };
    }).sort((a, b) => a.balance - b.balance),
    usage, recharges,
    settings: {
      rates: mergeRates(p.rates), minRecharge: p.minRechargePaise, negativeLimit: p.defaultNegativeLimitPaise, lowAlert: p.defaultLowAlertPaise,
      billing: p.billing ?? {}, payuKey: p.payuKey ?? "", hasSalt: Boolean(p.payuSalt), payuMode: p.payuMode,
      msg: {
        msg91TemplateId: p.messaging?.msg91TemplateId ?? "", hasMsg91Key: Boolean(p.messaging?.msg91AuthKey),
        msg91WidgetId: p.messaging?.msg91WidgetId ?? "", msg91TokenAuth: p.messaging?.msg91TokenAuth ?? "", msg91OtpLength: p.messaging?.msg91OtpLength === 6 ? 6 : 4,
        otpMode: otpMode(m), otpReady: otpMode(m) !== null,
        otpTest: m.msg91AuthKey === "test" || (otpMode(m) === "widget" && m.msg91WidgetId === "test"),
        waPhoneNumberId: p.messaging?.waPhoneNumberId ?? "", hasWaToken: Boolean(p.messaging?.waToken),
        waTemplate: p.messaging?.waTemplate ?? "", waLang: p.messaging?.waLang ?? "en",
        waButtons: Boolean(p.messaging?.waButtons), waVerifyToken: p.messaging?.waVerifyToken ?? "", hasWaAppSecret: Boolean(p.messaging?.waAppSecret),
        webhookUrl: `${(process.env.APP_URL ?? "").replace(/\/+$/, "")}/webhooks/whatsapp`,
      },
      payuFromEnv: !p.payuKey && Boolean(process.env.PLATFORM_PAYU_KEY), payuReady: Boolean(creds.payuKey && creds.payuSalt),
    },
    appUrl: (process.env.APP_URL ?? "").replace(/\/+$/, ""),
  });
}

const money = (v: FormDataEntryValue | null) => Math.round(Number(String(v ?? "").replace(/[^\d.]/g, "")) * 100);

export async function action({ request }: ActionFunctionArgs) {
  await requireAdmin(request);
  const fd = await request.formData();
  const s = (k: string) => String(fd.get(k) ?? "").trim();
  const intent = s("intent");
  const p = await getPlatform();
  if (intent === "rates") {
    const r = {
      saleFeeBps: Math.round(Number(s("saleFeePct")) * 100), otp: money(fd.get("otp")), waConfirm: money(fd.get("waConfirm")),
      waTracking: money(fd.get("waTracking")), waPromo: money(fd.get("waPromo")),
    };
    if (Object.values(r).some((v) => !Number.isFinite(v) || v < 0)) return json({ ok: null, error: "Rates must be 0 or more" }, { status: 400 });
    const min = money(fd.get("minRecharge"));
    if (!min || min < 100_00) return json({ ok: null, error: "Minimum recharge must be at least ₹100" }, { status: 400 });
    await db.update(platformSettings).set({
      rates: r, minRechargePaise: min, defaultNegativeLimitPaise: money(fd.get("negativeLimit")) || 0, defaultLowAlertPaise: money(fd.get("lowAlert")) || 0, updatedAt: new Date(),
    }).where(eq(platformSettings.id, 1));
    if (fd.get("applyLimits") === "on") await db.update(wallets).set({ negativeLimitPaise: money(fd.get("negativeLimit")) || 0, lowAlertPaise: money(fd.get("lowAlert")) || 0 });
    return json({ ok: "Default rate card saved. Stores with special rates keep their own.", error: null });
  }
  if (intent === "billing") {
    const gstin = s("gstin").toUpperCase();
    if (gstin && !/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(gstin)) return json({ ok: null, error: "GSTIN doesn't look right" }, { status: 400 });
    await db.update(platformSettings).set({
      billing: { name: s("name"), gstin, address: s("address"), state: s("state"), email: s("email"), phone: s("phone"), sac: s("sac") || "998314", invoicePrefix: s("invoicePrefix").replace(/[^A-Za-z0-9-]/g, "").slice(0, 10) || "GP" },
      updatedAt: new Date(),
    }).where(eq(platformSettings.id, 1));
    return json({ ok: "Invoice details saved", error: null });
  }
  if (intent === "payu") {
    await db.update(platformSettings).set({
      payuKey: s("payuKey") || null, payuSalt: s("payuSalt") || p.payuSalt, payuMode: s("payuMode") === "live" ? "live" : "test", updatedAt: new Date(),
    }).where(eq(platformSettings.id, 1));
    return json({ ok: "PayU account saved", error: null });
  }
  if (intent === "messaging") {
    const m = p.messaging ?? {};
    await db.update(platformSettings).set({
      messaging: {
        msg91AuthKey: s("msg91AuthKey") || m.msg91AuthKey, msg91TemplateId: s("msg91TemplateId"),
        msg91WidgetId: s("msg91WidgetId"), msg91TokenAuth: s("msg91TokenAuth"), msg91OtpLength: s("msg91OtpLength") === "6" ? 6 : 4,
        waPhoneNumberId: s("waPhoneNumberId").replace(/\D/g, ""), waToken: s("waToken") || m.waToken, waTemplate: s("waTemplate"), waLang: s("waLang") || "en",
        waButtons: fd.get("waButtons") === "on",
        waVerifyToken: s("waVerifyToken") || m.waVerifyToken || crypto.randomBytes(16).toString("hex"),
        waAppSecret: s("waAppSecret") || m.waAppSecret,
      },
      updatedAt: new Date(),
    }).where(eq(platformSettings.id, 1));
    return json({ ok: "Messaging settings saved", error: null });
  }
  if (intent === "testPayu") {
    try { return json({ ok: await testPayu(platformPayu(await getPlatform())), error: null }); }
    catch (e) { return json({ ok: null, error: e instanceof Error ? e.message : "PayU test failed" }); }
  }
  return json({ ok: null, error: "Unknown action" }, { status: 400 });
}

const STATE_CHIP = {
  ok: "bg-emerald-50 text-good", low: "bg-amber-50 text-amber-800", negative: "bg-orange-50 text-orange-800", locked: "bg-red-50 text-bad",
} as const;
const STATE_LABEL = { ok: "Healthy", low: "Low", negative: "Below ₹0", locked: "Limit crossed" } as const;

export default function Wallets() {
  const d = useLoaderData<typeof loader>();
  const res = useActionData<typeof action>();
  const totalBalance = d.rows.reduce((n, r) => n + r.balance, 0);
  const attention = d.rows.filter((r) => r.state !== "ok").length;
  const usageTotal = -d.usage.filter((u) => ["sale_fee", "otp", "wa_confirm", "wa_tracking", "wa_promo", "refund_reversal"].includes(u.type)).reduce((n, u) => n + u.amount, 0);

  return (
    <>
      <PageHeader title="All wallets" description="Balances, recharges and platform earnings across every store." actions={<RangePicker current={d.range} align="right" />} />
      <div className="space-y-5">
        {res?.ok && <Notice tone="success">{res.ok}</Notice>}
        {res?.error && <Notice tone="error">{res.error}</Notice>}
        {!d.settings.payuReady && <Notice tone="warning">Stores can't recharge online yet. Add your PayU account in Settings below.</Notice>}

        <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
          <Kpi icon="wallet" tint="bg-emerald-50 text-emerald-700" label="Recharges (net, excl. GST)" value={rupees(d.recharges.credit, 0)} sub={`${d.recharges.count} recharges · ${rupees(d.recharges.total, 0)} collected`} />
          <Kpi icon="rupee" tint="bg-sky-50 text-sky-700" label="GST collected" value={rupees(d.recharges.gst, 0)} sub="Pay to the government" />
          <Kpi icon="trend" tint="bg-violet-50 text-violet-700" label="Usage earned" value={rupees(usageTotal, 0)} sub="Sale fees + messages" />
          <Kpi icon="stores" tint="bg-amber-50 text-amber-700" label="Wallet balances" value={rupees(totalBalance, 0)} sub={`${attention} store${attention === 1 ? "" : "s"} need attention`} />
        </div>

        <section className="panel">
          <h2 className="border-b border-rule px-5 py-4 text-[15px] font-semibold">Usage by type</h2>
          <dl className="grid grid-cols-2 gap-px bg-rule sm:grid-cols-3 lg:grid-cols-6">
            {(["sale_fee", "otp", "wa_confirm", "wa_tracking", "wa_promo", "refund_reversal"] as TxType[]).map((t) => {
              const u = d.usage.find((x) => x.type === t) ?? { count: 0, amount: 0 };
              return (
                <div key={t} className="bg-surface px-4 py-3.5">
                  <dt className="text-xs text-ink-soft">{TX_LABELS[t]}</dt>
                  <dd className="num mt-1 font-semibold">{rupees(Math.abs(u.amount), 0)}</dd>
                  <dd className="num text-xs text-ink-faint">{u.count.toLocaleString("en-IN")}</dd>
                </div>
              );
            })}
          </dl>
        </section>

        <section className="panel">
          <h2 className="border-b border-rule px-5 py-4 text-[15px] font-semibold">Stores</h2>
          <div className="overflow-x-auto">
            <table className="table min-w-[720px]">
              <thead><tr><th>Store</th><th>Owner</th><th>Status</th><th className="text-right">Used in period</th><th className="text-right">Balance</th><th /></tr></thead>
              <tbody>
                {d.rows.map((r) => (
                  <tr key={r.storeId}>
                    <td>
                      <div className="flex items-center gap-2.5">
                        <span className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-rule bg-surface text-xs font-semibold">{r.logoUrl ? <img src={r.logoUrl} alt="" className="h-full w-full object-contain p-0.5" /> : r.name.slice(0, 1)}</span>
                        <span className="font-medium">{r.name}</span>
                        {r.special && <span className="rounded bg-violet-50 px-1.5 py-px text-[10px] font-semibold text-violet-700">Special rates</span>}
                      </div>
                    </td>
                    <td className="text-sm text-ink-soft">{r.owner ?? "You"}</td>
                    <td>
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATE_CHIP[r.state]}`}>{STATE_LABEL[r.state]}</span>
                      {r.status === "suspended" && <span className="ml-1 rounded-full bg-red-50 px-2 py-0.5 text-xs font-medium text-bad">Suspended</span>}
                    </td>
                    <td className="num text-right text-sm">{rupees(r.spent)}</td>
                    <td className={`num text-right font-semibold ${r.balance < 0 ? "text-bad" : ""}`}>{rupees(r.balance)}</td>
                    <td className="text-right"><Link to={`/dashboard/stores/${r.storeId}/wallet`} className="btn-quiet text-xs">Manage</Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <Settings d={d} />
      </div>
    </>
  );
}

function Kpi({ icon, tint, label, value, sub }: { icon: IconName; tint: string; label: string; value: string; sub: string }) {
  return (
    <div className="panel min-w-0 p-4">
      <div className="flex items-center gap-2.5"><span className={`flex h-8 w-8 items-center justify-center rounded-lg ${tint}`}><Icon name={icon} className="h-4 w-4" /></span><p className="truncate text-xs font-medium text-ink-soft">{label}</p></div>
      <p className="num mt-3 text-xl font-semibold">{value}</p>
      <p className="mt-1 truncate text-xs text-ink-faint">{sub}</p>
    </div>
  );
}

function Settings({ d }: { d: ReturnType<typeof useLoaderData<typeof loader>> }) {
  const [tab, setTab] = useState<"rates" | "billing" | "payu" | "messaging">("rates");
  const s = d.settings;
  const b = s.billing;
  return (
    <section className="panel">
      <div className="flex flex-wrap items-center gap-2 border-b border-rule px-5 py-3">
        <h2 className="mr-auto text-[15px] font-semibold">Settings</h2>
        <div className="inline-flex rounded-lg border border-rule-strong bg-surface p-0.5" role="tablist">
          {[["rates", "Rate card"], ["billing", "Invoice details"], ["payu", "PayU account"], ["messaging", "Messaging"]].map(([k, l]) => (
            <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k as typeof tab)}
              className={`rounded-md px-3 py-1.5 text-sm ${tab === k ? "bg-ink font-medium text-white" : "text-ink-soft hover:text-ink"}`}>{l}</button>
          ))}
        </div>
      </div>

      {tab === "rates" && (
        <Form method="post" className="space-y-5 p-5">
          <p className="text-sm text-ink-soft">Default for every store. Give a store special rates from its wallet page.</p>
          <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-5">
            <Field label="Sale fee (%)" name="saleFeePct" value={s.rates.saleFeeBps / 100} />
            <Field label="OTP (₹)" name="otp" value={s.rates.otp / 100} />
            <Field label="WA confirmation (₹)" name="waConfirm" value={s.rates.waConfirm / 100} />
            <Field label="WA tracking (₹)" name="waTracking" value={s.rates.waTracking / 100} />
            <Field label="WA promotional (₹)" name="waPromo" value={s.rates.waPromo / 100} />
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Minimum recharge (₹, before GST)" name="minRecharge" value={s.minRecharge / 100} />
            <Field label="Default negative limit (₹)" name="negativeLimit" value={s.negativeLimit / 100} hint="Wallet can go down to minus this" />
            <Field label="Default low balance alert (₹)" name="lowAlert" value={s.lowAlert / 100} />
          </div>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="applyLimits" className="h-4 w-4 accent-[rgb(var(--brand))]" />Also apply these limits to all existing wallets</label>
          <SubmitButton intent="rates" busyText="Saving">Save rate card</SubmitButton>
        </Form>
      )}

      {tab === "billing" && (
        <Form method="post" className="grid gap-4 p-5 sm:grid-cols-2">
          <p className="text-sm text-ink-soft sm:col-span-2">Shown on every recharge invoice. Your state decides CGST + SGST (same state) or IGST (other state).</p>
          <Field label="Business / legal name" name="name" value={b.name ?? ""} />
          <Field label="GSTIN" name="gstin" value={b.gstin ?? ""} />
          <Field label="Address" name="address" value={b.address ?? ""} wide />
          <label className="block"><span className="label">State</span>
            <select name="state" defaultValue={b.state ?? ""} className="input"><option value="">Select state</option>{INDIAN_STATES.map((x) => <option key={x.code} value={x.name}>{x.name}</option>)}</select></label>
          <Field label="SAC code" name="sac" value={b.sac ?? "998314"} hint="998314 = IT infrastructure / hosting services. Confirm with your CA." />
          <Field label="Email" name="email" value={b.email ?? ""} />
          <Field label="Phone" name="phone" value={b.phone ?? ""} />
          <Field label="Invoice prefix" name="invoicePrefix" value={b.invoicePrefix ?? "GP"} hint="Invoices look like GP/26-27/00001" />
          <div className="flex items-end sm:col-span-2"><SubmitButton intent="billing" busyText="Saving">Save invoice details</SubmitButton></div>
        </Form>
      )}

      {tab === "payu" && (
        <div className="space-y-4 p-5">
          <p className="text-sm text-ink-soft">Your own PayU merchant account. Store owners pay their recharges here (not to their store's PayU).</p>
          {s.payuFromEnv && <Notice>Using PLATFORM_PAYU_KEY / PLATFORM_PAYU_SALT from Railway variables. Saving here overrides them.</Notice>}
          <Form method="post" className="grid gap-4 sm:grid-cols-3">
            <Field label="Merchant key" name="payuKey" value={s.payuKey} />
            <label className="block"><span className="label">Salt</span><input name="payuSalt" type="password" autoComplete="new-password" className="input" placeholder={s.hasSalt ? "Saved. Leave blank to keep it." : ""} /></label>
            <label className="block"><span className="label">Mode</span>
              <select name="payuMode" defaultValue={s.payuMode} className="input"><option value="test">Test</option><option value="live">Live</option></select></label>
            <div className="flex flex-wrap gap-2 sm:col-span-3">
              <SubmitButton intent="payu" busyText="Saving">Save PayU account</SubmitButton>
              <SubmitButton intent="testPayu" className="btn-secondary" busyText="Testing" disabled={!s.payuReady}>Test connection</SubmitButton>
            </div>
          </Form>
          <div className="rounded-lg border border-rule bg-paper p-4 text-sm">
            <p className="font-medium">In your PayU dashboard</p>
            <ul className="mt-1 list-disc space-y-1 pl-5 text-ink-soft">
              <li>Website / return URL: <code className="text-ink">{d.appUrl}/wallet/payu/return</code></li>
              <li>Webhook (success + failure): <code className="text-ink">{d.appUrl}/wallet/payu/webhook</code></li>
            </ul>
          </div>
        </div>
      )}

      {tab === "messaging" && (
        <Form method="post" className="space-y-6 p-5">
          <p className="text-sm text-ink-soft">Your own accounts for OTP and WhatsApp. Stores turn the services on in RTO Suite and pay per message from their wallet.</p>
          <div>
            <h3 className="font-semibold">OTP (MSG91)</h3>
            {s.msg.otpTest ? (
              <div className="mt-2"><Notice tone="error">Test mode is on: every OTP is 123456 and no SMS is sent. Anyone could open a customer's saved address with it. Use only for testing, never on live stores.</Notice></div>
            ) : !s.msg.otpReady ? (
              <div className="mt-2"><Notice tone="warning">OTP is off until the Auth key and either the Widget ID + Token (no DLT) or a DLT Template ID are saved. Until then checkout OTP and <b>saved addresses across stores</b> don't show to customers (a saved address can only be used after an OTP).</Notice></div>
            ) : (
              <p className="mt-1 text-sm text-good">OTP is live via {s.msg.otpMode === "widget" ? "the MSG91 OTP Widget" : "your DLT template"}. Checkout OTP, phone login and saved addresses across all stores are on.</p>
            )}
            <div className="mt-3 grid gap-4 sm:grid-cols-2">
              <label className="block"><span className="label">Auth key</span><input name="msg91AuthKey" type="password" autoComplete="new-password" className="input" placeholder={s.msg.hasMsg91Key ? "Saved. Leave blank to keep it." : "From MSG91 → API"} />
                <span className="hint">Type <code>test</code> to try the flow without sending SMS (code is always 123456).</span></label>
              <Field label="OTP template ID (DLT approved)" name="msg91TemplateId" value={s.msg.msg91TemplateId} />
              <Field label="Widget ID (OTP Widget, no DLT needed)" name="msg91WidgetId" value={s.msg.msg91WidgetId} />
              <Field label="Widget token (Token Auth)" name="msg91TokenAuth" value={s.msg.msg91TokenAuth} />
              <label className="block"><span className="label">Widget OTP length</span>
                <select name="msg91OtpLength" defaultValue={String(s.msg.msg91OtpLength)} className="input"><option value="4">4 digits</option><option value="6">6 digits</option></select>
                <span className="hint">Must match "OTP Length" on the widget in MSG91.</span></label>
            </div>
            <p className="hint mt-2">No DLT yet? Fill Auth key + Widget ID + Widget token. Once your DLT template is approved, add the Template ID and it is used instead (store name can then go in the SMS).
              In MSG91 → OTP Widget, allow your domains (growpefy.com and the stores' checkout domains).</p>
          </div>
          <div>
            <h3 className="font-semibold">WhatsApp (Meta Cloud API)</h3>
            <div className="mt-3 grid gap-4 sm:grid-cols-2">
              <Field label="Phone number ID" name="waPhoneNumberId" value={s.msg.waPhoneNumberId} />
              <label className="block"><span className="label">Permanent access token</span><input name="waToken" type="password" autoComplete="new-password" className="input" placeholder={s.msg.hasWaToken ? "Saved. Leave blank to keep it." : "System user token with whatsapp_business_messaging"} /></label>
              <Field label="Order confirmation template name" name="waTemplate" value={s.msg.waTemplate} hint="Approved utility template with 5 body variables: name, store, order no., amount, payment" />
              <Field label="Template language code" name="waLang" value={s.msg.waLang} hint="e.g. en, en_US, hi" />
              <label className="flex cursor-pointer items-start gap-2.5 sm:col-span-2">
                <input type="checkbox" name="waButtons" defaultChecked={s.msg.waButtons} className="mt-0.5 h-4 w-4" />
                <span className="text-sm"><b>Template has Confirm / Cancel buttons</b><span className="block text-xs text-ink-faint">Quick-reply button 1 = Confirm order, button 2 = Cancel order. Replies mark the order and tag it in Shopify.</span></span>
              </label>
            </div>
            <div className="mt-4 rounded-lg border border-rule bg-paper p-4">
              <p className="text-sm font-medium">Webhook (for Confirm / Cancel replies)</p>
              <p className="mt-0.5 text-xs text-ink-faint">Meta app → WhatsApp → Configuration → Webhook: paste the Callback URL and Verify token, then subscribe to <b>messages</b>.</p>
              <div className="mt-3 grid gap-4 sm:grid-cols-2">
                <label className="block sm:col-span-2"><span className="label">Callback URL</span><input readOnly value={s.msg.webhookUrl} className="input num bg-surface" onFocus={(e) => e.currentTarget.select()} /></label>
                <Field label="Verify token" name="waVerifyToken" value={s.msg.waVerifyToken} hint={s.msg.waVerifyToken ? "Paste this in Meta" : "Leave blank and save: one is made for you"} />
                <label className="block"><span className="label">App secret</span><input name="waAppSecret" type="password" autoComplete="new-password" className="input" placeholder={s.msg.hasWaAppSecret ? "Saved. Leave blank to keep it." : "Meta app → App settings → Basic → App secret"} /><span className="hint">Needed to trust replies</span></label>
              </div>
            </div>
          </div>
          <SubmitButton intent="messaging" busyText="Saving">Save messaging settings</SubmitButton>
        </Form>
      )}
    </section>
  );
}

function Field({ label, name, value, hint, wide }: { label: string; name: string; value: string | number; hint?: string; wide?: boolean }) {
  return (
    <label className={`block ${wide ? "sm:col-span-2" : ""}`}>
      <span className="label">{label}</span>
      <input name={name} defaultValue={value} className="input num" />
      {hint && <span className="hint">{hint}</span>}
    </label>
  );
}
