// Shown wherever a Smart Checkout feature is off: a short message that takes the owner to Checkout settings to activate it.
import { Link } from "@remix-run/react";
import { storePath } from "~/lib/store-code";
import { Icon } from "./Icons";

const href = (storeId: number) => `${storePath(storeId)}/checkout?activate=1`;

/** Full card for a page that only works with Smart Checkout. */
export function SmartLock({ storeId, what }: { storeId: number; what: string }) {
  return (
    <section className="panel px-6 py-9 text-center">
      <span className="mx-auto flex h-10 w-10 items-center justify-center rounded-xl bg-[#f1f1f1] text-ink-soft"><Icon name="zap" className="h-5 w-5" /></span>
      <h2 className="mt-3 text-[13.5px] font-semibold">Part of Smart Checkout</h2>
      <p className="mx-auto mt-1 max-w-sm text-[12.5px] text-ink-soft">{what} work with Smart Checkout. Your store is on the standard checkout right now.</p>
      <Link to={href(storeId)} className="btn-primary btn mt-4 inline-flex">Activate Smart Checkout</Link>
    </section>
  );
}

/** One-line notice above a control that is locked (payment-method-specific options). */
export function SmartNote({ storeId, children }: { storeId: number; children?: React.ReactNode }) {
  return (
    <Link to={href(storeId)} className="flex items-center gap-2 rounded-lg bg-[#f7f7f7] px-3 py-2 text-[12.5px] text-ink-soft shadow-[inset_0_0_0_1px_#ebebeb] hover:bg-[#f1f1f1]">
      <Icon name="lock" className="h-3.5 w-3.5 shrink-0" />
      <span className="min-w-0 flex-1">{children ?? "Separate offers for COD and prepaid need Smart Checkout. Offers apply the same to every payment method."}</span>
      <span className="shrink-0 font-medium text-[#005bd3]">Activate Smart Checkout</span>
    </Link>
  );
}
