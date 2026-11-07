// A store's own domain: /favicon.ico (asked for by browsers and Google) is the store's icon, never Growpefy's.
import type { LoaderFunctionArgs } from "@remix-run/node";
import { domainContext } from "~/lib/storefront-pages.server";
import { letterIconSvg, storeIcon } from "~/lib/store-icon";

export async function loader({ request }: LoaderFunctionArgs) {
  const ctx = await domainContext(request).catch(() => null);
  if (!ctx) return new Response(null, { status: 404 });
  const icon = storeIcon(ctx.store, (ctx.look?.data?.settings ?? null) as Record<string, unknown> | null);
  if (icon.startsWith("data:")) {
    return new Response(letterIconSvg(ctx.store.name, ctx.store.primaryColor || "#111827"), { headers: { "Content-Type": "image/svg+xml", "Cache-Control": "public, max-age=3600" } });
  }
  return new Response(null, { status: 302, headers: { Location: icon, "Cache-Control": "public, max-age=3600" } });
}
