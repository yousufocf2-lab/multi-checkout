import type { LoaderFunctionArgs } from "@remix-run/node";
import { requireStore, requireViewer } from "~/lib/auth.server";
import { catalogAllowed } from "~/lib/catalog.server";
import type { ThemeData } from "~/db.server";
import { presetById } from "~/lib/theme-presets";
import { themeRow } from "~/lib/themes.server";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const viewer = await requireViewer(request);
  const store = await requireStore(viewer, params.id);
  if (!catalogAllowed(viewer, store)) throw new Response("Not found", { status: 404 });
  const url = new URL(request.url);
  if (url.searchParams.get("published") !== "1") throw new Response("Download the published theme from its actions menu.", { status: 400 });
  const published = (await themeRow(store.id))?.live;
  if (!published) throw new Response("No theme has been published yet.", { status: 404 });
  const data: ThemeData = published;
  const name = presetById(String(published.settings.preset ?? ""))?.name ?? "Published theme";
  const safeName = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48) || "growpefy-theme";
  return new Response(JSON.stringify({ format: "growpefy-theme", version: 1, name, data }, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="${safeName}.growpefy-theme.json"`,
      "Cache-Control": "no-store",
    },
  });
}
