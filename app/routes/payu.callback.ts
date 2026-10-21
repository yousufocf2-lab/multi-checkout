import type { ActionFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";
import { handlePayuReturn } from "~/lib/payu-flow.server";

export const loader = () => redirect("/");

/** PayU posts here for both success (surl) and failure (furl). */
export async function action({ request }: ActionFunctionArgs) {
  const fd = await request.formData();
  const f: Record<string, string> = {};
  fd.forEach((v, k) => { if (typeof v === "string") f[k] = v; });
  const id = await handlePayuReturn(f, "callback");
  return redirect(id ? `/order/${id}` : "/");
}
