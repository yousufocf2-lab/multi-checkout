// Shopper account on the store's website (growpefy.com/s/<store>/account): log in, profile, orders.
import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from "@remix-run/node";
import { AccountPage } from "~/components/StoreAccount";
import { accountAction, accountLoader } from "~/lib/account-pages.server";
import { previewContext } from "~/lib/storefront.server";

export const meta: MetaFunction<typeof loader> = ({ data }) => [{ title: `My account · ${data?.store.name ?? ""}` }, { name: "robots", content: "noindex" }];
export const loader = async ({ request, params }: LoaderFunctionArgs) => accountLoader(await previewContext(request, params.slug), request);
export const action = async ({ request, params }: ActionFunctionArgs) => accountAction(await previewContext(request, params.slug), request);
export default AccountPage;
