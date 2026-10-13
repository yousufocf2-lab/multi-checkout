import type { ActionFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";
import { logoutRedirect } from "~/lib/auth.server";

export const loader = () => redirect("/admin");
export const action = ({ request }: ActionFunctionArgs) => logoutRedirect(request);
