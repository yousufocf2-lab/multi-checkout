import type { LoaderFunctionArgs, MetaFunction } from "@remix-run/node";
import { redirect } from "@remix-run/node";
import { Link } from "@remix-run/react";
import { eq } from "drizzle-orm";
import { db, stores } from "~/db.server";
import { isAppHost, requestHost } from "~/lib/urls.server";

export const meta: MetaFunction = () => [{ title: "Checkout" }];

/** checkout.brand.com/ -> brand storefront; app domain -> status page. */
export async function loader({ request }: LoaderFunctionArgs) {
  if (isAppHost(request)) return null;
  const [store] = await db
    .select({ url: stores.storefrontUrl })
    .from(stores)
    .where(eq(stores.checkoutDomain, requestHost(request)))
    .limit(1);
  if (store) throw redirect(store.url);
  return null;
}

export default function Index() {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center p-6 text-center">
      <p className="text-xl font-semibold">Checkout is running ✓</p>
      <Link to="/admin" className="mt-4 text-sm text-gray-500 underline">Admin</Link>
    </main>
  );
}
