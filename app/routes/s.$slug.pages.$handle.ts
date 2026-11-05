// Growpefy Store storefront preview: an info page (policies, contact...).
import type { LoaderFunctionArgs } from "@remix-run/node";
import { infoPage } from "~/lib/storefront-pages.server";
import { previewContext } from "~/lib/storefront.server";

export const loader = async ({ request, params }: LoaderFunctionArgs) => infoPage(await previewContext(request, params.slug), params.handle ?? "");
