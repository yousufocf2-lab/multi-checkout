// Growpefy Store storefront: cart -> checkout. The checkout connection for Growpefy Store orders comes next.
import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { previewContext } from "~/lib/storefront.server";

export const loader = () => json({ error: "POST only" }, { status: 405 });

export async function action({ request, params }: ActionFunctionArgs) {
  await previewContext(request, params.slug);
  return json({ error: "Checkout for this store opens soon. This is a preview of the new website." });
}
