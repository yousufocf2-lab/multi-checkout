import { sql } from "drizzle-orm";
import { orders } from "~/db.server";

/** Order value in SQL: what the customer pays in all. Partial COD = advance online + the rest on delivery. */
export const orderValueSql = sql`(case when ${orders.paymentMethod} = 'partial' then ${orders.total} - ${orders.bankDiscount} else coalesce(${orders.amountPaid}, ${orders.total}) end)`;
