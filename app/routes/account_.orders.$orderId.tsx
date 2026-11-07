// A store's own domain: one order in the shopper's account (www.brand.com/account/orders/<id>).
import type { LoaderFunctionArgs, MetaFunction } from "@remix-run/node";
import { AccountOrderPage } from "~/components/StoreAccount";
import { accountOrderLoader } from "~/lib/account-pages.server";
import { domainContext } from "~/lib/storefront-pages.server";

export const meta: MetaFunction<typeof loader> = ({ data }) => [{ title: `Order ${data?.order.name ?? ""} · ${data?.store.name ?? ""}` }, { name: "robots", content: "noindex" }];
export async function loader({ request, params }: LoaderFunctionArgs) {
  const ctx = await domainContext(request);
  if (!ctx) throw new Response("Not found", { status: 404 });
  return accountOrderLoader(ctx, request, params.orderId ?? "");
}
export default AccountOrderPage;
