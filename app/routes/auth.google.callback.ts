// Google sends the user back here after they pick their account.
import type { LoaderFunctionArgs } from "@remix-run/node";
import { finishSocial } from "~/lib/social-login.server";

export const loader = ({ request }: LoaderFunctionArgs) => finishSocial("google", request);
