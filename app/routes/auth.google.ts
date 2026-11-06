// Start "Continue with Google".
import type { LoaderFunctionArgs } from "@remix-run/node";
import { startSocial } from "~/lib/social-login.server";

export const loader = ({ request }: LoaderFunctionArgs) => startSocial("google", request);
