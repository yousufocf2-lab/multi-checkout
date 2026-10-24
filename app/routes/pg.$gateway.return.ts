// Customer comes back from a payment gateway (GET or POST). The result is confirmed with the gateway, then the order page opens.
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";
import { handleReturn, orderPageUrl, orderByTxn } from "~/lib/gateways/index.server";

async function done(gateway: string, request: Request, params: Record<string, string>) {
  const url = new URL(request.url);
  url.searchParams.forEach((v, k) => { if (!(k in params)) params[k] = v; });
  const txn = url.searchParams.get("t") ?? params.txnid ?? params.ORDERID ?? params.order_id ?? "";
  const order = await handleReturn(gateway, txn, params, "return");
  const row = order ? await orderByTxn(order.id) : txn ? await orderByTxn(txn) : null;
  return redirect(row ? orderPageUrl(row.store, row.order) : "/");
}

export async function loader({ request, params }: LoaderFunctionArgs) {
  return done(String(params.gateway), request, {});
}

export async function action({ request, params }: ActionFunctionArgs) {
  const f: Record<string, string> = {};
  try {
    const type = request.headers.get("content-type") ?? "";
    if (type.includes("application/json")) Object.entries((await request.json()) as Record<string, unknown>).forEach(([k, v]) => { if (typeof v === "string") f[k] = v; });
    else (await request.formData()).forEach((v, k) => { if (typeof v === "string") f[k] = v; });
  } catch { /* empty body */ }
  return done(String(params.gateway), request, f);
}
