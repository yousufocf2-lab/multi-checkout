// A store's own domain: /account opens the shopper account on the store's Growpefy address (like a hosted account page).
import { redirect, type LoaderFunctionArgs } from "@remix-run/node";
import { env } from "~/lib/env.server";
import { domainContext } from "~/lib/storefront-pages.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const ctx = await domainContext(request);
  if (!ctx) throw new Response("Not found", { status: 404 });
  const u = new URL(request.url);
  return redirect(`${env.appUrl.replace(/\/+$/, "")}/s/${ctx.store.slug}/account${u.search}`);
}
