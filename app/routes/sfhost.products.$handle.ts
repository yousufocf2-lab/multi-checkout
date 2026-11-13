// A store's own domain: /products/all = every product. Old /products/<handle> links move to /product/<handle>.
import { redirect, type ActionFunctionArgs, type LoaderFunctionArgs } from "@remix-run/node";
import { collectionPage, domainContext } from "~/lib/storefront-pages.server";
import { submitReview } from "~/lib/reviews.server";
import { movedTo } from "~/lib/storefront-paths";

export async function loader({ request, params }: LoaderFunctionArgs) {
  if (params.handle !== "all") throw redirect(movedTo(request, `/product/${encodeURIComponent(params.handle ?? "")}`), 301);
  const ctx = await domainContext(request);
  if (!ctx) throw new Response("Not found", { status: 404 });
  return collectionPage(ctx, "all", request);
}

// Review forms on pages opened before the move
export async function action({ request, params }: ActionFunctionArgs) {
  const ctx = await domainContext(request);
  if (!ctx) throw new Response("Not found", { status: 404 });
  const st = await submitReview(ctx.store.id, params.handle ?? "", await request.formData());
  return redirect(`/product/${encodeURIComponent(params.handle ?? "")}?review=${st === "approved" ? "published" : "received"}#reviews`);
}
