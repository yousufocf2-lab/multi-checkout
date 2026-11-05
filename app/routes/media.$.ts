// Public store media (photos, video clips) from the private bucket: /media/stores/<id>/...
import type { LoaderFunctionArgs } from "@remix-run/node";
import { serveMedia } from "~/lib/media.server";

export async function loader({ request, params }: LoaderFunctionArgs) {
  return serveMedia(params["*"] ?? "", request.headers.get("range"));
}
