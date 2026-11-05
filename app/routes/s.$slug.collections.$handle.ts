// Growpefy Store storefront preview: category page (/collections/all = every product).
import type { LoaderFunctionArgs } from "@remix-run/node";
import { collectionPage } from "~/lib/storefront-pages.server";
import { previewContext } from "~/lib/storefront.server";

export const loader = async ({ request, params }: LoaderFunctionArgs) => collectionPage(await previewContext(request, params.slug), params.handle ?? "all");
