import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Form, useActionData, useLoaderData } from "@remix-run/react";
import { and, desc, eq } from "drizzle-orm";
import { ProductPicker, parsePicked } from "~/components/ProductPicker";
import { Notice, RowAction, Section, StatusBadge, SubmitButton, TextField, Toggle } from "~/components/ui";
import { db, discountRules, stores } from "~/db.server";
import { requireStore, requireViewer } from "~/lib/auth.server";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const store = await requireStore(await requireViewer(request), params.id);
  const rules = await db.select().from(discountRules).where(eq(discountRules.storeId, store.id)).orderBy(desc(discountRules.createdAt));
  return json({
    store: { id: store.id, prepaid: store.prepaidDiscountPct, cod: store.codDiscountPct, codEnabled: store.codEnabled, upsellEnabled: store.upsellEnabled, upsellProducts: store.upsellProducts },
    rules,
  });
}

const pct = (v: FormDataEntryValue | null) => Math.max(0, Math.min(100, Math.round(Number(v) || 0)));

export async function action({ request, params }: ActionFunctionArgs) {
  const store = await requireStore(await requireViewer(request), params.id);
  const fd = await request.formData();
  const id = Number(fd.get("id"));
  const own = and(eq(discountRules.id, id), eq(discountRules.storeId, store.id));

  switch (fd.get("intent")) {
    case "defaults":
      await db.update(stores).set({ prepaidDiscountPct: pct(fd.get("prepaid")), codDiscountPct: pct(fd.get("cod")) }).where(eq(stores.id, store.id));
      return json({ ok: "Store-wide discount saved", errors: null });
    case "addRule": {
      const products = parsePicked(fd.get("products"));
      const name = String(fd.get("name") ?? "").trim() || `${products.length} product${products.length === 1 ? "" : "s"}`;
      if (!products.length) return json({ ok: null, errors: { rule: "Pick at least one product" } }, { status: 400 });
      await db.insert(discountRules).values({ storeId: store.id, name, products, prepaidPct: pct(fd.get("prepaid")), codPct: pct(fd.get("cod")) });
      return json({ ok: "Product discount added", errors: null });
    }
    case "toggleRule": {
      const [r] = await db.select().from(discountRules).where(own);
      if (r) await db.update(discountRules).set({ active: !r.active }).where(own);
      return json({ ok: null, errors: null });
    }
    case "deleteRule":
      await db.delete(discountRules).where(own);
      return json({ ok: "Product discount deleted", errors: null });
    case "upsell":
      await db.update(stores).set({ upsellEnabled: fd.get("upsellEnabled") === "on", upsellProducts: parsePicked(fd.get("upsellProducts")).slice(0, 12) }).where(eq(stores.id, store.id));
      return json({ ok: "Checkout recommendations saved", errors: null });
  }
  return json({ ok: null, errors: { form: "Unknown action" } }, { status: 400 });
}

export default function Discounts() {
  const { store, rules } = useLoaderData<typeof loader>();
  const res = useActionData<typeof action>();
  const errors = (res?.errors ?? {}) as Record<string, string>;

  return (
    <div className="max-w-4xl space-y-5">
      {res?.ok && <Notice tone="success">{res.ok}</Notice>}

      <Section title="Store-wide discount" description="Applies to every product unless a product discount below says otherwise. Customers see both prices at checkout.">
        <Form method="post" className="flex flex-wrap items-end gap-4">
          <TextField label="Pay online" name="prepaid" type="number" min={0} max={100} defaultValue={store.prepaid} wrap="w-36" hint="% off" />
          <TextField label="Cash on Delivery" name="cod" type="number" min={0} max={100} defaultValue={store.cod} wrap="w-36" hint={store.codEnabled ? "% off" : "COD is turned off"} />
          <SubmitButton intent="defaults" busyText="Saving">Save</SubmitButton>
        </Form>
      </Section>

      <Section title="Product discounts" description="Give selected products their own online and COD discount. If a product is in more than one, the newest one wins.">
        <Form method="post" className="space-y-4 rounded-lg border border-dashed border-rule-strong p-4" key={rules.length}>
          <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_120px_120px]">
            <TextField label="Name (for you)" name="name" placeholder="Festive smartwatch offer" />
            <TextField label="Pay online" name="prepaid" type="number" min={0} max={100} defaultValue={store.prepaid} hint="% off" />
            <TextField label="COD" name="cod" type="number" min={0} max={100} defaultValue={store.cod} hint="% off" />
          </div>
          <div>
            <span className="label">Products</span>
            <ProductPicker storeId={store.id} name="products" />
            {errors.rule && <span className="error-text">{errors.rule}</span>}
          </div>
          <SubmitButton intent="addRule" busyText="Adding">Add product discount</SubmitButton>
        </Form>

        <div className="mt-5">
          {rules.length === 0 ? (
            <p className="text-sm text-ink-faint">No product discounts yet. Every product uses the store-wide discount.</p>
          ) : (
            <ul className="divide-y divide-rule rounded-lg border border-rule">
              {rules.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-2 text-sm font-medium">{r.name} <StatusBadge status={r.active ? "live" : "off"} /></p>
                    <p className="mt-0.5 truncate text-xs text-ink-faint">{r.products.map((p) => p.title).join(", ")}</p>
                  </div>
                  <p className="num text-sm"><b>{r.prepaidPct}%</b> online <span className="text-ink-faint">/</span> <b>{r.codPct}%</b> COD</p>
                  <div className="flex">
                    <RowAction intent="toggleRule" id={r.id} label={r.active ? "Pause" : "Resume"} />
                    <RowAction intent="deleteRule" id={r.id} label="Delete" danger confirm={`Delete "${r.name}"?`} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Section>

      <Section title="Checkout recommendations" description="Products shown under “You may also like” at checkout. Customers can add them in one tap.">
        <Form method="post" className="space-y-4">
          <Toggle name="upsellEnabled" label="Show recommendations at checkout" defaultChecked={store.upsellEnabled} />
          <div>
            <span className="label">Products to recommend</span>
            <ProductPicker storeId={store.id} name="upsellProducts" initial={store.upsellProducts} placeholder="Search products to recommend" />
            <span className="hint">Leave empty to show your newest products automatically. Up to 12. Items already in the cart are hidden.</span>
          </div>
          <SubmitButton intent="upsell" busyText="Saving">Save recommendations</SubmitButton>
        </Form>
      </Section>
    </div>
  );
}
