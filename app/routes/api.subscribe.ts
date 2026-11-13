// Newsletter signup from a Growpefy Store website footer. Body: { s: store slug, email, p: page path }
import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { db, storeSubscribers } from "~/db.server";
import { storeBySlug } from "~/lib/storefront.server";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type" };
const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[a-z]{2,24}$/i;

export const loader = () => new Response(null, { status: 204, headers: cors });

export async function action({ request }: ActionFunctionArgs) {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  let b: Record<string, unknown> = {};
  try { b = JSON.parse((await request.text()).slice(0, 2000)) as Record<string, unknown>; } catch { return json({ error: "Please try again." }, { status: 400, headers: cors }); }
  const email = String(b.email ?? "").trim().toLowerCase();
  if (!EMAIL.test(email)) return json({ error: "Please enter a valid email address." }, { status: 400, headers: cors });
  const store = typeof b.s === "string" && b.s ? await storeBySlug(b.s.slice(0, 80)) : null;
  if (!store || !store.active) return json({ error: "Please try again." }, { status: 404, headers: cors });
  const source = typeof b.p === "string" ? b.p.split("?")[0].slice(0, 200) : null;
  await db.insert(storeSubscribers).values({ storeId: store.id, email, source }).onConflictDoNothing();
  return json({ ok: true }, { headers: cors });
}
