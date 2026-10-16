import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Form, useActionData, useLoaderData, useNavigation } from "@remix-run/react";
import { useEffect, useState } from "react";
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
const rupees = (v: FormDataEntryValue | null) => Math.max(0, Math.min(1_000_000, Math.round(Number(v) || 0)));

/** Reads name, type, online/COD values and products from an add or edit form. */
function readRule(fd: FormData) {
  const products = parsePicked(fd.get("products"));
  const type = fd.get("type") === "flat" ? "flat" : "percent";
  const val = type === "flat" ? rupees : pct;
  const name = String(fd.get("name") ?? "").trim() || `${products.length} product${products.length === 1 ? "" : "s"}`;
  return { products, type, name, prepaidPct: val(fd.get("prepaid")), codPct: val(fd.get("cod")) };
}

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
      const r = readRule(fd);
      if (!r.products.length) return json({ ok: null, errors: { rule: "Pick at least one product" } }, { status: 400 });
      await db.insert(discountRules).values({ storeId: store.id, ...r });
      return json({ ok: "Product discount added", errors: null });
    }
    case "updateRule": {
      const r = readRule(fd);
      if (!r.products.length) return json({ ok: null, errors: { [`edit${id}`]: "Pick at least one product" } }, { status: 400 });
      await db.update(discountRules).set(r).where(own);
      return json({ ok: `“${r.name}” updated`, errors: null });
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

      <Section title="Product discounts" description="Give selected products their own online and COD discount, as a % or a flat ₹ amount off each item. If a product is in more than one, the newest one wins.">
        <Form method="post" className="space-y-4 rounded-lg border border-dashed border-rule-strong p-4" key={rules.length}>
          <RuleFields storeId={store.id} defaults={{ type: "percent", prepaid: store.prepaid, cod: store.cod }} />
          {errors.rule && <span className="error-text">{errors.rule}</span>}
          <SubmitButton intent="addRule" busyText="Adding">Add product discount</SubmitButton>
        </Form>

        <div className="mt-5">
          {rules.length === 0 ? (
            <p className="text-sm text-ink-faint">No product discounts yet. Every product uses the store-wide discount.</p>
          ) : (
            <ul className="divide-y divide-rule rounded-lg border border-rule">
              {rules.map((r) => <RuleRow key={r.id} r={r} storeId={store.id} error={errors[`edit${r.id}`]} />)}
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

type Rule = ReturnType<typeof useLoaderData<typeof loader>>["rules"][number];

const fmtValue = (type: string, v: number) => (type === "flat" ? `₹${v.toLocaleString("en-IN")}` : `${v}%`);

function RuleRow({ r, storeId, error }: { r: Rule; storeId: number; error?: string }) {
  const [editing, setEditing] = useState(false);
  const nav = useNavigation();
  const saving = nav.state !== "idle" && nav.formData?.get("intent") === "updateRule" && nav.formData?.get("id") === String(r.id);
  // Close the editor once the save finishes without an error
  useEffect(() => { if (!saving && !error) setEditing(false); }, [saving]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (error) setEditing(true); }, [error]);

  return (
    <li className="px-4 py-3">
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
            {r.name} <StatusBadge status={r.active ? "live" : "off"} />
            <span className="rounded bg-paper-sunk px-1.5 py-px text-[11px] font-medium text-ink-soft">{r.type === "flat" ? "Flat ₹ off" : "% off"}</span>
          </p>
          <p className="mt-0.5 truncate text-xs text-ink-faint">{r.products.map((p) => p.title).join(", ")}</p>
        </div>
        <p className="num text-sm"><b>{fmtValue(r.type, r.prepaidPct)}</b> online <span className="text-ink-faint">/</span> <b>{fmtValue(r.type, r.codPct)}</b> COD{r.type === "flat" && <span className="text-ink-faint"> per item</span>}</p>
        <div className="flex">
          <button type="button" className="btn-quiet" onClick={() => setEditing((e) => !e)} aria-expanded={editing}>{editing ? "Cancel" : "Edit"}</button>
          <RowAction intent="toggleRule" id={r.id} label={r.active ? "Pause" : "Resume"} />
          <RowAction intent="deleteRule" id={r.id} label="Delete" danger confirm={`Delete "${r.name}"?`} />
        </div>
      </div>
      {editing && (
        <Form method="post" className="mt-3 space-y-4 rounded-lg border border-rule bg-paper/60 p-4">
          <input type="hidden" name="id" value={r.id} />
          <RuleFields storeId={storeId} defaults={{ name: r.name, type: r.type, prepaid: r.prepaidPct, cod: r.codPct, products: r.products }} />
          {error && <span className="error-text">{error}</span>}
          <div className="flex gap-2">
            <SubmitButton intent="updateRule" busyText="Saving">Save changes</SubmitButton>
            <button type="button" className="btn-secondary" onClick={() => setEditing(false)}>Cancel</button>
          </div>
        </Form>
      )}
    </li>
  );
}

function RuleFields({ storeId, defaults }: { storeId: number; defaults: { name?: string; type: string; prepaid: number; cod: number; products?: Rule["products"] } }) {
  const [type, setType] = useState(defaults.type === "flat" ? "flat" : "percent");
  const flat = type === "flat";
  return (
    <>
      <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_170px_120px_120px]">
        <TextField label="Name (for you)" name="name" defaultValue={defaults.name} placeholder="Festive smartwatch offer" />
        <div>
          <span className="label">Discount type</span>
          <input type="hidden" name="type" value={type} />
          <div className="flex rounded-lg border border-rule-strong bg-surface p-0.5" role="radiogroup" aria-label="Discount type">
            {[["percent", "% off"], ["flat", "Flat ₹ off"]].map(([v, l]) => (
              <button key={v} type="button" role="radio" aria-checked={type === v} onClick={() => setType(v)}
                className={`flex-1 rounded-md px-2 py-1.5 text-sm ${type === v ? "bg-ink font-medium text-white" : "text-ink-soft hover:text-ink"}`}>{l}</button>
            ))}
          </div>
        </div>
        <TextField key={`p${type}`} label="Pay online" name="prepaid" type="number" min={0} max={flat ? undefined : 100}
          defaultValue={flat === (defaults.type === "flat") ? defaults.prepaid : flat ? 100 : defaults.prepaid} hint={flat ? "₹ off each item" : "% off"} />
        <TextField key={`c${type}`} label="COD" name="cod" type="number" min={0} max={flat ? undefined : 100}
          defaultValue={flat === (defaults.type === "flat") ? defaults.cod : flat ? 0 : defaults.cod} hint={flat ? "₹ off each item" : "% off"} />
      </div>
      <div>
        <span className="label">Products</span>
        <ProductPicker storeId={storeId} name="products" initial={defaults.products ?? []} />
      </div>
    </>
  );
}
