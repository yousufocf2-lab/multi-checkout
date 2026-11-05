// Growpefy Store storefront preview: cart -> Growpefy checkout.
import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { startCheckout } from "~/lib/storefront-pages.server";
import { previewContext } from "~/lib/storefront.server";

export const loader = () => json({ error: "POST only" }, { status: 405 });
export const action = async ({ request, params }: ActionFunctionArgs) => startCheckout(request, await previewContext(request, params.slug));
