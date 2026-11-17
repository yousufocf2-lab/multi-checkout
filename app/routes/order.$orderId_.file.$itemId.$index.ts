// Digital product download: only for a paid order that bought the product
import type { LoaderFunctionArgs } from "@remix-run/node";
import { downloadForOrder } from "~/lib/digital.server";

export async function loader({ params }: LoaderFunctionArgs) {
  return downloadForOrder(params.orderId ?? "", Number(params.itemId) || 0, Number(params.index) || 0);
}
