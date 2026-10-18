import type { LoaderFunctionArgs, MetaFunction } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { eq } from "drizzle-orm";
import { useEffect, useRef } from "react";
import { db, walletRecharges, wallets } from "~/db.server";
import { requireStore, requireViewer } from "~/lib/auth.server";
import { rupees } from "~/lib/wallet";
import { BrandLoader, BrandLockup } from "~/components/Brand";
import { rechargePayuForm } from "~/lib/wallet.server";

export const meta: MetaFunction = () => [{ title: "Opening secure payment" }, { name: "robots", content: "noindex" }];

/** Auto-submits the wallet recharge to PayU (our platform account). */
export async function loader({ request, params }: LoaderFunctionArgs) {
  const viewer = await requireViewer(request);
  const [row] = await db.select({ r: walletRecharges, storeId: wallets.storeId, billing: wallets.billing })
    .from(walletRecharges).innerJoin(wallets, eq(walletRecharges.walletId, wallets.id))
    .where(eq(walletRecharges.txnid, params.txnid!)).limit(1);
  if (!row) throw new Response("Recharge not found", { status: 404 });
  const store = await requireStore(viewer, row.storeId);
  if (row.r.status !== "pending") return redirect(`/dashboard/stores/${store.id}/wallet?recharge=${row.r.status === "paid" ? "success" : "failed"}`);
  const form = await rechargePayuForm(row.r.txnid, { name: row.billing?.name || viewer.name, email: row.billing?.email || viewer.email, phone: row.billing?.phone }, store.name);
  return json({ action: form.action, fields: form.fields, total: row.r.totalPaise, credit: row.r.creditPaise });
}

export default function WalletPay() {
  const { action, fields, total, credit } = useLoaderData<typeof loader>();
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => { ref.current?.submit(); }, []);
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-paper px-6 text-center" role="status" aria-live="polite">
      <BrandLockup className="h-8" />
      <BrandLoader className="mt-8 h-16 w-16" label="Opening payment" />
      <p className="mt-4 font-medium">Opening secure payment for {rupees(total)}</p>
      <p className="mt-1 text-sm text-ink-soft">{rupees(credit)} will be added to your wallet after payment.</p>
      <form ref={ref} method="post" action={action} className="mt-8">
        {Object.entries(fields).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
        <noscript><button className="btn-primary">Continue to payment</button></noscript>
      </form>
    </main>
  );
}
