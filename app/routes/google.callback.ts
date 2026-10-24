// Google sends the store owner back here after "Allow". Saves the refresh token, then the owner picks the ad account.
import type { LoaderFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";
import { requireStore, requireViewer } from "~/lib/auth.server";
import { exchangeCode, readState, saveConnection } from "~/lib/google-ads.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const state = readState(url.searchParams.get("state"));
  if (!state) throw new Response("This Google sign-in link has expired. Go back to your dashboard and click Connect with Google again.", { status: 400 });
  const viewer = await requireViewer(request);
  // the same person who started must finish
  const who = viewer.role === "admin" ? "admin" : `u${viewer.userId}`;
  if (who !== state.w) throw new Response("Please finish connecting Google from the same login that started it.", { status: 403 });
  const store = await requireStore(viewer, state.s);
  const back = `/dashboard/stores/${store.id}/ads?ch=google`;
  const err = url.searchParams.get("error");
  if (err) throw redirect(`${back}&gerr=${encodeURIComponent(err === "access_denied" ? "Google access wasn't allowed." : err)}`);
  const code = url.searchParams.get("code");
  if (!code) throw redirect(`${back}&gerr=${encodeURIComponent("Google didn't send a sign-in code. Try again.")}`);
  try {
    const t = await exchangeCode(code);
    await saveConnection(store.id, t.refreshToken, t.email);
  } catch (e) {
    throw redirect(`${back}&gerr=${encodeURIComponent((e as Error).message)}`);
  }
  throw redirect(back);
}
