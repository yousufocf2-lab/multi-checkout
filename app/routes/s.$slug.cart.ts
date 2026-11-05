// Growpefy Store storefront preview: cart page (the cart itself lives in the shopper's browser).
import type { LoaderFunctionArgs } from "@remix-run/node";
import { cartPage } from "~/lib/storefront-pages.server";
import { previewContext } from "~/lib/storefront.server";

export const loader = async ({ request, params }: LoaderFunctionArgs) => cartPage(await previewContext(request, params.slug));
