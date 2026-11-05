// Growpefy Store storefront preview (/s/<store>): home page.
import type { LoaderFunctionArgs } from "@remix-run/node";
import { homePage } from "~/lib/storefront-pages.server";
import { previewContext } from "~/lib/storefront.server";

export const loader = async ({ request, params }: LoaderFunctionArgs) => homePage(await previewContext(request, params.slug));
