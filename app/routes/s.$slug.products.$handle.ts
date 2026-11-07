// Growpefy Store storefront preview: /products/all = every product. Old /products/<handle> links move to /product/<handle>.
import { redirect, type ActionFunctionArgs, type LoaderFunctionArgs } from "@remix-run/node";
import { collectionPage } from "~/lib/storefront-pages.server";
import { previewContext } from "~/lib/storefront.server";
import { submitReview } from "~/lib/reviews.server";
import { movedTo } from "~/lib/storefront-paths";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  if (params.handle === "all") return collectionPage(await previewContext(request, params.slug), "all");
  throw redirect(movedTo(request, `/s/${encodeURIComponent(params.slug ?? "")}/product/${encodeURIComponent(params.handle ?? "")}`), 301);
};

// Review forms on pages opened before the move
export async function action({ request, params }: ActionFunctionArgs) {
  const ctx = await previewContext(request, params.slug);
  await submitReview(ctx.store.id, params.handle ?? "", await request.formData());
  return redirect(`/s/${encodeURIComponent(params.slug ?? "")}/product/${encodeURIComponent(params.handle ?? "")}?review=received#reviews`);
}
