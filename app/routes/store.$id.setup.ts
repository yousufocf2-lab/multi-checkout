// Home setup guide: the owner ticks a step off (or back on) by hand.
import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { eq } from "drizzle-orm";
import { db, stores } from "~/db.server";
import { requireStore, requireViewer } from "~/lib/auth.server";

const STEPS = new Set(["product", "theme", "logo", "payments", "domain", "order"]);

export async function action({ request, params }: ActionFunctionArgs) {
  const store = await requireStore(await requireViewer(request), params.id);
  const fd = await request.formData();
  const step = String(fd.get("step") ?? "");
  if (!STEPS.has(step)) return json({ ok: false }, { status: 400 });
  const done = new Set(store.setupDone ?? []);
  if (fd.get("done") === "1") done.add(step); else done.delete(step);
  await db.update(stores).set({ setupDone: [...done] }).where(eq(stores.id, store.id));
  return json({ ok: true });
}
