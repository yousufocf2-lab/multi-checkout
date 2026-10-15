import { redirect } from "@remix-run/node";
import { env } from "./env.server";
import { isAppHost, sameUrlOn } from "./urls.server";

/** Dashboard pages only live on the platform domain, never on a store's checkout domain. */
export function requireAppHost(request: Request) {
  if (!isAppHost(request)) throw redirect(sameUrlOn(env.appUrl, request));
}
