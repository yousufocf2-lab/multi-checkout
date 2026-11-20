// Change an order's products, quantities, prices and delivery charge. Folded away until "Edit items" is tapped.
import { useFetcher } from "@remix-run/react";
import { useEffect, useState } from "react";
import { Icon } from "~/components/Icons";
import { formatINR as inr } from "~/lib/pricing";

export type EditLine = { variantId: string; productId?: string; title: string; variantTitle: string | null; image: string | null; quantity: number; pricePaise: number; comparePaise?: number | null };
type Found = { variantId: string; productId: string; title: string; variantTitle: string | null; image: string | null; pricePaise: number; comparePaise: number | null; available: boolean };
type Res = { ok?: string | null; error?: string | null; products?: Found[] };

/**
 * `hidden` = extra form fields the action needs (orderId, storeId…). `blocked` = why it can't be changed (shown
 * instead of the editor). `total`/`subtotal`/`shipping` are the order's current paise amounts.
 */
export function ItemsEditor({ lines, total, subtotal, shipping, hidden, blocked, compact, onSaved }: {
  lines: EditLine[]; total: number; subtotal: number; shipping: number; hidden: Record<string, string>; blocked?: string | null; compact?: boolean; onSaved?: (r: Res) => void;
}) {
  const [open, setOpen] = useState(false);
  const [cart, setCart] = useState<EditLine[]>(lines);
  const [ship, setShip] = useState(String(shipping / 100));
  const [q, setQ] = useState("");
  const [adding, setAdding] = useState(false);
  const save = useFetcher<Res>();
  const search = useFetcher<Res>();
  useEffect(() => { if (!open) { setCart(lines); setShip(String(shipping / 100)); } }, [open, lines, shipping]);
  useEffect(() => {
    if (save.state !== "idle" || !save.data) return;
    onSaved?.(save.data);
    if (save.data.ok) setOpen(false);
  }, [save.state, save.data]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!adding) return;
    const t = setTimeout(() => search.submit({ ...hidden, intent: "product-search", q }, { method: "post" }), 250);
    return () => clearTimeout(t);
  }, [q, adding]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!open) {
    return <button type="button" onClick={() => setOpen(true)} className={`inline-flex items-center gap-1 font-medium text-[#005bd3] hover:underline ${compact ? "text-[12px]" : "text-[12.5px]"}`}><Icon name="cart" className="h-3.5 w-3.5" />Edit items / price</button>;
  }
  const shipPaise = Math.max(0, Math.round((Number(ship) || 0) * 100));
  const sub = cart.reduce((s, l) => s + l.pricePaise * l.quantity, 0);
  const newTotal = Math.max(0, total - subtotal - shipping + sub + shipPaise);
  const setLine = (k: number, p: Partial<EditLine>) => setCart((list) => list.map((l, j) => (j === k ? { ...l, ...p } : l)));
  return (
    <div className="space-y-2 rounded-xl bg-[#f6f6f7] p-3 text-left">
      <div className="flex items-center justify-between">
        <p className="text-[12.5px] font-semibold">Edit items</p>
        <button type="button" onClick={() => setOpen(false)} className="text-[12px] font-medium text-ink-soft hover:text-ink">Close</button>
      </div>
      {blocked ? <p className="text-[12.5px] text-ink-soft">{blocked}</p> : (
        <>
          <ul className="divide-y divide-rule rounded-lg border border-rule bg-white">
            {cart.map((l, k) => (
              <li key={`${l.variantId}-${k}`} className="flex items-center gap-2 px-2.5 py-2">
                {l.image ? <img src={l.image} alt="" className="h-9 w-9 shrink-0 rounded object-cover" /> : <span className="h-9 w-9 shrink-0 rounded bg-paper-sunk" />}
                <div className="min-w-0 flex-1"><p className="truncate text-[12.5px] font-medium">{l.title}</p>{l.variantTitle && <p className="truncate text-[11px] text-ink-faint">{l.variantTitle}</p>}</div>
                <div className="flex items-center rounded-md shadow-[inset_0_0_0_1px_#d4d4d4]">
                  <button type="button" disabled={l.quantity <= 1} onClick={() => setLine(k, { quantity: l.quantity - 1 })} className="h-7 w-7 text-[15px] disabled:opacity-30" aria-label="Fewer">−</button>
                  <span className="num w-6 text-center text-[12.5px]">{l.quantity}</span>
                  <button type="button" disabled={l.quantity >= 99} onClick={() => setLine(k, { quantity: l.quantity + 1 })} className="h-7 w-7 text-[15px] disabled:opacity-30" aria-label="More">+</button>
                </div>
                <label className="flex items-center gap-0.5 text-[12px] text-ink-soft">₹
                  <input value={String(l.pricePaise / 100)} inputMode="decimal" aria-label="Price per unit" onChange={(e) => setLine(k, { pricePaise: Math.round((Number(e.target.value.replace(/[^\d.]/g, "")) || 0) * 100) })} className="input h-7 w-[72px] px-1.5 text-right text-[12.5px]" />
                </label>
                <button type="button" onClick={() => setCart((list) => list.filter((_, j) => j !== k))} aria-label="Remove" className="flex h-7 w-7 items-center justify-center rounded-md text-ink-faint hover:bg-[#fdeceb] hover:text-[#b42318]"><Icon name="trash" className="h-3.5 w-3.5" /></button>
              </li>
            ))}
            {!cart.length && <li className="px-3 py-3 text-center text-[12.5px] text-ink-faint">No products. Add one below.</li>}
          </ul>
          {adding ? (
            <div className="rounded-lg bg-white p-2 shadow-[0_0_0_1px_#e3e3e3]">
              <div className="flex gap-1.5"><input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search products" aria-label="Search products" className="input h-8 text-[13px]" /><button type="button" onClick={() => { setAdding(false); setQ(""); }} className="btn-secondary h-8 px-2.5 text-[12px]">Done</button></div>
              <div className="mt-1 max-h-52 overflow-y-auto">
                {search.state !== "idle" && !search.data?.products?.length && <p className="px-2 py-2 text-[12px] text-ink-faint">Searching…</p>}
                {search.data?.error && <p className="px-2 py-2 text-[12px] text-[#8e1f0b]">{search.data.error}</p>}
                {(search.data?.products ?? []).map((p) => (
                  <button key={p.variantId} type="button" disabled={!p.available} onClick={() => setCart((list) => {
                    const k = list.findIndex((l) => l.variantId === p.variantId);
                    if (k >= 0) return list.map((l, j) => (j === k ? { ...l, quantity: Math.min(99, l.quantity + 1) } : l));
                    return [...list, { variantId: p.variantId, productId: p.productId, title: p.title, variantTitle: p.variantTitle, image: p.image, quantity: 1, pricePaise: p.pricePaise, comparePaise: p.comparePaise }];
                  })} className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-paper disabled:opacity-50">
                    {p.image ? <img src={p.image} alt="" className="h-8 w-8 rounded object-cover" /> : <span className="h-8 w-8 rounded bg-paper-sunk" />}
                    <span className="min-w-0 flex-1"><span className="block truncate text-[12.5px] font-medium">{p.title}</span><span className="block truncate text-[11px] text-ink-faint">{p.variantTitle ?? "Default"}{!p.available ? " · Sold out" : ""}</span></span>
                    <span className="num text-[12.5px]">{inr(p.pricePaise)}</span>
                  </button>
                ))}
              </div>
            </div>
          ) : <button type="button" onClick={() => setAdding(true)} className="flex items-center gap-1 text-[12.5px] font-medium text-[#005bd3]"><Icon name="plus" className="h-3.5 w-3.5" />Add product</button>}
          <div className="space-y-1 text-[12.5px]">
            <div className="flex justify-between"><span className="text-ink-soft">Products</span><span className="num">{inr(sub)}</span></div>
            <div className="flex items-center justify-between"><span className="text-ink-soft">Delivery charge</span><label className="flex items-center gap-0.5 text-ink-soft">₹<input value={ship} onChange={(e) => setShip(e.target.value.replace(/[^\d.]/g, ""))} inputMode="decimal" aria-label="Delivery charge" className="input h-7 w-[72px] px-1.5 text-right text-[12.5px]" /></label></div>
            {total - subtotal - shipping !== 0 && <div className="flex justify-between text-ink-faint"><span>Discounts and fees (unchanged)</span><span className="num">{inr(total - subtotal - shipping)}</span></div>}
            <div className="flex justify-between border-t border-rule pt-1 font-semibold"><span>To collect</span><span className="num">{inr(newTotal)}{newTotal !== total && <span className="ml-1 font-normal text-ink-faint line-through">{inr(total)}</span>}</span></div>
          </div>
          {save.data?.error && <p role="alert" className="text-[12px] text-[#8e1f0b]">{save.data.error}</p>}
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setOpen(false)} className="btn-secondary h-8 px-3 text-[12.5px]">Cancel</button>
            <button type="button" disabled={save.state !== "idle" || !cart.length} onClick={() => save.submit({ ...hidden, intent: "items", lines: JSON.stringify(cart), shippingPaise: String(shipPaise) }, { method: "post" })} className="btn-primary h-8 px-3 text-[12.5px]">{save.state !== "idle" ? "Saving…" : "Save items"}</button>
          </div>
        </>
      )}
    </div>
  );
}
