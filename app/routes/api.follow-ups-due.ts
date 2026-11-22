// Due follow-up reminders for the logged-in caller (polled by the yellow reminder), and the call attempt from it.
import { json, type ActionFunctionArgs, type LoaderFunctionArgs } from "@remix-run/node";
import { requireViewer } from "~/lib/auth.server";
import { dueFollowUps, followUpAttempt } from "~/lib/follow-up-due.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const viewer = await requireViewer(request);
  return json({ items: await dueFollowUps(viewer).catch(() => []) }, { headers: { "Cache-Control": "no-store" } });
}

export async function action({ request }: ActionFunctionArgs) {
  const viewer = await requireViewer(request);
  const fd = await request.formData();
  const r = await followUpAttempt(viewer, String(fd.get("orderId") ?? ""));
  return json(r, { status: "error" in r ? 400 : 200 });
}
