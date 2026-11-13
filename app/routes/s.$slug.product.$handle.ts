// Growpefy Store storefront preview: product page (/product/<handle>).
import { redirect, type ActionFunctionArgs, type LoaderFunctionArgs } from "@remix-run/node";
import { productPage } from "~/lib/storefront-pages.server";
import { previewContext } from "~/lib/storefront.server";
import { submitReview } from "~/lib/reviews.server";

export const loader = async ({ request, params }: LoaderFunctionArgs) => productPage(await previewContext(request, params.slug), params.handle ?? "", new URL(request.url).searchParams.get("review") ?? "");

export async function action({ request, params }: ActionFunctionArgs) {
  const ctx = await previewContext(request, params.slug);
  const st = await submitReview(ctx.store.id, params.handle ?? "", await request.formData());
  return redirect(`/s/${encodeURIComponent(params.slug ?? "")}/product/${encodeURIComponent(params.handle ?? "")}?review=${st === "approved" ? "published" : "received"}#reviews`);
}
