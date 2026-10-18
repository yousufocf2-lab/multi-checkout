import type { ActionFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";
import { endSession } from "~/lib/auth.server";

export const loader = () => redirect("/dashboard");
export async function action({ request }: ActionFunctionArgs) {
  const fd = await request.formData().catch(() => null);
  return endSession(request, String(fd?.get("reason") ?? ""));
}
