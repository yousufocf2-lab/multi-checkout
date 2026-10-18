import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { confirmRecharge } from "~/lib/wallet.server";

/** PayU webhook for the platform account (wallet recharges). Always re-verified with PayU. */
export async function action({ request }: ActionFunctionArgs) {
  const text = await request.text();
  let f: Record<string, unknown> = {};
  try { f = JSON.parse(text); } catch { f = Object.fromEntries(new URLSearchParams(text)); }
  const txnid = String(f.txnid ?? f.merchantTransactionId ?? f.txnId ?? "");
  if (!txnid.startsWith("WR")) return json({ ok: true, ignored: true });
  try {
    const r = await confirmRecharge(txnid);
    return json({ ok: true, status: r.status });
  } catch (e) {
    console.error("[wallet webhook]", e instanceof Error ? e.message : e);
    return json({ ok: false }, { status: 500 });
  }
}

export const loader = () => json({ ok: true });
