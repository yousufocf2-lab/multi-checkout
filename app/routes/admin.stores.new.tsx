import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { useActionData, useNavigation } from "@remix-run/react";
import { eq } from "drizzle-orm";
import { StoreForm } from "~/components/StoreForm";
import { db, stores } from "~/db.server";
import { requireAdmin } from "~/lib/auth.server";
import { parseStoreForm } from "~/lib/store-form.server";

export async function loader({ request }: LoaderFunctionArgs) {
  await requireAdmin(request);
  return null;
}

export async function action({ request }: ActionFunctionArgs) {
  await requireAdmin(request);
  const { data, errors } = parseStoreForm(await request.formData());
  if (!errors.slug) {
    const [dupe] = await db.select({ id: stores.id }).from(stores).where(eq(stores.slug, data.slug)).limit(1);
    if (dupe) errors.slug = "Ye slug already use ho raha hai";
  }
  if (Object.keys(errors).length) return json({ errors }, { status: 400 });
  const [created] = await db.insert(stores).values(data).returning({ id: stores.id });
  return redirect(`/admin/stores/${created.id}?tab=install`);
}

export default function NewStore() {
  const data = useActionData<typeof action>();
  const nav = useNavigation();
  return (
    <div className="max-w-3xl">
      <h1 className="mb-5 text-xl font-bold">Connect a Shopify store</h1>
      <StoreForm errors={data?.errors} submitLabel="Connect store" busy={nav.state === "submitting"} />
    </div>
  );
}
