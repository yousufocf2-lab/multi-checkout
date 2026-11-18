// Railway Usage (hosting bills): super admin writes them, stores marked "usage billing" read them.
import { and, asc, desc, eq, ne } from "drizzle-orm";
import { db, stores, usageBills, type UsageLine } from "~/db.server";
import { lineAmount, resourceOf } from "./usage-bill";

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export async function usageStores() {
  return db.select({ id: stores.id, name: stores.name, usageBilling: stores.usageBilling }).from(stores).orderBy(asc(stores.name));
}

export async function setUsageBilling(storeId: number, on: boolean) {
  await db.update(stores).set({ usageBilling: on }).where(eq(stores.id, storeId));
}

export async function billsFor(storeId: number, opts: { published?: boolean } = {}) {
  return db.select().from(usageBills)
    .where(and(eq(usageBills.storeId, storeId), opts.published ? ne(usageBills.status, "draft") : undefined))
    .orderBy(desc(usageBills.periodStart), desc(usageBills.id));
}

/** Rows from the editor: quantity, price per unit (₹) and, optionally, a typed amount (₹). */
export function readLines(raw: string): UsageLine[] {
  let list: unknown = [];
  try { list = JSON.parse(raw || "[]"); } catch { /* none */ }
  if (!Array.isArray(list)) return [];
  return list.slice(0, 40).flatMap((x) => {
    const r = x as { key?: unknown; label?: unknown; unit?: unknown; qty?: unknown; rate?: unknown; amount?: unknown };
    const key = String(r.key ?? "").slice(0, 40) || "other";
    const res = resourceOf(key);
    const qty = Number(r.qty) || 0;
    const ratePaise = Math.round((Number(r.rate) || 0) * 100);
    const typed = r.amount === "" || r.amount == null ? null : Math.round(Number(r.amount) * 100);
    const amountPaise = typed != null && Number.isFinite(typed) ? typed : lineAmount(qty, ratePaise);
    if (!qty && !ratePaise && !amountPaise) return [];
    return [{ key, label: String(r.label ?? res.label).slice(0, 80) || res.label, unit: String(r.unit ?? res.unit).slice(0, 40) || res.unit, qty, ratePaise, amountPaise }];
  });
}

export async function saveBill(input: { id?: number; storeId: number; periodStart: string; periodEnd: string; lines: UsageLine[]; status: string; dueDate: string; note: string }) {
  if (!DATE.test(input.periodStart) || !DATE.test(input.periodEnd)) return { error: "Pick the billing period dates." };
  if (input.periodEnd < input.periodStart) return { error: "The period ends before it starts." };
  const status = (["draft", "due", "paid"] as const).find((s) => s === input.status) ?? "draft";
  const values = {
    storeId: input.storeId, periodStart: input.periodStart, periodEnd: input.periodEnd, lines: input.lines, status,
    dueDate: DATE.test(input.dueDate) ? input.dueDate : null, note: input.note.trim().slice(0, 500) || null,
    paidAt: status === "paid" ? new Date() : null, updatedAt: new Date(),
  };
  if (input.id) {
    const [cur] = await db.select().from(usageBills).where(and(eq(usageBills.id, input.id), eq(usageBills.storeId, input.storeId))).limit(1);
    if (!cur) return { error: "Bill not found." };
    await db.update(usageBills).set({ ...values, paidAt: status === "paid" ? cur.paidAt ?? new Date() : null }).where(eq(usageBills.id, cur.id));
    return { id: cur.id };
  }
  const [row] = await db.insert(usageBills).values(values).returning({ id: usageBills.id });
  return { id: row.id };
}

export async function deleteBill(storeId: number, id: number) {
  await db.delete(usageBills).where(and(eq(usageBills.id, id), eq(usageBills.storeId, storeId)));
}
