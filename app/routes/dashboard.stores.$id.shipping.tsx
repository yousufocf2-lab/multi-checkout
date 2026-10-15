import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Form, useActionData, useLoaderData } from "@remix-run/react";
import { and, asc, eq } from "drizzle-orm";
import { useMemo, useState } from "react";
import { EmptyState, Notice, RowAction, Section, SelectField, StatusBadge, SubmitButton, TextField } from "~/components/ui";
import { db, shippingRates } from "~/db.server";
import { requireStore, requireViewer } from "~/lib/auth.server";
import { formatINR } from "~/lib/pricing";
import { quoteShipping, type ShipRule } from "~/lib/shipping";
import { INDIAN_STATES } from "~/lib/states";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const store = await requireStore(await requireViewer(request), params.id);
  const rates = await db.select().from(shippingRates).where(eq(shippingRates.storeId, store.id)).orderBy(asc(shippingRates.minOrderRupees), asc(shippingRates.id));
  return json({ rates });
}

export async function action({ request, params }: ActionFunctionArgs) {
  const store = await requireStore(await requireViewer(request), params.id);
  const fd = await request.formData();
  const s = (k: string) => String(fd.get(k) ?? "").trim();
  const num = (k: string) => (s(k) === "" ? null : Math.max(0, Math.round(Number(s(k)) || 0)));
  const own = and(eq(shippingRates.id, Number(s("id"))), eq(shippingRates.storeId, store.id));

  switch (s("intent")) {
    case "add": {
      const errors: Record<string, string> = {};
      const price = Number(s("price"));
      const min = num("minOrder") ?? 0;
      const max = num("maxOrder");
      const where = s("where");
      const states = where === "states" ? fd.getAll("states").map(String).filter((c) => INDIAN_STATES.some((x) => x.code === c)) : [];
      const prefixes = where === "pincodes" ? s("pincodes").split(/[\s,]+/).map((x) => x.replace(/\D/g, "")).filter((x) => x.length >= 1 && x.length <= 6) : [];
      if (!s("name")) errors.name = "Enter the name customers will see";
      if (!Number.isFinite(price) || price < 0) errors.price = "Enter 0 or more";
      if (max != null && max < min) errors.maxOrder = "Must be more than the minimum";
      if (where === "states" && !states.length) errors.where = "Pick at least one state";
      if (where === "pincodes" && !prefixes.length) errors.where = "Enter at least one pincode or prefix";
      if (Object.keys(errors).length) return json({ ok: null, errors }, { status: 400 });
      await db.insert(shippingRates).values({
        storeId: store.id, name: s("name"), pricePaise: Math.round(price * 100), minOrderRupees: min, maxOrderRupees: max,
        states, pincodePrefixes: prefixes, paymentMethod: ["prepaid", "cod"].includes(s("paymentMethod")) ? s("paymentMethod") : "any",
      });
      return json({ ok: "Shipping rate added", errors: null });
    }
    case "toggle": {
      const [r] = await db.select().from(shippingRates).where(own);
      if (r) await db.update(shippingRates).set({ active: !r.active }).where(own);
      return json({ ok: null, errors: null });
    }
    case "delete":
      await db.delete(shippingRates).where(own);
      return json({ ok: "Shipping rate deleted", errors: null });
  }
  return json({ ok: null, errors: null });
}

const stateName = (c: string) => INDIAN_STATES.find((s) => s.code === c)?.name ?? c;

function describe(r: { minOrderRupees: number; maxOrderRupees: number | null; states: string[]; pincodePrefixes: string[]; paymentMethod: string }) {
  const value = r.maxOrderRupees != null ? `Orders ₹${r.minOrderRupees.toLocaleString("en-IN")} to ₹${r.maxOrderRupees.toLocaleString("en-IN")}` : r.minOrderRupees > 0 ? `Orders ₹${r.minOrderRupees.toLocaleString("en-IN")} and above` : "Any order value";
  const where = r.states.length ? (r.states.length > 3 ? `${r.states.length} states` : r.states.map(stateName).join(", ")) : r.pincodePrefixes.length ? `Pincodes starting ${r.pincodePrefixes.join(", ")}` : "All India";
  const pay = r.paymentMethod === "prepaid" ? "online payment only" : r.paymentMethod === "cod" ? "COD only" : "online and COD";
  return `${value}, ${where}, ${pay}`;
}

export default function Shipping() {
  const { rates } = useLoaderData<typeof loader>();
  const res = useActionData<typeof action>();
  const errors = (res?.errors ?? {}) as Record<string, string>;
  const [where, setWhere] = useState("all");

  const rules: ShipRule[] = rates.filter((r) => r.active).map((r) => ({ ...r }));
  const [t, setT] = useState({ value: "500", pincode: "", state: "", method: "prepaid" });
  const quote = useMemo(() => quoteShipping(rules, { state: t.state, pincode: t.pincode, method: t.method, value: Math.round(Number(t.value || 0) * 100) }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rates, t]);

  return (
    <div className="max-w-5xl space-y-5">
      {res?.ok && <Notice tone="success">{res.ok}</Notice>}
      <Notice>
        A rate for the customer's state or pincode is used before an all-India rate. If several match, the cheapest wins. If none match, delivery is free.
        Order value is what the customer pays for items after discounts. Every Shopify order gets a shipping line with this amount.
      </Notice>

      <Section title="Add a shipping rate" description="Example: ₹30 for orders below ₹150, or ₹60 for Northeast states.">
        <Form method="post" className="space-y-5" key={rates.length}>
          <div className="grid gap-4 sm:grid-cols-4">
            <TextField label="Name shown at checkout" name="name" placeholder="Standard delivery" error={errors.name} wrap="sm:col-span-2" />
            <TextField label="Charge (₹)" name="price" type="number" min={0} step="1" placeholder="30" error={errors.price} hint="Use 0 for free delivery" />
            <SelectField label="Payment method" name="paymentMethod" defaultValue="any">
              <option value="any">Online and COD</option>
              <option value="prepaid">Online payment only</option>
              <option value="cod">COD only</option>
            </SelectField>
            <TextField label="Order value from (₹)" name="minOrder" type="number" min={0} placeholder="0" />
            <TextField label="Order value up to (₹)" name="maxOrder" type="number" min={0} placeholder="No limit" error={errors.maxOrder} />
            <SelectField label="Where" name="where" value={where} onChange={(e) => setWhere(e.target.value)} wrap="sm:col-span-2">
              <option value="all">All India</option>
              <option value="states">Selected states</option>
              <option value="pincodes">Selected pincodes</option>
            </SelectField>
          </div>
          {where === "states" && (
            <fieldset>
              <legend className="label">States</legend>
              <div className="grid max-h-60 grid-cols-2 gap-x-4 gap-y-1.5 overflow-y-auto rounded-lg border border-rule p-3 sm:grid-cols-3">
                {INDIAN_STATES.map((st) => (
                  <label key={st.code} className="flex items-center gap-2 text-sm"><input type="checkbox" name="states" value={st.code} className="h-4 w-4 accent-[rgb(var(--brand))]" />{st.name}</label>
                ))}
              </div>
            </fieldset>
          )}
          {where === "pincodes" && (
            <TextField label="Pincodes or prefixes" name="pincodes" placeholder="110, 2260, 400001" hint="Separate with commas. A prefix like 110 covers every pincode that starts with 110." />
          )}
          {errors.where && <p className="error-text">{errors.where}</p>}
          <SubmitButton intent="add" busyText="Adding">Add shipping rate</SubmitButton>
        </Form>
      </Section>

      {rates.length === 0 ? (
        <EmptyState title="Delivery is free on every order">Add a rate above to charge for delivery on some orders or locations.</EmptyState>
      ) : (
        <div className="panel overflow-x-auto">
          <table className="table min-w-[640px]">
            <thead><tr><th>Rate</th><th>Applies to</th><th className="text-right">Charge</th><th>Status</th><th /></tr></thead>
            <tbody>
              {rates.map((r) => (
                <tr key={r.id}>
                  <td className="font-medium">{r.name}</td>
                  <td className="text-sm text-ink-soft">{describe(r)}</td>
                  <td className="num text-right font-medium">{r.pricePaise ? formatINR(r.pricePaise) : "Free"}</td>
                  <td><StatusBadge status={r.active ? "live" : "off"} label={r.active ? "Live" : "Paused"} /></td>
                  <td><div className="flex justify-end"><RowAction intent="toggle" id={r.id} label={r.active ? "Pause" : "Resume"} /><RowAction intent="delete" id={r.id} label="Delete" danger confirm={`Delete "${r.name}"?`} /></div></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Section title="Check a delivery charge" description="See what a customer would pay with your live rates.">
        <div className="grid gap-4 sm:grid-cols-4">
          <TextField label="Order value (₹)" type="number" value={t.value} onChange={(e) => setT({ ...t, value: e.target.value })} />
          <TextField label="Pincode" inputMode="numeric" maxLength={6} value={t.pincode} onChange={(e) => setT({ ...t, pincode: e.target.value.replace(/\D/g, "") })} />
          <SelectField label="State" value={t.state} onChange={(e) => setT({ ...t, state: e.target.value })}>
            <option value="">Any</option>
            {INDIAN_STATES.map((s) => <option key={s.code} value={s.code}>{s.name}</option>)}
          </SelectField>
          <SelectField label="Payment" value={t.method} onChange={(e) => setT({ ...t, method: e.target.value })}>
            <option value="prepaid">Online</option><option value="cod">COD</option>
          </SelectField>
        </div>
        <p className="mt-4 text-sm">
          Customer pays <b className="num">{quote.pricePaise ? formatINR(quote.pricePaise) : "nothing"}</b> for delivery ({quote.name})
          {quote.freeAbove ? <>. Free above <b className="num">{formatINR(quote.freeAbove)}</b>.</> : "."}
        </p>
      </Section>
    </div>
  );
}
