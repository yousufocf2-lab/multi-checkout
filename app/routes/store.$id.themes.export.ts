import type { LoaderFunctionArgs } from "@remix-run/node";
import { requireStore, requireViewer } from "~/lib/auth.server";
import { catalogAllowed } from "~/lib/catalog.server";
import type { ThemeData } from "~/db.server";
import { presetById } from "~/lib/theme-presets";
import { editorState, getThemeCopy } from "~/lib/themes.server";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const viewer = await requireViewer(request);
  const store = await requireStore(viewer, params.id);
  if (!catalogAllowed(viewer, store)) throw new Response("Not found", { status: 404 });
  const url = new URL(request.url);
  const copyId = Number(url.searchParams.get("copy"));
  let name: string;
  let data: ThemeData;
  if (Number.isSafeInteger(copyId) && copyId > 0) {
    const copy = await getThemeCopy(store.id, copyId);
    if (!copy) throw new Response("Theme not found", { status: 404 });
    name = copy.name;
    data = copy.data;
  } else {
    const state = await editorState(store.id);
    data = state.data;
    name = presetById(String(state.data.settings.preset ?? ""))?.name ?? "Growpefy design";
  }
  const safeName = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48) || "growpefy-theme";
  return new Response(JSON.stringify({ format: "growpefy-theme", version: 1, name, data }, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="${safeName}.growpefy-theme.json"`,
      "Cache-Control": "no-store",
    },
  });
}
