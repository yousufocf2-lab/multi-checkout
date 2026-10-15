import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { Form, useActionData, useLoaderData } from "@remix-run/react";
import { and, asc, eq, ne } from "drizzle-orm";
import { StoreSettingsForm } from "~/components/StoreSettingsForm";
import { Notice, Section, SelectField, SubmitButton } from "~/components/ui";
import { db, stores, users } from "~/db.server";
import { requireStore, requireViewer } from "~/lib/auth.server";
import { clearTokenCache } from "~/lib/shopify.server";
import { parseStoreForm } from "~/lib/store-form.server";
import { storeForClient } from "~/lib/store-view.server";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const viewer = await requireViewer(request);
  const store = await requireStore(viewer, params.id);
  const owners = viewer.role === "admin" ? await db.select({ id: users.id, name: users.name, email: users.email }).from(users).orderBy(asc(users.name)) : null;
  return json({ store: storeForClient(store), owners });
}

export async function action({ request, params }: ActionFunctionArgs) {
  const viewer = await requireViewer(request);
  const store = await requireStore(viewer, params.id);
  const fd = await request.formData();
  const intent = fd.get("intent");

  if (intent === "assignOwner" && viewer.role === "admin") {
    const id = Number(fd.get("ownerId")) || null;
    await db.update(stores).set({ ownerId: id }).where(eq(stores.id, store.id));
    return json({ ok: "Owner updated", errors: null });
  }
  if (intent === "deleteStore") {
    if (String(fd.get("confirm") ?? "").trim() !== store.slug) return json({ ok: null, errors: { confirm: `Type ${store.slug} to confirm` } }, { status: 400 });
    await db.delete(stores).where(eq(stores.id, store.id));
    return redirect("/dashboard/stores");
  }

  const { data, errors } = parseStoreForm(fd, store);
  if (!errors.slug) {
    const [d] = await db.select({ id: stores.id }).from(stores).where(and(eq(stores.slug, data.slug), ne(stores.id, store.id))).limit(1);
    if (d) errors.slug = "This store ID is taken. Try another.";
  }
  if (data.checkoutDomain && !errors.checkoutDomain) {
    const [d] = await db.select({ id: stores.id }).from(stores).where(and(eq(stores.checkoutDomain, data.checkoutDomain), ne(stores.id, store.id))).limit(1);
    if (d) errors.checkoutDomain = "This domain is already used by another store";
  }
  if (Object.keys(errors).length) return json({ ok: null, errors }, { status: 400 });
  await db.update(stores).set(data).where(eq(stores.id, store.id));
  clearTokenCache(store.id);
  return json({ ok: "Settings saved", errors: null });
}

export default function StoreSettings() {
  const { store, owners } = useLoaderData<typeof loader>();
  const res = useActionData<typeof action>();
  const errors = (res?.errors ?? {}) as Record<string, string>;
  return (
    <div className="max-w-3xl space-y-5">
      {res?.ok && <Notice tone="success">{res.ok}</Notice>}
      {Object.keys(errors).length > 0 && !errors.confirm && <Notice tone="error">Fix the highlighted fields and save again.</Notice>}
      <StoreSettingsForm key={JSON.stringify(store)} values={store} errors={errors} submitLabel="Save settings" />

      {owners && (
        <Section title="Store owner" description="The owner can log in and manage this store.">
          <Form method="post" className="flex flex-wrap items-end gap-3">
            <SelectField label="Owner" name="ownerId" defaultValue={store.ownerId ?? ""} wrap="min-w-[240px] flex-1">
              <option value="">No owner (admin only)</option>
              {owners.map((o) => <option key={o.id} value={o.id}>{o.name} ({o.email})</option>)}
            </SelectField>
            <SubmitButton intent="assignOwner" className="btn-secondary" busyText="Saving">Save owner</SubmitButton>
          </Form>
        </Section>
      )}

      <Section title="Delete store" description="Removes the store, its coupons, discounts and order history from this checkout. Orders already in Shopify stay there.">
        <Form method="post" className="flex flex-wrap items-end gap-3" onSubmit={(e) => { if (!window.confirm(`Delete ${store.name}? This can't be undone.`)) e.preventDefault(); }}>
          <label className="block min-w-[240px] flex-1">
            <span className="label">Type <b className="text-ink">{store.slug}</b> to confirm</span>
            <input name="confirm" className="input" autoComplete="off" />
            {errors.confirm && <span className="error-text">{errors.confirm}</span>}
          </label>
          <SubmitButton intent="deleteStore" className="btn border border-red-200 bg-white text-bad hover:bg-red-50" busyText="Deleting">Delete store</SubmitButton>
        </Form>
      </Section>
    </div>
  );
}
