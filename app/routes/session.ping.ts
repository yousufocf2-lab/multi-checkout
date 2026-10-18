import type { ActionFunctionArgs } from "@remix-run/node";
import { touchSession } from "~/lib/auth.server";

/** Keeps the dashboard session alive while the user is active (called at most once a minute). */
export const loader = () => new Response(null, { status: 405 });
export async function action({ request }: ActionFunctionArgs) {
  const cookie = await touchSession(request);
  if (!cookie) return new Response(null, { status: 401 });
  return new Response(null, { status: 204, headers: { "Set-Cookie": cookie, "Cache-Control": "no-store" } });
}
