import type { ActionFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";
import { endSession } from "~/lib/auth.server";

export const loader = () => redirect("/dashboard");
export const action = ({ request }: ActionFunctionArgs) => endSession(request);
