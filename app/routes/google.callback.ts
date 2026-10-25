// Google sends the user back here after "Allow". Saves the refresh token, then they pick the ad account.
// Store 0 = Growpefy's own ad account (Super admin → Marketing).
import type { LoaderFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";
import { requireStore, requireViewer } from "~/lib/auth.server";
import { exchangeCode, readState, revoke, saveConnection } from "~/lib/google-ads.server";
import { getMarketing, saveMarketing } from "~/lib/marketing.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const state = readState(url.searchParams.get("state"));
  if (!state) throw new Response("This Google sign-in link has expired. Go back to your dashboard and click Connect with Google again.", { status: 400 });
  const viewer = await requireViewer(request);
  // the same person who started must finish
  const who = viewer.role === "admin" ? "admin" : `u${viewer.userId}`;
  if (who !== state.w) throw new Response("Please finish connecting Google from the same login that started it.", { status: 403 });

  const platform = state.s === 0;
  if (platform && viewer.role !== "admin") throw new Response("Not allowed", { status: 403 });
  const store = platform ? null : await requireStore(viewer, state.s);
  const back = platform ? "/dashboard/marketing?ch=google" : `/dashboard/stores/${store!.id}/ads?ch=google`;

  const err = url.searchParams.get("error");
  if (err) throw redirect(`${back}&gerr=${encodeURIComponent(err === "access_denied" ? "Google access wasn't allowed." : err)}`);
  const code = url.searchParams.get("code");
  if (!code) throw redirect(`${back}&gerr=${encodeURIComponent("Google didn't send a sign-in code. Try again.")}`);
  try {
    const t = await exchangeCode(code);
    if (platform) {
      const old = (await getMarketing()).googleRefreshToken;
      if (old && old !== t.refreshToken) await revoke(old);
      await saveMarketing({ googleRefreshToken: t.refreshToken, googleEmail: t.email ?? undefined, googleCustomerId: undefined, googleLoginCustomerId: undefined, googleAccountName: undefined });
    } else {
      await saveConnection(store!.id, t.refreshToken, t.email);
    }
  } catch (e) {
    throw redirect(`${back}&gerr=${encodeURIComponent((e as Error).message)}`);
  }
  throw redirect(back);
}
