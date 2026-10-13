import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Form, Link, useActionData, useLoaderData, useNavigation, useSearchParams } from "@remix-run/react";
import { and, asc, desc, eq, ne } from "drizzle-orm";
import { useState } from "react";
import { Check, F, StoreForm } from "~/components/StoreForm";
import { bankOffers, coupons, db, orders, stores } from "~/db.server";
import { requireAdmin } from "~/lib/auth.server";
import { couponProblem } from "~/lib/coupons.server";
import { env } from "~/lib/env.server";
import { pushToShopify } from "~/lib/orders.server";
import { formatINR } from "~/lib/pricing";
import { clearTokenCache, testConnection } from "~/lib/shopify.server";
import { parseStoreForm } from "~/lib/store-form.server";

const TABS = [
  { id: "settings", label: "Settings" },
  { id: "coupons", label: "Coupons" },
  { id: "offers", label: "Bank offers" },
  { id: "orders", label: "Orders" },
  { id: "install", label: "Install" },
] as const;

async function getStore(id: string | undefined) {
  const [store] = await db.select().from(stores).where(eq(stores.id, Number(id))).limit(1);
  if (!store) throw new Response("Store not found", { status: 404 });
  return store;
}

export async function loader({ request, params }: LoaderFunctionArgs) {
  await requireAdmin(request);
  const store = await getStore(params.id);
  const [couponRows, offerRows, orderRows] = await Promise.all([
    db.select().from(coupons).where(eq(coupons.storeId, store.id)).orderBy(desc(coupons.createdAt)),
    db.select().from(bankOffers).where(eq(bankOffers.storeId, store.id)).orderBy(asc(bankOffers.sort), asc(bankOffers.id)),
    db.select().from(orders).where(eq(orders.storeId, store.id)).orderBy(desc(orders.createdAt)).limit(100),
  ]);
  const { adminToken, clientSecret, payuSalt, ...safe } = store;
  return json({
    store: { ...safe, hasAdminToken: Boolean(adminToken), hasClientSecret: Boolean(clientSecret), hasPayuSalt: Boolean(payuSalt) },
    coupons: couponRows.map((c) => ({ ...c, problem: c.active ? couponProblem(c) : null })),
    offers: offerRows,
    orders: orderRows,
    appUrl: env.appUrl,
  });
}

export async function action({ request, params }: ActionFunctionArgs) {
  await requireAdmin(request);
  const store = await getStore(params.id);
  const fd = await request.formData();
  const s = (k: string) => String(fd.get(k) ?? "").trim();
  const int = (k: string) => (s(k) === "" ? null : Math.max(0, Math.round(Number(s(k)) || 0)));
  const id = Number(s("id"));

  switch (s("intent")) {
    case "saveStore": {
      const { data, errors } = parseStoreForm(fd, store);
      if (!errors.slug) {
        const [dupe] = await db.select({ id: stores.id }).from(stores)
          .where(and(eq(stores.slug, data.slug), ne(stores.id, store.id))).limit(1);
        if (dupe) errors.slug = "Ye slug already use ho raha hai";
      }
      if (Object.keys(errors).length) return json({ errors, ok: null }, { status: 400 });
      await db.update(stores).set(data).where(eq(stores.id, store.id));
      clearTokenCache(store.id);
      return json({ ok: "Settings saved ✓", errors: null });
    }
    case "testConnection": {
      try {
        const shop = await testConnection(store);
        return json({ ok: `Connected ✓ ${shop.name} (${shop.currencyCode})`, errors: null });
      } catch (e) {
        return json({ ok: null, errors: { form: e instanceof Error ? e.message : String(e) } });
      }
    }
    case "addCoupon": {
      const code = s("code").toUpperCase().replace(/\s+/g, "");
      const value = int("value");
      if (!code || !value) return json({ ok: null, errors: { coupon: "Code aur value dono chahiye" } }, { status: 400 });
      const [dupe] = await db.select({ id: coupons.id }).from(coupons)
        .where(and(eq(coupons.storeId, store.id), eq(coupons.code, code))).limit(1);
      if (dupe) return json({ ok: null, errors: { coupon: "Ye code already hai" } }, { status: 400 });
      await db.insert(coupons).values({
        storeId: store.id,
        code,
        description: s("description") || null,
        type: s("type") === "flat" ? "flat" : "percent",
        value,
        minCartRupees: int("minCartRupees") ?? 0,
        maxDiscountRupees: int("maxDiscountRupees"),
        stackable: fd.get("stackable") === "on",
        paymentRestriction: ["prepaid", "cod"].includes(s("paymentRestriction")) ? s("paymentRestriction") : "any",
        showInList: fd.get("showInList") === "on",
        usageLimit: int("usageLimit"),
        startsAt: s("startsAt") ? new Date(`${s("startsAt")}:00+05:30`) : null,
        endsAt: s("endsAt") ? new Date(`${s("endsAt")}:00+05:30`) : null,
      });
      return json({ ok: `Coupon ${code} added ✓`, errors: null });
    }
    case "toggleCoupon": {
      const [c] = await db.select().from(coupons).where(and(eq(coupons.id, id), eq(coupons.storeId, store.id)));
      if (c) await db.update(coupons).set({ active: !c.active }).where(eq(coupons.id, id));
      return json({ ok: null, errors: null });
    }
    case "deleteCoupon": {
      await db.delete(coupons).where(and(eq(coupons.id, id), eq(coupons.storeId, store.id)));
      return json({ ok: "Coupon deleted", errors: null });
    }
    case "addOffer": {
      const value = int("value");
      if (!s("bankName") || !s("title") || !value) {
        return json({ ok: null, errors: { offer: "Bank, title aur value chahiye" } }, { status: 400 });
      }
      await db.insert(bankOffers).values({
        storeId: store.id,
        bankName: s("bankName"),
        title: s("title"),
        type: s("type") === "flat" ? "flat" : "percent",
        value,
        maxDiscountRupees: int("maxDiscountRupees"),
        minCartRupees: int("minCartRupees") ?? 0,
        payuOfferKey: s("payuOfferKey") || null,
        sort: int("sort") ?? 0,
      });
      return json({ ok: "Bank offer added ✓", errors: null });
    }
    case "toggleOffer": {
      const [o] = await db.select().from(bankOffers).where(and(eq(bankOffers.id, id), eq(bankOffers.storeId, store.id)));
      if (o) await db.update(bankOffers).set({ active: !o.active }).where(eq(bankOffers.id, id));
      return json({ ok: null, errors: null });
    }
    case "deleteOffer": {
      await db.delete(bankOffers).where(and(eq(bankOffers.id, id), eq(bankOffers.storeId, store.id)));
      return json({ ok: "Offer deleted", errors: null });
    }
    case "retryOrder": {
      const [o] = await db.select().from(orders).where(and(eq(orders.id, s("orderId")), eq(orders.storeId, store.id)));
      if (!o || !["paid", "cod_placed"].includes(o.status)) return json({ ok: null, errors: { form: "Order retry nahi ho sakta" } });
      const r = await pushToShopify(store, o);
      return r.shopifyOrderId
        ? json({ ok: `Shopify order ${r.shopifyOrderName} created ✓`, errors: null })
        : json({ ok: null, errors: { form: r.error ?? "Failed" } });
    }
  }
  return json({ ok: null, errors: { form: "Unknown action" } }, { status: 400 });
}

// ======================= UI =======================

type Data = ReturnType<typeof useLoaderData<typeof loader>>;

export default function StoreDetail() {
  const data = useLoaderData<typeof loader>();
  const result = useActionData<typeof action>();
  const nav = useNavigation();
  const [params] = useSearchParams();
  const tab = TABS.some((t) => t.id === params.get("tab")) ? params.get("tab")! : "settings";
  const errors = (result?.errors ?? {}) as Record<string, string>;

  return (
    <div>
      <Link to="/admin" className="text-sm text-gray-500">← Stores</Link>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-bold">{data.store.name}</h1>
        <span className="text-xs text-gray-500">{data.store.shopDomain}</span>
      </div>

      <nav className="-mx-4 mt-4 flex gap-1 overflow-x-auto border-b border-gray-200 px-4">
        {TABS.map((t) => (
          <Link key={t.id} to={`?tab=${t.id}`} replace
            className={`whitespace-nowrap border-b-2 px-3 py-2.5 text-sm font-medium ${tab === t.id ? "border-gray-900 text-gray-900" : "border-transparent text-gray-500"}`}>
            {t.label}
          </Link>
        ))}
      </nav>

      <div className="mt-5 max-w-4xl space-y-4">
        {result?.ok && <p className="rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{result.ok}</p>}
        {errors.form && <p className="break-words rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{errors.form}</p>}

        {tab === "settings" && <StoreForm values={data.store} errors={errors} submitLabel="Save settings" busy={nav.state === "submitting"} />}
        {tab === "coupons" && <CouponsTab coupons={data.coupons} error={errors.coupon} />}
        {tab === "offers" && <OffersTab offers={data.offers} error={errors.offer} />}
        {tab === "orders" && <OrdersTab orders={data.orders} />}
        {tab === "install" && <InstallTab appUrl={data.appUrl} slug={data.store.slug} />}
      </div>
    </div>
  );
}

function RowAction({ intent, id, label, danger, confirm }: { intent: string; id: number; label: string; danger?: boolean; confirm?: string }) {
  return (
    <Form method="post" onSubmit={(e) => { if (confirm && !window.confirm(confirm)) e.preventDefault(); }}>
      <input type="hidden" name="intent" value={intent} />
      <input type="hidden" name="id" value={id} />
      <button className={`text-xs font-medium ${danger ? "text-red-600" : "text-gray-700"} hover:underline`}>{label}</button>
    </Form>
  );
}

function CouponsTab({ coupons, error }: { coupons: Data["coupons"]; error?: string }) {
  return (
    <>
      <Form method="post" className="card space-y-4" key={coupons.length}>
        <input type="hidden" name="intent" value="addCoupon" />
        <h2 className="font-semibold">New coupon</h2>
        <div className="grid gap-3 sm:grid-cols-3">
          <F label="Code" name="code" placeholder="EXTRA10" required className="input uppercase" />
          <label className="block">
            <span className="label">Type</span>
            <select name="type" className="input"><option value="percent">% off</option><option value="flat">₹ flat off</option></select>
          </label>
          <F label="Value (% ya ₹)" name="value" type="number" min={1} required />
          <F label="Min cart ₹" name="minCartRupees" type="number" min={0} placeholder="0" />
          <F label="Max discount ₹ (optional)" name="maxDiscountRupees" type="number" min={0} />
          <label className="block">
            <span className="label">Valid on</span>
            <select name="paymentRestriction" className="input">
              <option value="any">Prepaid + COD</option><option value="prepaid">Sirf prepaid</option><option value="cod">Sirf COD</option>
            </select>
          </label>
          <F label="Usage limit (blank = unlimited)" name="usageLimit" type="number" min={1} />
          <F label="Starts (IST)" name="startsAt" type="datetime-local" />
          <F label="Ends (IST)" name="endsAt" type="datetime-local" />
          <F label="Description (checkout pe dikhega)" name="description" placeholder="Extra 10% off on all orders" wrap="sm:col-span-3" />
        </div>
        <div className="flex flex-wrap gap-x-6">
          <Check name="stackable" label="Payment discount ke upar stack ho" defaultChecked />
          <Check name="showInList" label="Checkout pe list mein dikhao" defaultChecked />
        </div>
        <p className="text-xs text-gray-500">Stack off ho toh coupon payment discount ko tabhi replace karega jab coupon ki bachat zyada ho.</p>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button className="btn-primary">Add coupon</button>
      </Form>

      <div className="card overflow-x-auto p-0">
        <table className="w-full min-w-[640px] text-sm">
          <thead className="border-b border-gray-200 bg-gray-50 text-left text-xs text-gray-500">
            <tr><th className="p-3">Code</th><th className="p-3">Discount</th><th className="p-3">Rules</th><th className="p-3">Used</th><th className="p-3">Status</th><th className="p-3" /></tr>
          </thead>
          <tbody>
            {coupons.length === 0 && <tr><td colSpan={6} className="p-4 text-center text-gray-500">Abhi koi coupon nahi</td></tr>}
            {coupons.map((c) => (
              <tr key={c.id} className="border-b border-gray-100 last:border-0">
                <td className="p-3 font-semibold">{c.code}<p className="text-xs font-normal text-gray-500">{c.description}</p></td>
                <td className="p-3">{c.type === "percent" ? `${c.value}%` : `₹${c.value}`}{c.maxDiscountRupees != null && <span className="text-xs text-gray-500"> (max ₹{c.maxDiscountRupees})</span>}</td>
                <td className="p-3 text-xs text-gray-600">
                  {c.paymentRestriction === "any" ? "All" : c.paymentRestriction === "prepaid" ? "Prepaid" : "COD"}
                  {c.minCartRupees > 0 && ` · min ₹${c.minCartRupees}`} · {c.stackable ? "stack" : "no-stack"}{!c.showInList && " · hidden"}
                </td>
                <td className="p-3">{c.usedCount}{c.usageLimit != null && ` / ${c.usageLimit}`}</td>
                <td className="p-3">
                  <span className={`rounded-full px-2 py-0.5 text-xs ${c.active && !c.problem ? "bg-emerald-100 text-emerald-800" : "bg-gray-100 text-gray-600"}`}>
                    {!c.active ? "Off" : c.problem ? "Inactive" : "Live"}
                  </span>
                  {c.problem && <p className="mt-1 text-[11px] text-gray-500">{c.problem}</p>}
                </td>
                <td className="p-3">
                  <div className="flex gap-3">
                    <RowAction intent="toggleCoupon" id={c.id} label={c.active ? "Disable" : "Enable"} />
                    <RowAction intent="deleteCoupon" id={c.id} label="Delete" danger confirm={`${c.code} delete karein?`} />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function OffersTab({ offers, error }: { offers: Data["offers"]; error?: string }) {
  return (
    <>
      <div className="rounded-xl bg-amber-50 px-4 py-3 text-xs text-amber-900">
        Bank offer pehle <b>PayU dashboard → Offers</b> mein banao (bank/BIN rules wahi set hote hain), phir uski <b>offer key</b> yahan daalo.
        PayU card check karke discount khud lagata hai. Bina offer key ke offer sirf checkout pe dikhega, apply nahi hoga.
        Bank ka logo ya “in partnership with” tabhi use karo jab bank ke saath actual tie-up ho.
      </div>
      <Form method="post" className="card space-y-4" key={offers.length}>
        <input type="hidden" name="intent" value="addOffer" />
        <h2 className="font-semibold">New bank offer</h2>
        <div className="grid gap-3 sm:grid-cols-3">
          <F label="Bank" name="bankName" placeholder="Kotak" required />
          <F label="Title (checkout pe dikhega)" name="title" placeholder="Extra 10% off on Kotak credit cards" required wrap="sm:col-span-2" />
          <label className="block">
            <span className="label">Type</span>
            <select name="type" className="input"><option value="percent">% off</option><option value="flat">₹ flat off</option></select>
          </label>
          <F label="Value (% ya ₹)" name="value" type="number" min={1} required />
          <F label="Max discount ₹" name="maxDiscountRupees" type="number" min={0} />
          <F label="Min cart ₹" name="minCartRupees" type="number" min={0} placeholder="0" />
          <F label="PayU offer key" name="payuOfferKey" placeholder="offer@1234" />
          <F label="Sort order" name="sort" type="number" placeholder="0" />
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button className="btn-primary">Add offer</button>
      </Form>

      <div className="card overflow-x-auto p-0">
        <table className="w-full min-w-[600px] text-sm">
          <thead className="border-b border-gray-200 bg-gray-50 text-left text-xs text-gray-500">
            <tr><th className="p-3">Bank</th><th className="p-3">Offer</th><th className="p-3">PayU key</th><th className="p-3">Status</th><th className="p-3" /></tr>
          </thead>
          <tbody>
            {offers.length === 0 && <tr><td colSpan={5} className="p-4 text-center text-gray-500">Abhi koi bank offer nahi</td></tr>}
            {offers.map((o) => (
              <tr key={o.id} className="border-b border-gray-100 last:border-0">
                <td className="p-3 font-semibold">{o.bankName}</td>
                <td className="p-3">{o.title}<p className="text-xs text-gray-500">{o.type === "percent" ? `${o.value}%` : `₹${o.value}`}{o.maxDiscountRupees != null && ` · max ₹${o.maxDiscountRupees}`}{o.minCartRupees > 0 && ` · min ₹${o.minCartRupees}`}</p></td>
                <td className="p-3 text-xs">{o.payuOfferKey ?? <span className="text-amber-700">Missing — apply nahi hoga</span>}</td>
                <td className="p-3"><span className={`rounded-full px-2 py-0.5 text-xs ${o.active ? "bg-emerald-100 text-emerald-800" : "bg-gray-100 text-gray-600"}`}>{o.active ? "Live" : "Off"}</span></td>
                <td className="p-3">
                  <div className="flex gap-3">
                    <RowAction intent="toggleOffer" id={o.id} label={o.active ? "Disable" : "Enable"} />
                    <RowAction intent="deleteOffer" id={o.id} label="Delete" danger confirm="Offer delete karein?" />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

const STATUS: Record<string, string> = {
  paid: "bg-emerald-100 text-emerald-800",
  cod_placed: "bg-blue-100 text-blue-800",
  pending_payment: "bg-gray-100 text-gray-600",
  cod_placing: "bg-gray-100 text-gray-600",
  failed: "bg-red-100 text-red-700",
};

function OrdersTab({ orders }: { orders: Data["orders"] }) {
  return (
    <div className="card overflow-x-auto p-0">
      <table className="w-full min-w-[720px] text-sm">
        <thead className="border-b border-gray-200 bg-gray-50 text-left text-xs text-gray-500">
          <tr><th className="p-3">Order</th><th className="p-3">Customer</th><th className="p-3">Amount</th><th className="p-3">Discounts</th><th className="p-3">Status</th><th className="p-3">Shopify</th></tr>
        </thead>
        <tbody>
          {orders.length === 0 && <tr><td colSpan={6} className="p-4 text-center text-gray-500">Abhi koi order nahi</td></tr>}
          {orders.map((o) => (
            <tr key={o.id} className="border-b border-gray-100 align-top last:border-0">
              <td className="p-3">
                <p className="font-mono text-xs">{o.id}</p>
                <p className="text-xs text-gray-500">{new Date(o.createdAt).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}</p>
              </td>
              <td className="p-3">{o.customer.firstName} {o.customer.lastName}<p className="text-xs text-gray-500">{o.customer.phone} · {o.customer.city}</p></td>
              <td className="p-3 font-medium">{formatINR(o.amountPaid ?? o.total)}<p className="text-xs font-normal text-gray-500">{o.paymentMethod === "cod" ? "COD" : "Prepaid"}</p></td>
              <td className="p-3 text-xs text-gray-600">
                {o.paymentDiscount > 0 && <p>Payment −{formatINR(o.paymentDiscount)}</p>}
                {o.couponCode && <p>{o.couponCode} −{formatINR(o.couponDiscount)}</p>}
                {o.bankDiscount > 0 && <p>Bank −{formatINR(o.bankDiscount)}</p>}
              </td>
              <td className="p-3"><span className={`rounded-full px-2 py-0.5 text-xs ${STATUS[o.status] ?? ""}`}>{o.status.replace("_", " ")}</span></td>
              <td className="p-3 text-xs">
                {o.shopifyOrderName ?? (["paid", "cod_placed"].includes(o.status) ? (
                  <Form method="post">
                    <input type="hidden" name="intent" value="retryOrder" />
                    <input type="hidden" name="orderId" value={o.id} />
                    <button className="font-medium text-red-600 hover:underline">Retry push</button>
                  </Form>
                ) : "—")}
                {o.error && <p className="mt-1 max-w-[220px] break-words text-[11px] text-red-600">{o.error}</p>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function InstallTab({ appUrl, slug }: { appUrl: string; slug: string }) {
  const snippet = `<script src="${appUrl}/embed.js?store=${slug}" defer></script>`;
  const [copied, setCopied] = useState(false);
  return (
    <div className="space-y-4">
      <section className="card space-y-3">
        <h2 className="font-semibold">1. Shopify connection test</h2>
        <Form method="post">
          <input type="hidden" name="intent" value="testConnection" />
          <button className="btn-ghost">Test connection</button>
        </Form>
      </section>
      <section className="card space-y-3">
        <h2 className="font-semibold">2. Theme mein script lagao</h2>
        <p className="text-sm text-gray-600">Online Store → Themes → Edit code → <code>layout/theme.liquid</code> → <code>&lt;/body&gt;</code> se just pehle paste karo:</p>
        <pre className="overflow-x-auto rounded-xl bg-gray-900 p-4 text-xs text-gray-100">{snippet}</pre>
        <button type="button" className="btn-ghost" onClick={() => { navigator.clipboard.writeText(snippet); setCopied(true); setTimeout(() => setCopied(false), 1500); }}>
          {copied ? "Copied ✓" : "Copy snippet"}
        </button>
        <p className="text-xs text-gray-500">
          Cart ka “Checkout” aur product ka “Buy it now” button apne aap is checkout pe le aayega. Custom button ke liye
          usme <code>data-cx-checkout</code> attribute laga do, ya JS se <code>MultiCheckout.go()</code> /
          <code> MultiCheckout.buyNow(variantId, qty)</code> call karo.
        </p>
      </section>
      <section className="card space-y-2 text-sm text-gray-600">
        <h2 className="font-semibold text-gray-900">3. Test order</h2>
        <p>PayU mode “Test” rakh ke ek prepaid aur ek COD order karo, phir Orders tab mein Shopify order number check karo.</p>
      </section>
    </div>
  );
}
