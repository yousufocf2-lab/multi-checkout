// One order in the shopper's account: status steps, tracking, note from the store.
import type { LoaderFunctionArgs, MetaFunction } from "@remix-run/node";
import { AccountOrderPage } from "~/components/StoreAccount";
import { accountOrderLoader } from "~/lib/account-pages.server";
import { previewContext } from "~/lib/storefront.server";

export const meta: MetaFunction<typeof loader> = ({ data }) => [{ title: `Order ${data?.order.name ?? ""} · ${data?.store.name ?? ""}` }, { name: "robots", content: "noindex" }];
export const loader = async ({ request, params }: LoaderFunctionArgs) => accountOrderLoader(await previewContext(request, params.slug), request, params.orderId ?? "");
export default AccountOrderPage;
