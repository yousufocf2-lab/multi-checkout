// Abandoned cart link from WhatsApp: https://<checkout domain>/r/<checkout id> → that store's checkout.
// One fixed link base keeps a single Meta template working for every store.
import type { LoaderFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";
import { eq } from "drizzle-orm";
import { checkoutSessions, db, stores } from "~/db.server";
import { env } from "~/lib/env.server";
import { storeBaseUrl } from "~/lib/urls.server";

export async function loader({ params }: LoaderFunctionArgs) {
  const id = String(params.sessionId ?? "").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 64);
  const [row] = id
    ? await db.select({ id: checkoutSessions.id, store: { slug: stores.slug, checkoutDomain: stores.checkoutDomain } })
      .from(checkoutSessions).innerJoin(stores, eq(stores.id, checkoutSessions.storeId)).where(eq(checkoutSessions.id, id)).limit(1)
    : [];
  if (!row) throw redirect(env.appUrl);
  return redirect(`${storeBaseUrl(row.store)}/c/${row.id}?utm_source=whatsapp&utm_medium=recovery`);
}
