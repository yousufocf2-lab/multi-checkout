// Growpefy Store preview: searchSuggest (website search).
import type { LoaderFunctionArgs } from "@remix-run/node";
import { searchSuggest } from "~/lib/storefront-pages.server";
import { previewContext } from "~/lib/storefront.server";

export const loader = async ({ request, params }: LoaderFunctionArgs) => searchSuggest(await previewContext(request, params.slug), request);
