// Growpefy Store preview: searchPage (website search).
import type { LoaderFunctionArgs } from "@remix-run/node";
import { searchPage } from "~/lib/storefront-pages.server";
import { previewContext } from "~/lib/storefront.server";

export const loader = async ({ request, params }: LoaderFunctionArgs) => searchPage(await previewContext(request, params.slug), request);
