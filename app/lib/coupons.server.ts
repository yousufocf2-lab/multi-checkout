import { and, eq, sql } from "drizzle-orm";
import { coupons, db, type Coupon } from "~/db.server";
import type { CouponRule } from "./pricing";

export function toRule(c: Coupon): CouponRule {
  return {
    code: c.code,
    description: c.description,
    type: c.type === "flat" ? "flat" : "percent",
    value: c.value,
    minCartRupees: c.minCartRupees,
    maxDiscountRupees: c.maxDiscountRupees,
    stackable: c.stackable,
    paymentRestriction: (["prepaid", "cod"].includes(c.paymentRestriction) ? c.paymentRestriction : "any") as CouponRule["paymentRestriction"],
  };
}

export function couponProblem(c: Coupon, now = new Date()): string | null {
  if (!c.active) return "Ye coupon abhi active nahi hai";
  if (c.startsAt && c.startsAt > now) return "Ye coupon abhi shuru nahi hua";
  if (c.endsAt && c.endsAt < now) return "Ye coupon expire ho chuka hai";
  if (c.usageLimit != null && c.usedCount >= c.usageLimit) return "Is coupon ki limit khatam ho gayi";
  return null;
}

export async function findCoupon(storeId: number, code: string) {
  const clean = code.trim().toUpperCase();
  if (!clean) return { error: "Coupon code daalein" } as const;
  const [c] = await db
    .select()
    .from(coupons)
    .where(and(eq(coupons.storeId, storeId), eq(coupons.code, clean)))
    .limit(1);
  if (!c) return { error: "Invalid coupon code" } as const;
  const problem = couponProblem(c);
  if (problem) return { error: problem } as const;
  return { coupon: toRule(c) } as const;
}

export async function listVisibleCoupons(storeId: number) {
  const rows = await db
    .select()
    .from(coupons)
    .where(and(eq(coupons.storeId, storeId), eq(coupons.showInList, true), eq(coupons.active, true)));
  return rows.filter((c) => !couponProblem(c)).map(toRule);
}

export async function incrementCouponUse(storeId: number, code: string | null) {
  if (!code) return;
  await db
    .update(coupons)
    .set({ usedCount: sql`${coupons.usedCount} + 1` })
    .where(and(eq(coupons.storeId, storeId), eq(coupons.code, code)));
}
