// A store's own domain: an info page (policies, contact...).
import type { LoaderFunctionArgs } from "@remix-run/node";
import { domainContext, infoPage } from "~/lib/storefront-pages.server";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const ctx = await domainContext(request);
  if (!ctx) throw new Response("Not found", { status: 404 });
  return infoPage(ctx, params.handle ?? "");
}
