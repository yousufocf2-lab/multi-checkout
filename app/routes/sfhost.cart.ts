// A store's own domain: cart page.
import type { LoaderFunctionArgs } from "@remix-run/node";
import { cartPage, domainContext } from "~/lib/storefront-pages.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const ctx = await domainContext(request);
  if (!ctx) throw new Response("Not found", { status: 404 });
  return cartPage(ctx);
}
