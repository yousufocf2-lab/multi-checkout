// Checkout diagnostics beacon: small events from the customer's browser (checkout page and payment page).
// Sent with navigator.sendBeacon as text/plain, so it works cross-site (store domain → growpefy.com) without preflight.
import type { ActionFunctionArgs } from "@remix-run/node";
import { and, eq, sql } from "drizzle-orm";
import { checkoutEvents, checkoutSessions, db, orders } from "~/db.server";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type" };
const ok = () => new Response(null, { status: 204, headers: cors });

export const TYPES = new Set(["load", "step", "otp_sent", "otp_error", "submit", "error", "to_pay", "hidden", "visible", "js_error", "pay_page", "pay_hidden", "pay_visible", "pay_back", "pay_error"]);
const MAX_PER_SESSION = 120;

export const loader = () => ok();

export async function action({ request }: ActionFunctionArgs) {
  if (request.method === "OPTIONS") return ok();
  let b: { s?: unknown; o?: unknown; e?: unknown; d?: unknown };
  try { b = JSON.parse((await request.text()).slice(0, 4000)); } catch { return ok(); }
  const type = String(b.e ?? "");
  if (!TYPES.has(type)) return ok();
  let sessionId = typeof b.s === "string" ? b.s.slice(0, 64) : "";
  const orderId = typeof b.o === "string" ? b.o.slice(0, 64) : null;
  try {
    let storeId: number | null = null;
    if (!sessionId && orderId) {
      const [o] = await db.select({ s: orders.sessionId, store: orders.storeId }).from(orders).where(eq(orders.id, orderId)).limit(1);
      sessionId = o?.s ?? ""; storeId = o?.store ?? null;
    }
    if (!sessionId) return ok();
    if (storeId == null) {
      const [s] = await db.select({ store: checkoutSessions.storeId }).from(checkoutSessions).where(eq(checkoutSessions.id, sessionId)).limit(1);
      storeId = s?.store ?? null;
    }
    if (storeId == null) return ok();
    const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(checkoutEvents).where(and(eq(checkoutEvents.sessionId, sessionId)));
    if (Number(n) >= MAX_PER_SESSION) return ok();
    const raw = b.d && typeof b.d === "object" ? JSON.stringify(b.d) : null;
    const data = raw ? (raw.length <= 1500 ? (b.d as Record<string, unknown>) : { text: raw.slice(0, 1500) }) : null;
    await db.insert(checkoutEvents).values({ sessionId, storeId, orderId, type, data });
  } catch (e) {
    console.error("[cx-event]", e instanceof Error ? e.message : e);
  }
  return ok();
}
