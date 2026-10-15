import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Form, useActionData, useLoaderData } from "@remix-run/react";
import { and, desc, eq } from "drizzle-orm";
import { useState } from "react";
import { ProductPicker, parsePicked } from "~/components/ProductPicker";
import { EmptyState, Notice, RowAction, Section, SelectField, StatusBadge, SubmitButton, TextField, Toggle } from "~/components/ui";
import { coupons, db } from "~/db.server";
import { requireStore, requireViewer } from "~/lib/auth.server";
import { couponProblem } from "~/lib/coupons.server";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const store = await requireStore(await requireViewer(request), params.id);
  const rows = await db.select().from(coupons).where(eq(coupons.storeId, store.id)).orderBy(desc(coupons.createdAt));
  return json({ storeId: store.id, coupons: rows.map((c) => ({ ...c, problem: c.active ? couponProblem(c) : null })) });
}

const istDate = (v: string) => (v ? new Date(`${v}:00+05:30`) : null);

export async function action({ request, params }: ActionFunctionArgs) {
  const store = await requireStore(await requireViewer(request), params.id);
  const fd = await request.formData();
  const s = (k: string) => String(fd.get(k) ?? "").trim();
  const int = (k: string) => (s(k) === "" ? null : Math.max(0, Math.round(Number(s(k)) || 0)));
  const id = Number(s("id"));
  const own = and(eq(coupons.id, id), eq(coupons.storeId, store.id));

  switch (s("intent")) {
    case "add": {
      const code = s("code").toUpperCase().replace(/[^A-Z0-9_-]/g, "");
      const value = int("value");
      const errors: Record<string, string> = {};
      if (code.length < 3) errors.code = "Use at least 3 letters or numbers";
      if (!value) errors.value = "Enter the discount";
      if (s("type") === "percent" && (value ?? 0) > 100) errors.value = "Can't be more than 100%";
      if (!errors.code) {
        const [d] = await db.select({ id: coupons.id }).from(coupons).where(and(eq(coupons.storeId, store.id), eq(coupons.code, code))).limit(1);
        if (d) errors.code = "This code already exists";
      }
      if (Object.keys(errors).length) return json({ ok: null, errors }, { status: 400 });
      const products = s("appliesTo") === "products" ? parsePicked(fd.get("products")) : [];
      if (s("appliesTo") === "products" && !products.length) return json({ ok: null, errors: { products: "Pick at least one product" } }, { status: 400 });
      await db.insert(coupons).values({
        storeId: store.id,
        code,
        description: s("description") || null,
        type: s("type") === "flat" ? "flat" : "percent",
        value: value!,
        minCartRupees: int("minCartRupees") ?? 0,
        maxDiscountRupees: int("maxDiscountRupees"),
        stackable: fd.get("stackable") === "on",
        paymentRestriction: ["prepaid", "cod"].includes(s("paymentRestriction")) ? s("paymentRestriction") : "any",
        showInList: fd.get("showInList") === "on",
        usageLimit: int("usageLimit"),
        startsAt: istDate(s("startsAt")),
        endsAt: istDate(s("endsAt")),
        products: products.length ? products : null,
      });
      return json({ ok: `Coupon ${code} created`, errors: null });
    }
    case "toggle": {
      const [c] = await db.select().from(coupons).where(own);
      if (c) await db.update(coupons).set({ active: !c.active }).where(own);
      return json({ ok: null, errors: null });
    }
    case "delete":
      await db.delete(coupons).where(own);
      return json({ ok: "Coupon deleted", errors: null });
  }
  return json({ ok: null, errors: { form: "Unknown action" } }, { status: 400 });
}

export default function Coupons() {
  const { storeId, coupons: list } = useLoaderData<typeof loader>();
  const res = useActionData<typeof action>();
  const errors = (res?.errors ?? {}) as Record<string, string>;
  const [type, setType] = useState("percent");
  const [appliesTo, setAppliesTo] = useState("all");

  return (
    <div className="max-w-5xl space-y-5">
      {res?.ok && <Notice tone="success">{res.ok}</Notice>}

      <Section title="Create coupon" description="Customers can tap a coupon at checkout or type the code.">
        <Form method="post" className="space-y-5" key={list.length}>
          <div className="grid gap-4 sm:grid-cols-4">
            <TextField label="Code" name="code" placeholder="EXTRA10" error={errors.code} className="input uppercase" wrap="sm:col-span-2" required />
            <SelectField label="Discount type" name="type" value={type} onChange={(e) => setType(e.target.value)}>
              <option value="percent">Percentage</option>
              <option value="flat">Fixed amount (₹)</option>
            </SelectField>
            <TextField label={type === "percent" ? "Discount (%)" : "Discount (₹)"} name="value" type="number" min={1} error={errors.value} required />
            <TextField label="Text shown at checkout" name="description" placeholder="Extra 10% off on your order" wrap="sm:col-span-4" />
          </div>

          <div className="grid gap-4 border-t border-rule pt-5 sm:grid-cols-4">
            <SelectField label="Applies to" name="appliesTo" value={appliesTo} onChange={(e) => setAppliesTo(e.target.value)} wrap="sm:col-span-2">
              <option value="all">All products</option>
              <option value="products">Specific products</option>
            </SelectField>
            <SelectField label="Payment method" name="paymentRestriction" defaultValue="any" wrap="sm:col-span-2">
              <option value="any">Online and COD</option>
              <option value="prepaid">Only when paying online</option>
              <option value="cod">Only Cash on Delivery</option>
            </SelectField>
            {appliesTo === "products" && (
              <div className="sm:col-span-4">
                <span className="label">Products</span>
                <ProductPicker storeId={storeId} name="products" />
                {errors.products && <span className="error-text">{errors.products}</span>}
              </div>
            )}
            <TextField label="Minimum cart value (₹)" name="minCartRupees" type="number" min={0} placeholder="0" />
            <TextField label="Maximum discount (₹)" name="maxDiscountRupees" type="number" min={0} placeholder="No limit" disabled={type === "flat"} />
            <TextField label="Total uses allowed" name="usageLimit" type="number" min={1} placeholder="Unlimited" />
            <div />
            <TextField label="Starts (IST)" name="startsAt" type="datetime-local" wrap="sm:col-span-2" hint="Leave empty to start now" />
            <TextField label="Ends (IST)" name="endsAt" type="datetime-local" wrap="sm:col-span-2" hint="Leave empty for no end date" />
          </div>

          <div className="space-y-3 border-t border-rule pt-5">
            <Toggle name="stackable" label="Combine with the online / COD discount" description="When off, the coupon only replaces the payment discount if it saves the customer more." defaultChecked />
            <Toggle name="showInList" label="Show in the coupon list at checkout" description="When off, customers need to know the code." defaultChecked />
          </div>
          <SubmitButton intent="add" busyText="Creating">Create coupon</SubmitButton>
        </Form>
      </Section>

      {list.length === 0 ? (
        <EmptyState title="No coupons yet">Coupons you create show up here with how many times they've been used.</EmptyState>
      ) : (
        <div className="panel overflow-x-auto">
          <table className="table min-w-[760px]">
            <thead><tr><th>Code</th><th>Discount</th><th>Rules</th><th className="text-right">Used</th><th>Status</th><th /></tr></thead>
            <tbody>
              {list.map((c) => (
                <tr key={c.id}>
                  <td><p className="font-semibold tracking-wide">{c.code}</p>{c.description && <p className="max-w-[220px] truncate text-xs text-ink-faint">{c.description}</p>}</td>
                  <td className="num whitespace-nowrap">{c.type === "percent" ? `${c.value}%` : `₹${c.value}`}{c.maxDiscountRupees != null && c.type === "percent" && <span className="text-xs text-ink-faint"> up to ₹{c.maxDiscountRupees}</span>}</td>
                  <td className="text-xs text-ink-soft">
                    <p>{c.products?.length ? `${c.products.length} product${c.products.length > 1 ? "s" : ""}` : "All products"}, {c.paymentRestriction === "any" ? "online and COD" : c.paymentRestriction === "prepaid" ? "online only" : "COD only"}</p>
                    <p className="text-ink-faint">{[c.minCartRupees > 0 && `Min ₹${c.minCartRupees}`, c.stackable ? "Combines" : "Doesn't combine", !c.showInList && "Hidden"].filter(Boolean).join(", ")}</p>
                  </td>
                  <td className="num text-right">{c.usedCount}{c.usageLimit != null && <span className="text-ink-faint"> / {c.usageLimit}</span>}</td>
                  <td>
                    <StatusBadge status={c.active && !c.problem ? "live" : "off"} label={!c.active ? "Paused" : c.problem ? "Inactive" : "Live"} />
                    {c.problem && <p className="mt-1 text-xs text-ink-faint">{c.problem}</p>}
                  </td>
                  <td><div className="flex justify-end"><RowAction intent="toggle" id={c.id} label={c.active ? "Pause" : "Resume"} /><RowAction intent="delete" id={c.id} label="Delete" danger confirm={`Delete coupon ${c.code}?`} /></div></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
