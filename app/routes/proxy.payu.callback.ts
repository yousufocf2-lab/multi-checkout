import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";
import { getOrderWithStore } from "~/lib/orders.server";
import { handlePayuReturn } from "~/lib/payu-flow.server";
import { storeBaseUrl } from "~/lib/urls.server";

/**
 * PayU's success / failure URL on the store's website (https://<store>/apps/growpefy/payu/callback),
 * forwarded here by Shopify App Proxy. PayU's own hash proves the result; the order page re-checks with PayU anyway.
 */
export async function action({ request }: ActionFunctionArgs) {
  const url = new URL(request.url);
  const f: Record<string, string> = {};
  try { (await request.formData()).forEach((v, k) => { if (typeof v === "string") f[k] = v; }); } catch { /* empty body */ }
  const id = (await handlePayuReturn(f, "proxy-callback")) ?? url.searchParams.get("o");
  return toOrder(id);
}

/** If the post body gets lost, the order id in the URL still brings the customer to the order page (which checks PayU). */
export const loader = ({ request }: LoaderFunctionArgs) => toOrder(new URL(request.url).searchParams.get("o"));

async function toOrder(id: string | null) {
  const row = id ? await getOrderWithStore(id) : null;
  if (!row) return redirect("/");
  return redirect(`${storeBaseUrl(row.store)}/order/${row.order.id}`);
}
