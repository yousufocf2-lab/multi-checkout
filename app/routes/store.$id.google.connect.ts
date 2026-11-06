// "Connect with Google": sends the store owner to Google's consent screen for Google Ads access.
import type { LoaderFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";
import { requireStore, requireViewer } from "~/lib/auth.server";
import { authUrl, googleAppReady, oauthState } from "~/lib/google-ads.server";
import { storePath } from "~/lib/store-code";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const viewer = await requireViewer(request);
  const store = await requireStore(viewer, params.id);
  if (!googleAppReady()) throw redirect(`${storePath(store.id)}/ads?ch=google`);
  const who = viewer.role === "admin" ? "admin" : `u${viewer.userId}`;
  throw redirect(authUrl(oauthState(store.id, who)));
}
