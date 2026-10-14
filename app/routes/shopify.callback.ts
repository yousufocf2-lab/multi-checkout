import type { LoaderFunctionArgs } from "@remix-run/node";
import { finishOAuth } from "~/lib/shopify-oauth.server";

export const loader = ({ request }: LoaderFunctionArgs) => finishOAuth(request);