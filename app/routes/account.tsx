// A store's own domain: shopper account at www.brand.com/account (not rewritten to /sfhost, so the page works fully).
import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from "@remix-run/node";
import { AccountPage } from "~/components/StoreAccount";
import { accountAction, accountLoader } from "~/lib/account-pages.server";
import { domainContext } from "~/lib/storefront-pages.server";

const ctxOf = async (request: Request) => {
  const ctx = await domainContext(request);
  if (!ctx) throw new Response("Not found", { status: 404 });
  return ctx;
};
export const meta: MetaFunction<typeof loader> = ({ data }) => [{ title: `My account · ${data?.store.name ?? ""}` }, { name: "robots", content: "noindex" }];
export const loader = async ({ request }: LoaderFunctionArgs) => accountLoader(await ctxOf(request), request);
export const action = async ({ request }: ActionFunctionArgs) => accountAction(await ctxOf(request), request);
export default AccountPage;
