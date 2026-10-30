import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { Form, useActionData, useLoaderData } from "@remix-run/react";
import { and, asc, eq, ne } from "drizzle-orm";
import { StoreSettingsForm } from "~/components/StoreSettingsForm";
import { Notice, Section, SelectField, SubmitButton } from "~/components/ui";
import { db, stores, users } from "~/db.server";
import { requireStore, requireViewer } from "~/lib/auth.server";
import { clearTokenCache } from "~/lib/platform.server";
import { parseStoreForm } from "~/lib/store-form.server";
import { storeForClient } from "~/lib/store-view.server";
import { forgetProxyCheck } from "~/lib/proxy-checkout.server";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const viewer = await requireViewer(request);
  const store = await requireStore(viewer, params.id);
  const owners = viewer.role === "admin" ? await db.select({ id: users.id, name: users.name, email: users.email }).from(users).orderBy(asc(users.name)) : null;
  // Admin-only fields (storeForClient leaves them out so they never reach the store owner)
  const profit = viewer.role === "admin" ? { dropship: store.dropshipEnabled, shareBps: store.profitShareBps } : null;
  return json({ store: storeForClient(store), owners, isAdmin: viewer.role === "admin", profit });
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
  if (intent === "profitDashboard" && viewer.role !== "admin") {
    throw new Response("Forbidden", { status: 403 });
  }
  if (intent === "profitDashboard") {
    const enabled = fd.get("profitEnabled") === "on";
    const pct = Number(fd.get("profitSharePct"));
    if (!store.dropshipEnabled && (!Number.isFinite(pct) || pct < 0 || pct > 100)) {
      return json({ ok: null, errors: { profitSharePct: "Enter a share from 0 to 100 percent." } }, { status: 400 });
    }
    await db.update(stores).set({
      profitEnabled: enabled,
      ...(!store.dropshipEnabled ? { profitShareBps: Math.round(pct * 100) } : {}),
      profitEnabledAt: enabled ? (store.profitEnabledAt ?? new Date()) : store.profitEnabledAt,
    }).where(eq(stores.id, store.id));
    return json({ ok: enabled ? "Sales and profit dashboard enabled for this store." : "Sales and profit dashboard disabled for this store.", errors: null });
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
  forgetProxyCheck(store.id); // a new Client secret or the toggle: check the App Proxy again
  return json({ ok: "Settings saved", errors: null });
}

export default function StoreSettings() {
  const { store, owners, isAdmin, profit } = useLoaderData<typeof loader>();
  const res = useActionData<typeof action>();
  const errors = (res?.errors ?? {}) as Record<string, string>;
  return (
    <div className="max-w-3xl space-y-5">
      {res?.ok && <Notice tone="success">{res.ok}</Notice>}
      {Object.keys(errors).length > 0 && !errors.confirm && <Notice tone="error">Fix the highlighted fields and save again.</Notice>}
      <StoreSettingsForm key={JSON.stringify(store)} values={store} errors={errors} submitLabel="Save settings" isAdmin={isAdmin} />

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

      {isAdmin && profit && (
        <Section title="Sales and profit dashboard" description="Off by default. When enabled, the store owner can see the available checkout orders, revenue, PayU settlements, ad costs and profit share.">
          <Form method="post" className="space-y-4">
            <label className="flex cursor-pointer items-start gap-2 text-sm">
              <input type="checkbox" name="profitEnabled" defaultChecked={store.profitEnabled} className="mt-0.5 h-4 w-4" />
              <span><b>Enable dashboard for this store</b><span className="block text-xs text-ink-faint">When off, the store owner only sees the regular Growpefy checkout dashboard and its orders.</span></span>
            </label>
            {profit.dropship
              ? <p className="text-sm text-ink-soft">Dropshipping is enabled for this store. Its Growpefy share is fixed at <b>20%</b>; dropshipping applies only to eligible prepaid orders.</p>
              : <label className="block max-w-xs"><span className="label">Growpefy profit share (%)</span><input name="profitSharePct" type="number" min="0" max="100" step="0.01" className="input" defaultValue={(profit.shareBps / 100).toFixed(2)} />{errors.profitSharePct && <span className="error-text">{errors.profitSharePct}</span>}</label>}
            <SubmitButton intent="profitDashboard" className="btn-primary" busyText="Saving">Save dashboard access</SubmitButton>
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
