import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { Link, useActionData } from "@remix-run/react";
import { eq } from "drizzle-orm";
import { StoreSettingsForm } from "~/components/StoreSettingsForm";
import { Notice, PageHeader } from "~/components/ui";
import { db, stores } from "~/db.server";
import { requireViewer } from "~/lib/auth.server";
import { parseStoreForm } from "~/lib/store-form.server";

export async function loader({ request }: LoaderFunctionArgs) {
  await requireViewer(request);
  return null;
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
  return (
    <div className="max-w-3xl">
      <Link to="/dashboard/stores" className="text-sm text-ink-soft hover:text-ink">Stores</Link>
      <PageHeader title="Connect a store" description="Fill in what you have now. You can add payment gateways, Meta ads and branding later." />
      {data?.errors && <div className="mb-5"><Notice tone="error">Fix the highlighted fields to continue.</Notice></div>}
      <StoreSettingsForm errors={data?.errors} submitLabel="Save and continue" isNew />
    </div>
  );
}
