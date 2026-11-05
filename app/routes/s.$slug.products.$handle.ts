// Growpefy Store storefront preview: product page.
import type { LoaderFunctionArgs } from "@remix-run/node";
import { productPage } from "~/lib/storefront-pages.server";
import { previewContext } from "~/lib/storefront.server";

export const loader = async ({ request, params }: LoaderFunctionArgs) => productPage(await previewContext(request, params.slug), params.handle ?? "");
