// Old store addresses (/dashboard/stores/8/settings) move to the store's code: /store/oscwxp-rb/settings.
import type { LoaderFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";
import { storeIdFromCode, storePath } from "~/lib/store-code";

export function loader({ request, params }: LoaderFunctionArgs) {
  const id = storeIdFromCode(params.id);
  if (!id) throw new Response("Store not found", { status: 404 });
  const u = new URL(request.url);
  const rest = params["*"] ? `/${params["*"]}` : "";
  return redirect(`${storePath(id)}${rest}${u.search}`, 301);
}
export const action = loader;
