import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { Link, useActionData, useLoaderData } from "@remix-run/react";
import { eq } from "drizzle-orm";
import { StoreSettingsForm } from "~/components/StoreSettingsForm";
import { Notice, PageHeader } from "~/components/ui";
import { db, stores, users } from "~/db.server";
import { requireViewer } from "~/lib/auth.server";
import { parseStoreForm } from "~/lib/store-form.server";

/** Websites the owner gave at signup that aren't connected yet: the first one pre-fills the form. */
export async function loader({ request }: LoaderFunctionArgs) {
  const viewer = await requireViewer(request);
  if (viewer.role !== "owner") return json({ suggestions: [], brand: "" });
  const [u] = await db.select({ signup: users.signup, name: users.name }).from(users).where(eq(users.id, viewer.userId)).limit(1);
  const mine = await db.select({ url: stores.storefrontUrl }).from(stores).where(eq(stores.ownerId, viewer.userId));
  const host = (x: string) => x.replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "").toLowerCase();
  const used = new Set(mine.map((m) => host(m.url)));
  const suggestions = (u?.signup?.websites ?? []).filter((w) => !used.has(host(w.url))).map((w) => ({ url: w.url, platform: w.platform }));
  return json({ suggestions, brand: mine.length ? "" : u?.name ?? "" });
}

export async function action({ request }: ActionFunctionArgs) {
  const viewer = await requireViewer(request);
  const { data, errors } = parseStoreForm(await request.formData());
  if (!errors.slug) {
    const [d] = await db.select({ id: stores.id }).from(stores).where(eq(stores.slug, data.slug)).limit(1);
    if (d) errors.slug = "This store ID is taken. Try another.";
  }
  if (data.checkoutDomain && !errors.checkoutDomain) {
    const [d] = await db.select({ id: stores.id }).from(stores).where(eq(stores.checkoutDomain, data.checkoutDomain)).limit(1);
    if (d) errors.checkoutDomain = "This domain is already used by another store";
  }
  if (Object.keys(errors).length) return json({ errors }, { status: 400 });
  const [created] = await db
    .insert(stores)
    .values({ ...data, active: true, ownerId: viewer.role === "owner" ? viewer.userId : null })
    .returning({ id: stores.id });
  return redirect(`/dashboard/stores/${created.id}/install?created=1`);
}

export default function NewStore() {
  const data = useActionData<typeof action>();
  const { suggestions, brand } = useLoaderData<typeof loader>();
  const first = suggestions[0];
  const values = first ? {
    storefrontUrl: first.url, name: brand || undefined,
    platform: first.platform === "woocommerce" ? "woocommerce" as const : "shopify" as const,
    slug: brand ? brand.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) : undefined,
  } : undefined;
  return (
    <div className="max-w-3xl">
      <Link to="/dashboard/stores" className="text-sm text-ink-soft hover:text-ink">Stores</Link>
      <PageHeader title="Connect a store" description="Fill in what you have now. You can add payment gateways, Meta ads and branding later." />
      {data?.errors && <div className="mb-5"><Notice tone="error">Fix the highlighted fields to continue.</Notice></div>}
      <StoreSettingsForm values={values} errors={data?.errors} submitLabel="Save and continue" isNew siteSuggestions={suggestions} />
    </div>
  );
}
