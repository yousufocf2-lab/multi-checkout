import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Form, useActionData, useLoaderData } from "@remix-run/react";
import { eq } from "drizzle-orm";
import { useState } from "react";
import { ProductPicker, parsePicked } from "~/components/ProductPicker";
import { Notice, SubmitButton, Toggle } from "~/components/ui";
import { db, stores } from "~/db.server";
import { requireStore, requireViewer } from "~/lib/auth.server";
import {
  METHOD_LABEL, describeRule, resolvePaymentMethods,
  type AdjustMode, type AmountType, type MethodSettings, type PartialSettings, type PayMethod, type ShowRule,
} from "~/lib/payment-methods";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const store = await requireStore(await requireViewer(request), params.id);
  return json({
    storeId: store.id,
    payuReady: Boolean(store.payuKey && store.payuSalt),
    methods: resolvePaymentMethods(store.paymentMethods, store),
  });
}

const n = (v: FormDataEntryValue | null) => {
  const s = String(v ?? "").trim();
  if (s === "") return null;
  const x = Math.round(Number(s));
  return Number.isFinite(x) && x >= 0 ? x : null;
};

function readMethod(fd: FormData): { m: MethodSettings; errors: Record<string, string> } {
  const errors: Record<string, string> = {};
  const adjust = (["off", "discount", "fee"].includes(String(fd.get("adjust"))) ? fd.get("adjust") : "off") as AdjustMode;
  const type: AmountType = fd.get("type") === "flat" ? "flat" : "percent";
  const value = n(fd.get("value")) ?? 0;
  if (adjust !== "off" && value <= 0) errors.value = adjust === "fee" ? "Enter the fee" : "Enter the discount";
  if (type === "percent" && value > 100) errors.value = "Can't be more than 100%";
  const rules: ShowRule[] = [];
  for (const key of fd.getAll("rule")) {
    const k = String(key);
    const min = n(fd.get(`min_${k}`)), max = n(fd.get(`max_${k}`));
    const products = parsePicked(fd.get(`products_${k}`)).slice(0, 50);
    if (min == null && max == null && !products.length) continue;
    if (min != null && max != null && max < min) errors.rules = "In a rule the maximum can't be less than the minimum";
    rules.push({ min, max, products, productMode: fd.get(`mode_${k}`) === "only" ? "only" : "contains" });
  }
  return { m: { on: fd.get("on") === "on", adjust, type, value: adjust === "off" ? 0 : value, coupons: fd.get("coupons") === "on", rules: rules.slice(0, 20) }, errors };
}

export async function action({ request, params }: ActionFunctionArgs) {
  const store = await requireStore(await requireViewer(request), params.id);
  const fd = await request.formData();
  const which = String(fd.get("intent")) as PayMethod;
  if (!["prepaid", "cod", "partial"].includes(which)) return json({ ok: null, which, errors: { form: "Unknown action" } }, { status: 400 });

  const current = resolvePaymentMethods(store.paymentMethods, store);
  const { m, errors } = readMethod(fd);
  let next: MethodSettings | PartialSettings = m;
  if (which === "partial") {
    const advanceType: AmountType = fd.get("advanceType") === "flat" ? "flat" : "percent";
    const advanceValue = n(fd.get("advanceValue")) ?? 0;
    if (advanceValue <= 0) errors.advanceValue = "Enter how much the customer pays now";
    if (advanceType === "percent" && advanceValue >= 100) errors.advanceValue = "Must be less than 100%";
    if (m.on && !(store.payuKey && store.payuSalt)) errors.form = "Partial COD needs online payment (PayU) connected in Store settings.";
    next = { ...m, advanceType, advanceValue };
  }
  if (which === "prepaid" && m.on && !(store.payuKey && store.payuSalt)) errors.form = "Connect PayU in Store settings to take online payments.";
  if (Object.keys(errors).length) return json({ ok: null, which, errors }, { status: 400 });

  const all = { ...current, [which]: next };
  const legacyPct = (x: MethodSettings) => (x.adjust === "discount" && x.type === "percent" ? Math.min(100, x.value) : 0);
  await db.update(stores).set({
    paymentMethods: all,
    // Older screens and Shopify discount codes still read these
    prepaidDiscountPct: legacyPct(all.prepaid),
    codDiscountPct: legacyPct(all.cod),
    codEnabled: all.cod.on,
  }).where(eq(stores.id, store.id));
  return json({ ok: `${METHOD_LABEL[which]} saved`, which, errors: null });
}

const INFO: Record<PayMethod, { icon: string; text: string }> = {
  prepaid: { icon: "💳", text: "Customer pays the full amount online (UPI, cards, net banking, wallets)." },
  cod: { icon: "💵", text: "Customer pays the full amount when the order arrives." },
  partial: { icon: "🪙", text: "Customer pays a small advance online now and the rest in cash on delivery. Cuts fake COD orders." },
};

export default function PaymentMethods() {
  const d = useLoaderData<typeof loader>();
  const res = useActionData<typeof action>();
  return (
    <div className="max-w-4xl space-y-5">
      {res?.ok && <Notice tone="success">{res.ok}</Notice>}
      {!d.payuReady && <Notice tone="warning">Online payment isn't connected, so Prepaid and Partial COD won't show at checkout. Add PayU in Store settings.</Notice>}
      <p className="text-sm text-ink-soft">
        Turn each payment method on or off, give it a discount or a fee, and choose when it shows.
        Product discounts (in Discounts) still win for their products. Partial COD follows your COD rules in RTO Suite (wait time, blocks, OTP).
      </p>
      {(["prepaid", "cod", "partial"] as const).map((k) => (
        <MethodPanel key={k} k={k} storeId={d.storeId} s={d.methods[k]} errors={res?.which === k ? ((res.errors ?? {}) as Record<string, string>) : {}} />
      ))}
    </div>
  );
}

type RuleRow = ShowRule & { key: string };
let seq = 0;
const newKey = () => `r${Date.now().toString(36)}${seq++}`;

function MethodPanel({ k, storeId, s, errors }: { k: PayMethod; storeId: number; s: MethodSettings | PartialSettings; errors: Record<string, string> }) {
  const [adjust, setAdjust] = useState<AdjustMode>(s.adjust);
  const [type, setType] = useState<AmountType>(s.type);
  const [rules, setRules] = useState<RuleRow[]>(s.rules.map((r) => ({ ...r, key: newKey() })));
  const partial = k === "partial" ? (s as PartialSettings) : null;
  const [advType, setAdvType] = useState<AmountType>(partial?.advanceType ?? "percent");
  const label = METHOD_LABEL[k];

  return (
    <Form method="post" className="panel p-5" id={k}>
      <div className="flex items-start gap-3">
        <span className="text-2xl leading-none" aria-hidden>{INFO[k].icon}</span>
        <div className="min-w-0 flex-1">
          <Toggle name="on" label={label} description={INFO[k].text} defaultChecked={s.on} />
        </div>
      </div>
      {errors.form && <div className="mt-3"><Notice tone="error">{errors.form}</Notice></div>}

      {partial && (
        <fieldset className="mt-5 rounded-lg border border-rule p-4">
          <legend className="px-1 text-sm font-semibold">Advance paid online</legend>
          <div className="flex flex-wrap items-end gap-3">
            <Seg name="advanceType" value={advType} onChange={(v) => setAdvType(v as AmountType)} options={[["percent", "% of order"], ["flat", "Fixed ₹"]]} />
            <label className="block w-36">
              <span className="label">{advType === "percent" ? "Percent" : "Amount (₹)"}</span>
              <input name="advanceValue" type="number" min={1} max={advType === "percent" ? 99 : undefined} defaultValue={partial.advanceValue || ""} className="input num" />
            </label>
          </div>
          {errors.advanceValue && <span className="error-text">{errors.advanceValue}</span>}
          <p className="hint mt-2">
            {advType === "percent" ? "E.g. 10%: on a ₹1,000 order the customer pays ₹100 now and ₹900 on delivery." : "E.g. ₹200: the customer pays ₹200 now on every order, the rest on delivery."}
            {" "}If the advance would be the whole order, Partial COD is hidden for that cart.
          </p>
        </fieldset>
      )}

      <fieldset className="mt-5">
        <legend className="text-sm font-semibold">Discount or fee</legend>
        <div className="mt-2 flex flex-wrap items-end gap-3">
          <Seg name="adjust" value={adjust} onChange={(v) => setAdjust(v as AdjustMode)} options={[["off", "Off"], ["discount", "Discount"], ["fee", "Fee"]]} />
          {adjust !== "off" && (
            <>
              <Seg name="type" value={type} onChange={(v) => setType(v as AmountType)} options={[["percent", "%"], ["flat", "₹ flat"]]} />
              <label className="block w-32">
                <span className="label">{type === "percent" ? "Percent" : "Amount (₹)"}</span>
                <input name="value" type="number" min={1} max={type === "percent" ? 100 : undefined} defaultValue={s.value || ""} className="input num" />
              </label>
            </>
          )}
          {adjust === "off" && <><input type="hidden" name="type" value={type} /><input type="hidden" name="value" value="0" /></>}
        </div>
        {errors.value && <span className="error-text">{errors.value}</span>}
        <p className="hint mt-2">
          {adjust === "off" ? "No discount and no extra charge for this method."
            : adjust === "discount" ? (type === "percent" ? "% off the items. Products with their own discount in Discounts use that instead." : "₹ off the order total.")
            : type === "percent" ? "% of the order value added as a fee (shown as a separate line)." : "Fixed ₹ added to the order as a fee."}
        </p>
      </fieldset>

      <label className="mt-5 flex cursor-pointer items-start gap-2.5">
        <input type="checkbox" name="coupons" defaultChecked={s.coupons} className="mt-0.5 h-4 w-4 accent-[var(--brand)]" />
        <span><span className="block text-sm font-medium">Allow coupons with {label}</span>
          <span className="block text-xs text-ink-faint">Off: coupon codes can't be applied when the customer picks this method.</span></span>
      </label>

      <fieldset className="mt-5">
        <legend className="text-sm font-semibold">When to show {label}</legend>
        <p className="hint">No rules = shown on every cart. Add rules to show it only for some carts; it shows when any one rule matches.</p>
        <ul className="mt-3 space-y-3">
          {rules.map((r, i) => (
            <li key={r.key} className="rounded-lg border border-dashed border-rule-strong p-3">
              <input type="hidden" name="rule" value={r.key} />
              <div className="mb-2 flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wider text-ink-faint">Rule {i + 1}</span>
                <button type="button" className="text-xs font-medium text-bad" onClick={() => setRules((x) => x.filter((y) => y.key !== r.key))}>Remove</button>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block"><span className="label">Minimum order (₹)</span><input name={`min_${r.key}`} type="number" min={0} defaultValue={r.min ?? ""} placeholder="No minimum" className="input num" /></label>
                <label className="block"><span className="label">Maximum order (₹)</span><input name={`max_${r.key}`} type="number" min={0} defaultValue={r.max ?? ""} placeholder="No maximum" className="input num" /></label>
                <div className="sm:col-span-2">
                  <span className="label">Products (optional)</span>
                  <ProductPicker storeId={storeId} name={`products_${r.key}`} initial={r.products.map((p) => ({ id: p.id, title: p.title, image: p.image ?? null }))} />
                </div>
                <label className="block sm:col-span-2"><span className="label">With these products</span>
                  <select name={`mode_${r.key}`} defaultValue={r.productMode} className="input">
                    <option value="contains">Show when the cart has any of them (other products can be in the cart too)</option>
                    <option value="only">Show only when the cart has just these products</option>
                  </select>
                </label>
              </div>
            </li>
          ))}
        </ul>
        {errors.rules && <span className="error-text">{errors.rules}</span>}
        <button type="button" className="btn-secondary mt-3" onClick={() => setRules((x) => [...x, { key: newKey(), min: null, max: null, products: [], productMode: "contains" }])}>+ Add rule</button>
        {s.rules.length > 0 && rules.length === s.rules.length && (
          <p className="hint mt-2">Now: shows when {s.rules.map(describeRule).join(", or ")}.</p>
        )}
      </fieldset>

      <div className="mt-5 border-t border-rule pt-4">
        <SubmitButton intent={k} busyText="Saving">Save {label}</SubmitButton>
      </div>
    </Form>
  );
}

function Seg({ name, value, onChange, options }: { name: string; value: string; onChange: (v: string) => void; options: [string, string][] }) {
  return (
    <div className="inline-flex rounded-lg border border-rule-strong p-0.5" role="radiogroup">
      <input type="hidden" name={name} value={value} />
      {options.map(([v, l]) => (
        <button key={v} type="button" role="radio" aria-checked={value === v} onClick={() => onChange(v)}
          className={`rounded-md px-3 py-1.5 text-sm font-medium transition ${value === v ? "bg-ink text-surface" : "text-ink-soft hover:text-ink"}`}>{l}</button>
      ))}
    </div>
  );
}
