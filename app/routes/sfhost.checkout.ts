// A store's own domain: cart -> Growpefy checkout.
import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { domainContext, startCheckout } from "~/lib/storefront-pages.server";

export const loader = () => json({ error: "POST only" }, { status: 405 });

export async function action({ request }: ActionFunctionArgs) {
  const ctx = await domainContext(request);
  if (!ctx) return json({ error: "Store not found" }, { status: 404 });
  return startCheckout(request, ctx);
}
