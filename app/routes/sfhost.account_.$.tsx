// A store's own domain: /account/... (e.g. an order link) opens on the store's Growpefy address.
import { redirect, type LoaderFunctionArgs } from "@remix-run/node";
import { env } from "~/lib/env.server";
import { domainContext } from "~/lib/storefront-pages.server";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const ctx = await domainContext(request);
  if (!ctx) throw new Response("Not found", { status: 404 });
  const rest = String(params["*"] ?? "").replace(/[^\w/-]/g, "");
  return redirect(`${env.appUrl.replace(/\/+$/, "")}/s/${ctx.store.slug}/account/${rest}`);
}
