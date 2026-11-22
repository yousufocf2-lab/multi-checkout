// Follow-up reminders: an order whose follow-up time has come and that nobody has called since.
// Copying the number or calling from the reminder is a call attempt, and that moves the reminder on to the next one.
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db, orders, stores } from "~/db.server";
import type { Viewer } from "~/lib/auth.server";
import { recordAttempt } from "~/lib/order-call-events.server";
import { storePath } from "~/lib/store-code";

/** Which orders' reminders this login gets: a caller their own orders; the owner the store's unassigned ones. */
async function scope(viewer: Viewer) {
  if (viewer.role !== "owner") return null;
  if (viewer.member) {
    if (!viewer.member.perms.includes("confirm")) return null;
    return { who: eq(orders.assignedTo, viewer.member.id), memberId: viewer.member.id as number | null, by: viewer.member.name };
  }
  const own = await db.select({ id: stores.id }).from(stores).where(eq(stores.ownerId, viewer.userId));
  if (!own.length) return null;
  return { who: and(inArray(orders.storeId, own.map((s) => s.id)), isNull(orders.assignedTo)), memberId: null, by: viewer.name };
}

const due = sql`${orders.callStatus} = 'follow_up' and ${orders.status} in ('paid','cod_placed') and ${orders.followUpAt} <= now()
  and ${orders.followUpAt} >= now() - interval '7 days'
  and not exists (select 1 from order_call_events e where e.order_id = ${orders.id} and e.kind in ('manual','provider') and e.created_at >= ${orders.followUpAt})`;

export async function dueFollowUps(viewer: Viewer) {
  const sc = await scope(viewer);
  if (!sc) return [];
  const rows = await db.select({
    id: orders.id, storeId: orders.storeId, name: orders.shopifyOrderName, customer: orders.customer, total: orders.total, method: orders.paymentMethod,
    followUpAt: orders.followUpAt, note: orders.staffNote, items: orders.items,
  }).from(orders).where(and(sc.who, due)).orderBy(asc(orders.followUpAt)).limit(20);
  return rows.map((r) => ({
    id: r.id, name: r.name ?? `#${r.id.slice(-6).toUpperCase()}`,
    customer: `${r.customer.firstName ?? ""} ${r.customer.lastName ?? ""}`.trim() || "Customer", city: r.customer.city ?? "",
    total: r.total, cod: r.method === "cod", followUpAt: r.followUpAt!.toISOString(),
    note: (r.note ?? "").split("\n").filter(Boolean).pop() ?? "",
    items: r.items.map((l) => `${l.title}${l.quantity > 1 ? ` ×${l.quantity}` : ""}`).join(", "),
    link: `${storePath(r.storeId, "calls")}?tab=follow_up&q=${encodeURIComponent(r.name ?? r.id.slice(-6))}`,
  }));
}

/** Copy / call from the reminder: one call attempt, and the customer's number back. */
export async function followUpAttempt(viewer: Viewer, orderId: string) {
  const sc = await scope(viewer);
  if (!sc) return { error: "Not allowed." };
  const [o] = await db.select({ id: orders.id, storeId: orders.storeId, customer: orders.customer }).from(orders).where(and(eq(orders.id, orderId), sc.who)).limit(1);
  if (!o) return { error: "Order not found." };
  const phone = String(o.customer.phone ?? "").replace(/\D/g, "").slice(-10);
  if (phone.length !== 10) return { error: "No valid customer number." };
  await recordAttempt(o.storeId, o.id, sc.memberId, sc.by);
  return { phone };
}
