// A store's own domain: product page.
import { redirect, type ActionFunctionArgs, type LoaderFunctionArgs } from "@remix-run/node";
import { domainContext, productPage } from "~/lib/storefront-pages.server";
import { submitReview } from "~/lib/reviews.server";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const ctx = await domainContext(request);
  if (!ctx) throw new Response("Not found", { status: 404 });
  return productPage(ctx, params.handle ?? "", new URL(request.url).searchParams.get("review") === "received");
}

export async function action({ request, params }: ActionFunctionArgs) {
  const ctx = await domainContext(request);
  if (!ctx) throw new Response("Not found", { status: 404 });
  await submitReview(ctx.store.id, params.handle ?? "", await request.formData());
  return redirect(`/products/${encodeURIComponent(params.handle ?? "")}?review=received#reviews`);
}
