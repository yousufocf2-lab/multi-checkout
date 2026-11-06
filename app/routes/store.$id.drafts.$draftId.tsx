// Orders → Drafts → Create order: products (or custom items), discount, shipping, customer; then a checkout link or a real order.
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { Form, Link, useActionData, useFetcher, useLoaderData, useNavigation } from "@remix-run/react";
import { useEffect, useRef, useState } from "react";
import type { DraftDiscount, DraftLine, OrderCustomer } from "~/db.server";
import { Icon } from "~/components/Icons";
import { Notice } from "~/components/ui";
import { can, requireStore, requireViewer } from "~/lib/auth.server";
import { cancelDraft, completeDraft, customItemsAllowed, deleteDraft, getDraft, saveDraft, sendDraftLink, type DraftInput } from "~/lib/drafts.server";
import { draftName, draftTotals } from "~/lib/drafts";
import { formatINR, rupeesToPaise } from "~/lib/pricing";
import { storePath } from "~/lib/store-code";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const viewer = await requireViewer(request);
  const store = await requireStore(viewer, params.id);
  if (!can(viewer, "orders")) throw new Response("Not allowed", { status: 403 });
  const d = params.draftId === "new" ? null : await getDraft(store.id, Number(params.draftId));
  if (params.draftId !== "new" && !d) throw new Response("Not found", { status: 404 });
  return json({
    storeId: store.id, storeName: store.name, custom: customItemsAllowed(store),
    draft: d ? { id: d.id, name: draftName(d.number), status: d.status, items: d.items, customer: d.customer, discount: d.discount, shippingPaise: d.shippingPaise, shippingTitle: d.shippingTitle, note: d.note, tags: d.tags, orderId: d.orderId, createdAt: d.createdAt.toISOString() } : null,
  });
}

export async function action({ request, params }: ActionFunctionArgs) {
  const viewer = await requireViewer(request);
  const store = await requireStore(viewer, params.id);
  if (!can(viewer, "orders")) throw new Response("Not allowed", { status: 403 });
  const fd = await request.formData();
  const intent = String(fd.get("intent") ?? "save");
  let id = params.draftId === "new" ? null : Number(params.draftId);
  try {
    if (intent === "delete" && id) { await deleteDraft(store.id, id); return redirect(`${storePath(store.id)}/drafts`); }
    if (intent === "cancel" && id) { await cancelDraft(store.id, id); return json({ ok: "Draft cancelled.", error: null, link: null }); }
    const input = JSON.parse(String(fd.get("draft") ?? "{}")) as DraftInput;
    id = await saveDraft(store, input, id, viewer.name);
    if (intent === "link") {
      const r = await sendDraftLink(store, id);
      const msg = [r.note, r.discountNote].filter(Boolean).join(" ");
      if (params.draftId === "new") return redirect(`${storePath(store.id)}/drafts/${id}?link=${encodeURIComponent(r.url)}${msg ? `&msg=${encodeURIComponent(msg)}` : ""}`);
      return json({ ok: [r.note, r.discountNote].filter(Boolean).join(" ") || "Checkout link ready. Send it to the customer.", error: null, link: r.url, id });
    }
    if (intent === "cod" || intent === "paid") {
      await completeDraft(store, id, intent);
      return redirect(`${storePath(store.id)}/drafts/${id}?done=${intent}`);
    }
    if (params.draftId === "new") return redirect(`${storePath(store.id)}/drafts/${id}?saved=1`);
    return json({ ok: "Draft saved.", error: null, link: null });
  } catch (e) {
    if (params.draftId === "new" && id) return redirect(`${storePath(store.id)}/drafts/${id}?err=${encodeURIComponent(e instanceof Error ? e.message : "Couldn't save")}`);
    return json({ ok: null, error: e instanceof Error ? e.message : "Something went wrong", link: null }, { status: 400 });
  }
}

type Found = { variantId: string; productId: string; title: string; variantTitle: string | null; image: string | null; pricePaise: number; comparePaise: number | null; stock: number | null; available: boolean };
const STATES = ["AN", "AP", "AR", "AS", "BR", "CH", "CG", "DN", "DL", "GA", "GJ", "HR", "HP", "JK", "JH", "KA", "KL", "LA", "LD", "MP", "MH", "MN", "ML", "MZ", "NL", "OR", "PY", "PB", "RJ", "SK", "TN", "TS", "TR", "UP", "UK", "WB"];
const STATUS_PILL: Record<string, [string, string]> = { open: ["Open", "bg-[#fff1e3] text-[#5e4200]"], link_sent: ["Link sent", "bg-[#e0f0ff] text-[#00527c]"], completed: ["Completed", "bg-[#cdfee1] text-[#0c5132]"], cancelled: ["Cancelled", "bg-paper-sunk text-ink-soft"] };

export default function DraftEditor() {
  const { storeId, custom, draft } = useLoaderData<typeof loader>();
  const a = useActionData<typeof action>();
  const nav = useNavigation();
  const busy = nav.state !== "idle";
  const busyIntent = nav.formData?.get("intent");
  const qs = typeof window !== "undefined" ? new URLSearchParams(window.location.search) : null;
  const locked = draft?.status === "completed" || draft?.status === "cancelled";

  const [items, setItems] = useState<DraftLine[]>(draft?.items ?? []);
  const [customer, setCustomer] = useState<Partial<OrderCustomer>>(draft?.customer ?? {});
  const [discount, setDiscount] = useState<DraftDiscount | null>(draft?.discount ?? null);
  const [shipping, setShipping] = useState({ paise: draft?.shippingPaise ?? 0, title: draft?.shippingTitle ?? "" });
  const [note, setNote] = useState(draft?.note ?? "");
  const [tags, setTags] = useState<string[]>(draft?.tags ?? []);
  const [panel, setPanel] = useState<null | "discount" | "shipping" | "custom">(null);
  const [copied, setCopied] = useState(false);
  const t = draftTotals({ items, discount, shippingPaise: shipping.paise });
  const payload = JSON.stringify({ items, customer, discount, shippingPaise: shipping.paise, shippingTitle: shipping.title || null, note, tags });
  const setC = (k: keyof OrderCustomer, v: string) => setCustomer((c) => ({ ...c, [k]: v }));
  const add = (f: Found) => setItems((xs) => {
    const i = xs.findIndex((x) => x.variantId === f.variantId);
    if (i >= 0) return xs.map((x, j) => (j === i ? { ...x, quantity: x.quantity + 1 } : x));
    return [...xs, { variantId: f.variantId, productId: f.productId, title: f.title, variantTitle: f.variantTitle, image: f.image, quantity: 1, pricePaise: f.pricePaise, comparePaise: f.comparePaise }];
  });
  const link = (a && "link" in a ? a.link : null) ?? qs?.get("link") ?? null;
  const linkMsg = a?.ok ?? qs?.get("msg") ?? null;
  const waText = link ? `Hi${customer.firstName ? ` ${customer.firstName}` : ""}, here is your order link. Please check your items and complete the order: ${link}` : "";

  return (
    <Form method="post" className="mx-auto max-w-[1000px] pb-10">
      <input type="hidden" name="draft" value={payload} />
      <div className="mb-4 flex min-h-[32px] flex-wrap items-center gap-2">
        <Link to={`${storePath(storeId)}/drafts`} className="flex h-7 w-7 items-center justify-center rounded-lg text-ink-soft hover:bg-black/5" aria-label="Back to drafts"><Icon name="arrow" className="h-4 w-4 rotate-180" /></Link>
        <Link to={`${storePath(storeId)}/drafts`} className="text-[13px] font-medium text-ink-soft hover:text-ink">Drafts</Link>
        <span className="text-ink-faint">/</span>
        <h1 className="text-[15px] font-semibold">{draft ? draft.name : "Create order"}</h1>
        {draft && <span className={`rounded-md px-1.5 py-0.5 text-[11.5px] font-medium ${STATUS_PILL[draft.status][1]}`}>{STATUS_PILL[draft.status][0]}</span>}
        <span className="flex-1" />
        {draft && !locked && (
          <>
            <button type="submit" name="intent" value="cancel" className="btn-secondary" disabled={busy} onClick={(e) => { if (!confirm("Cancel this draft?")) e.preventDefault(); }}>Cancel draft</button>
            <button type="submit" name="intent" value="delete" className="btn-secondary text-[#8e1f0b]" disabled={busy} onClick={(e) => { if (!confirm("Delete this draft?")) e.preventDefault(); }}>Delete</button>
          </>
        )}
        {!locked && <button type="submit" name="intent" value="save" className="btn-secondary" disabled={busy}>{busy && busyIntent === "save" ? "Saving…" : "Save draft"}</button>}
      </div>

      <div className="mb-4 space-y-2">
        {qs?.get("done") && <Notice tone="success">Order created{qs.get("done") === "cod" ? " as Cash on delivery" : " and marked as paid"}. It's in Orders and ships like any other order.</Notice>}
        {qs?.get("saved") && !a && <Notice tone="success">Draft saved.</Notice>}
        {qs?.get("err") && !a && <Notice tone="error">{qs.get("err")}</Notice>}
        {a?.ok && !link && <Notice tone="success">{a.ok}</Notice>}
        {a?.error && <Notice tone="error">{a.error}</Notice>}
        {link && (
          <div className="panel flex flex-wrap items-center gap-2 p-3">
            <Icon name="check" className="h-4 w-4 text-[#0c5132]" />
            <span className="min-w-0 flex-1 truncate font-mono text-[12.5px]">{link}</span>
            <button type="button" className="btn-secondary" onClick={() => { void navigator.clipboard?.writeText(link); setCopied(true); }}>{copied ? "Copied" : "Copy link"}</button>
            <a className="btn-primary" target="_blank" rel="noreferrer" href={`https://wa.me/91${customer.phone ?? ""}?text=${encodeURIComponent(waText)}`}><Icon name="chat" className="h-4 w-4" />Send on WhatsApp</a>
            {linkMsg && <p className="w-full text-[12px] text-ink-soft">{linkMsg}</p>}
          </div>
        )}
      </div>

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="min-w-0 space-y-4">
          <section className="panel overflow-hidden">
            <div className="p-4">
              <h2 className="text-[13.5px] font-semibold">Products</h2>
              {!locked && (
                <div className="mt-3 flex flex-wrap gap-2">
                  <ProductSearch storeId={storeId} onPick={add} />
                  {custom && <button type="button" className="btn-secondary h-8" onClick={() => setPanel(panel === "custom" ? null : "custom")}><Icon name="plus" className="h-4 w-4" />Custom item</button>}
                </div>
              )}
              {panel === "custom" && <CustomItem onAdd={(l) => { setItems((xs) => [...xs, l]); setPanel(null); }} onClose={() => setPanel(null)} />}
            </div>
            {items.length === 0 ? (
              <div className="mx-4 mb-4 flex flex-col items-center gap-1 rounded-lg border border-dashed border-[#b5b5b5] py-8 text-center">
                <Icon name="tag" className="h-5 w-5 text-ink-faint" />
                <p className="text-[13px] font-medium">No products yet</p>
                <p className="text-[12px] text-ink-faint">Search above to add products{custom ? " or add a custom item" : ""}.</p>
              </div>
            ) : (
              <table className="table">
                <thead><tr><th>Product</th><th className="w-28 text-right">Price</th><th className="w-28 text-center">Quantity</th><th className="w-28 text-right">Total</th><th className="w-10" /></tr></thead>
                <tbody>
                  {items.map((l, i) => (
                    <tr key={l.variantId + i}>
                      <td>
                        <span className="flex items-center gap-3">
                          {l.image ? <img src={l.image} alt="" className="h-10 w-10 rounded-lg object-cover shadow-[0_0_0_1px_rgba(0,0,0,.06)]" /> : <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-paper-sunk"><Icon name="tag" className="h-4 w-4 text-ink-faint" /></span>}
                          <span className="min-w-0"><span className="block font-semibold">{l.title}</span>{l.variantTitle && <span className="mt-0.5 inline-block rounded bg-paper-sunk px-1.5 text-[11.5px] text-ink-soft">{l.variantTitle}</span>}{l.custom && <span className="ml-1 text-[11.5px] text-ink-faint">Custom item</span>}</span>
                        </span>
                      </td>
                      <td className="text-right">
                        {locked ? formatINR(l.pricePaise) : (
                          <span className="ml-auto flex w-24 items-center rounded-lg bg-[#fdfdfd] shadow-[inset_0_0_0_1px_#d4d4d4] focus-within:shadow-[inset_0_0_0_2px_#005bd3]">
                            <span className="pl-2 text-[12px] text-ink-faint">₹</span>
                            <input inputMode="decimal" defaultValue={l.pricePaise / 100} onBlur={(e) => { const p = rupeesToPaise(e.target.value) ?? 0; setItems((xs) => xs.map((x, j) => (j === i ? { ...x, pricePaise: p } : x))); }} className="h-7 w-full border-0 bg-transparent px-1 text-right text-[13px] outline-none" aria-label={`Price of ${l.title}`} />
                          </span>
                        )}
                      </td>
                      <td className="text-center">
                        {locked ? l.quantity : (
                          <span className="inline-flex items-center rounded-lg shadow-[inset_0_0_0_1px_#d4d4d4]">
                            <button type="button" className="h-7 w-7 text-ink-soft hover:text-ink" onClick={() => setItems((xs) => xs.map((x, j) => (j === i ? { ...x, quantity: Math.max(1, x.quantity - 1) } : x)))} aria-label="Less">−</button>
                            <span className="num w-7 text-center text-[13px]">{l.quantity}</span>
                            <button type="button" className="h-7 w-7 text-ink-soft hover:text-ink" onClick={() => setItems((xs) => xs.map((x, j) => (j === i ? { ...x, quantity: Math.min(999, x.quantity + 1) } : x)))} aria-label="More">+</button>
                          </span>
                        )}
                      </td>
                      <td className="num text-right font-medium">{formatINR(l.pricePaise * l.quantity)}</td>
                      <td>{!locked && <button type="button" onClick={() => setItems((xs) => xs.filter((_, j) => j !== i))} className="flex h-7 w-7 items-center justify-center rounded-lg text-ink-soft hover:bg-[#fee9e8] hover:text-[#8e1f0b]" aria-label={`Remove ${l.title}`}><Icon name="close" className="h-4 w-4" /></button>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>

          <section className="panel overflow-hidden">
            <div className="p-4">
              <h2 className="text-[13.5px] font-semibold">Payment</h2>
              <dl className="mt-3 space-y-2 text-[13px]">
                <div className="flex justify-between"><dt>Subtotal <span className="text-ink-faint">· {t.items} item{t.items === 1 ? "" : "s"}</span></dt><dd className="num">{formatINR(t.subtotal)}</dd></div>
                <div className="flex justify-between">
                  <dt>{locked ? "Discount" : <button type="button" className="font-medium text-[#005bd3] hover:underline" onClick={() => setPanel(panel === "discount" ? null : "discount")}>{discount ? "Edit discount" : "Add discount"}</button>}
                    {discount && <span className="ml-1.5 text-ink-faint">{discount.type === "percent" ? `${discount.value}%` : formatINR(discount.value * 100)}{discount.reason ? ` · ${discount.reason}` : ""}</span>}</dt>
                  <dd className="num">{t.discount ? `−${formatINR(t.discount)}` : formatINR(0)}</dd>
                </div>
                {panel === "discount" && <DiscountBox value={discount} onSave={(d) => { setDiscount(d); setPanel(null); }} onClose={() => setPanel(null)} />}
                <div className="flex justify-between">
                  <dt>{locked ? "Shipping" : <button type="button" className="font-medium text-[#005bd3] hover:underline" onClick={() => setPanel(panel === "shipping" ? null : "shipping")}>{shipping.paise || shipping.title ? "Edit shipping" : "Add shipping or delivery"}</button>}
                    {shipping.title && <span className="ml-1.5 text-ink-faint">{shipping.title}</span>}</dt>
                  <dd className="num">{formatINR(shipping.paise)}</dd>
                </div>
                {panel === "shipping" && <ShippingBox value={shipping} onSave={(s) => { setShipping(s); setPanel(null); }} onClose={() => setPanel(null)} />}
                <div className="flex justify-between border-t border-rule pt-2 text-[14px] font-semibold"><dt>Total</dt><dd className="num">{formatINR(t.total)}</dd></div>
              </dl>
            </div>
            {!locked && (
              <div className="flex flex-wrap items-center justify-end gap-2 border-t border-rule bg-paper px-4 py-3">
                {items.length === 0 ? <span className="mr-auto text-[12.5px] text-ink-soft">Add a product to calculate the total and see payment options.</span> : <span className="mr-auto text-[12.5px] text-ink-soft">Send a link, or create the order now.</span>}
                <button type="submit" name="intent" value="link" className="btn-secondary" disabled={busy || !items.length}><Icon name="send" className="h-4 w-4" />{busy && busyIntent === "link" ? "Creating link…" : "Send checkout link"}</button>
                <CollectMenu disabled={busy || !items.length} busy={busy && (busyIntent === "cod" || busyIntent === "paid")} />
              </div>
            )}
            {draft?.status === "completed" && <p className="border-t border-rule bg-paper px-4 py-3 text-[12.5px] text-ink-soft">This draft became an order. Find it in <Link to="/dashboard/orders" className="font-medium text-ink underline">Orders</Link>.</p>}
          </section>
        </div>

        <aside className="min-w-0 space-y-4">
          <section className="panel space-y-2.5 p-4">
            <h2 className="text-[13.5px] font-semibold">Customer</h2>
            <F label="Mobile number"><span className="flex items-center rounded-lg bg-[#fdfdfd] shadow-[inset_0_0_0_1px_#d4d4d4] focus-within:shadow-[inset_0_0_0_2px_#005bd3]"><span className="pl-2.5 text-[13px] text-ink-faint">+91</span><input value={customer.phone ?? ""} onChange={(e) => setC("phone", e.target.value.replace(/\D/g, "").slice(0, 10))} inputMode="tel" disabled={locked} className="h-8 min-w-0 flex-1 border-0 bg-transparent px-2 text-[13px] outline-none" placeholder="98XXXXXXXX" /></span></F>
            <div className="grid grid-cols-2 gap-2">
              <F label="First name"><input value={customer.firstName ?? ""} onChange={(e) => setC("firstName", e.target.value)} disabled={locked} className="input w-full" /></F>
              <F label="Last name"><input value={customer.lastName ?? ""} onChange={(e) => setC("lastName", e.target.value)} disabled={locked} className="input w-full" /></F>
            </div>
            <F label="Email (optional)"><input type="email" value={customer.email ?? ""} onChange={(e) => setC("email", e.target.value)} disabled={locked} className="input w-full" /></F>
            <p className="pt-1 text-[12px] font-semibold text-ink-soft">Delivery address</p>
            <F label="House no., street"><input value={customer.address1 ?? ""} onChange={(e) => setC("address1", e.target.value)} disabled={locked} className="input w-full" /></F>
            <F label="Area, landmark (optional)"><input value={customer.address2 ?? ""} onChange={(e) => setC("address2", e.target.value)} disabled={locked} className="input w-full" /></F>
            <div className="grid grid-cols-2 gap-2">
              <F label="City"><input value={customer.city ?? ""} onChange={(e) => setC("city", e.target.value)} disabled={locked} className="input w-full" /></F>
              <F label="Pincode"><input value={customer.pincode ?? ""} onChange={(e) => setC("pincode", e.target.value.replace(/\D/g, "").slice(0, 6))} inputMode="numeric" disabled={locked} className="input w-full" /></F>
            </div>
            <F label="State"><select value={customer.state ?? ""} onChange={(e) => setC("state", e.target.value)} disabled={locked} className="input w-full"><option value="">Choose</option>{STATES.map((s) => <option key={s} value={s}>{s}</option>)}</select></F>
          </section>
          <section className="panel p-4">
            <h2 className="text-[13.5px] font-semibold">Notes</h2>
            <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} disabled={locked} className="input mt-2 w-full" placeholder="Only you and your team see this" />
          </section>
          <section className="panel p-4">
            <h2 className="text-[13.5px] font-semibold">Tags</h2>
            <TagBox value={tags} onChange={setTags} disabled={locked} />
          </section>
        </aside>
      </div>
    </Form>
  );
}

function F({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block"><span className="label">{label}</span>{children}</label>;
}

function CollectMenu({ disabled, busy }: { disabled: boolean; busy: boolean }) {
  const [open, setOpen] = useState(false);
  useEffect(() => { if (busy) setOpen(false); }, [busy]);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);
  return (
    <div className="relative" ref={ref}>
      <button type="button" className="btn-primary" disabled={disabled} onClick={() => setOpen(!open)} aria-expanded={open}>{busy ? "Creating order…" : "Create order"}<Icon name="chevron" className="h-3.5 w-3.5" /></button>
      {open && (
        <div className="absolute bottom-full right-0 z-20 mb-1 w-64 overflow-hidden rounded-xl bg-white p-1 shadow-[0_0_0_1px_rgba(0,0,0,.08),0_12px_32px_-8px_rgba(0,0,0,.3)]">
          <button type="submit" name="intent" value="cod" className="block w-full rounded-lg px-3 py-2 text-left hover:bg-paper">
            <span className="block text-[13px] font-semibold">Create as Cash on delivery</span><span className="block text-[12px] text-ink-soft">Collect the money when it's delivered</span>
          </button>
          <button type="submit" name="intent" value="paid" className="block w-full rounded-lg px-3 py-2 text-left hover:bg-paper">
            <span className="block text-[13px] font-semibold">Mark as paid</span><span className="block text-[12px] text-ink-soft">Paid by UPI, bank transfer or cash</span>
          </button>
        </div>
      )}
    </div>
  );
}

function ProductSearch({ storeId, onPick }: { storeId: number; onPick: (f: Found) => void }) {
  const f = useFetcher<{ products: Found[]; error: string | null }>();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => f.load(`${storePath(storeId)}/drafts/search?q=${encodeURIComponent(q)}`), 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, open]);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);
  const list = f.data?.products ?? [];
  return (
    <div className="relative min-w-[240px] flex-1" ref={box}>
      <label className="flex h-8 items-center gap-2 rounded-lg bg-[#fdfdfd] px-2.5 text-ink-faint shadow-[inset_0_0_0_1px_#d4d4d4] focus-within:shadow-[inset_0_0_0_2px_#005bd3]">
        <Icon name="search" className="h-4 w-4" />
        <input value={q} onChange={(e) => { setQ(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)} placeholder="Search products" className="min-w-0 flex-1 border-0 bg-transparent text-[13px] text-ink outline-none" aria-label="Search products" />
      </label>
      {open && (
        <div className="absolute left-0 right-0 top-full z-20 mt-1 max-h-80 overflow-y-auto rounded-xl bg-white p-1 shadow-[0_0_0_1px_rgba(0,0,0,.08),0_12px_32px_-8px_rgba(0,0,0,.3)]">
          {f.state !== "idle" && !list.length && <p className="px-3 py-3 text-[12.5px] text-ink-faint">Searching…</p>}
          {f.data?.error && <p className="px-3 py-3 text-[12.5px] text-[#8e1f0b]">{f.data.error}</p>}
          {f.state === "idle" && f.data && !list.length && !f.data.error && <p className="px-3 py-3 text-[12.5px] text-ink-faint">No products found.</p>}
          {list.map((p) => (
            <button key={p.variantId} type="button" disabled={!p.available} onClick={() => onPick(p)} className="flex w-full items-center gap-3 rounded-lg px-2 py-1.5 text-left hover:bg-paper disabled:opacity-50">
              {p.image ? <img src={p.image} alt="" className="h-9 w-9 rounded-md object-cover" /> : <span className="h-9 w-9 rounded-md bg-paper-sunk" />}
              <span className="min-w-0 flex-1"><span className="block truncate text-[13px] font-medium">{p.title}</span><span className="block truncate text-[11.5px] text-ink-faint">{p.variantTitle ?? "Default"}{p.stock != null ? ` · ${p.stock} in stock` : ""}{!p.available ? " · Sold out" : ""}</span></span>
              <span className="num text-[13px]">{formatINR(p.pricePaise)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function Box({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="my-2 rounded-lg bg-paper p-3 shadow-[inset_0_0_0_1px_rgb(var(--rule))]">
      <div className="mb-2 flex items-center justify-between"><span className="text-[12.5px] font-semibold">{title}</span><button type="button" onClick={onClose} className="text-ink-faint hover:text-ink" aria-label="Close"><Icon name="close" className="h-3.5 w-3.5" /></button></div>
      {children}
    </div>
  );
}

function DiscountBox({ value, onSave, onClose }: { value: DraftDiscount | null; onSave: (d: DraftDiscount | null) => void; onClose: () => void }) {
  const [type, setType] = useState<DraftDiscount["type"]>(value?.type ?? "percent");
  const [v, setV] = useState(value ? String(value.value) : "");
  const [reason, setReason] = useState(value?.reason ?? "");
  return (
    <Box title="Discount" onClose={onClose}>
      <div className="grid grid-cols-[auto_1fr] gap-2">
        <select value={type} onChange={(e) => setType(e.target.value as DraftDiscount["type"])} className="input" aria-label="Discount type"><option value="percent">%</option><option value="flat">₹</option></select>
        <input value={v} onChange={(e) => setV(e.target.value.replace(/[^0-9.]/g, ""))} inputMode="decimal" placeholder={type === "percent" ? "10" : "100"} className="input" aria-label="Discount value" />
        <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason (optional), e.g. Repeat customer" className="input col-span-2" aria-label="Reason" />
      </div>
      <div className="mt-2 flex justify-end gap-2">
        {value && <button type="button" className="btn-secondary h-7" onClick={() => onSave(null)}>Remove</button>}
        <button type="button" className="btn-primary h-7" onClick={() => onSave(Number(v) > 0 ? { type, value: Number(v), reason: reason.trim() || undefined } : null)}>Apply</button>
      </div>
    </Box>
  );
}

function ShippingBox({ value, onSave, onClose }: { value: { paise: number; title: string }; onSave: (s: { paise: number; title: string }) => void; onClose: () => void }) {
  const [title, setTitle] = useState(value.title || "Standard delivery");
  const [v, setV] = useState(value.paise ? String(value.paise / 100) : "");
  return (
    <Box title="Shipping or delivery" onClose={onClose}>
      <div className="grid grid-cols-[1fr_110px] gap-2">
        <input value={title} onChange={(e) => setTitle(e.target.value)} className="input" aria-label="Shipping name" />
        <input value={v} onChange={(e) => setV(e.target.value.replace(/[^0-9.]/g, ""))} inputMode="decimal" placeholder="₹ 0" className="input" aria-label="Shipping charge" />
      </div>
      <div className="mt-2 flex justify-end gap-2">
        <button type="button" className="btn-secondary h-7" onClick={() => onSave({ paise: 0, title: "Free delivery" })}>Free</button>
        <button type="button" className="btn-primary h-7" onClick={() => onSave({ paise: rupeesToPaise(v) ?? 0, title: title.trim() })}>Apply</button>
      </div>
    </Box>
  );
}

function CustomItem({ onAdd, onClose }: { onAdd: (l: DraftLine) => void; onClose: () => void }) {
  const [title, setTitle] = useState("");
  const [price, setPrice] = useState("");
  const [qty, setQty] = useState("1");
  return (
    <Box title="Add custom item" onClose={onClose}>
      <div className="grid grid-cols-[1fr_110px_80px] gap-2">
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Item name" className="input" aria-label="Item name" autoFocus />
        <input value={price} onChange={(e) => setPrice(e.target.value.replace(/[^0-9.]/g, ""))} inputMode="decimal" placeholder="₹ Price" className="input" aria-label="Price" />
        <input value={qty} onChange={(e) => setQty(e.target.value.replace(/\D/g, ""))} inputMode="numeric" className="input" aria-label="Quantity" />
      </div>
      <div className="mt-2 flex justify-end">
        <button type="button" className="btn-primary h-7" disabled={!title.trim() || !(Number(price) >= 0) || !price}
          onClick={() => onAdd({ variantId: `custom-${Date.now()}`, title: title.trim(), variantTitle: null, image: null, quantity: Math.max(1, Number(qty) || 1), pricePaise: rupeesToPaise(price) ?? 0, comparePaise: null, custom: true })}>Add item</button>
      </div>
    </Box>
  );
}

function TagBox({ value, onChange, disabled }: { value: string[]; onChange: (v: string[]) => void; disabled?: boolean }) {
  const [d, setD] = useState("");
  const add = () => { const t = d.trim(); if (t && !value.includes(t)) onChange([...value, t]); setD(""); };
  return (
    <div className="mt-2 flex flex-wrap items-center gap-1.5 rounded-lg bg-[#fdfdfd] p-1.5 shadow-[inset_0_0_0_1px_#d4d4d4]">
      {value.map((t) => <span key={t} className="inline-flex h-6 items-center gap-1 rounded-md bg-paper-sunk pl-2 pr-1 text-[12.5px]">{t}{!disabled && <button type="button" onClick={() => onChange(value.filter((x) => x !== t))} className="rounded p-0.5 hover:bg-black/10" aria-label={`Remove ${t}`}><Icon name="close" className="h-3 w-3" /></button>}</span>)}
      {!disabled && <input value={d} onChange={(e) => setD(e.target.value)} onBlur={add} onKeyDown={(e) => { if (e.key === "Enter" || e.key === ",") { e.preventDefault(); add(); } }} placeholder={value.length ? "" : "e.g. Instagram, VIP"} className="h-6 min-w-[80px] flex-1 border-0 bg-transparent px-1 text-[13px] outline-none" aria-label="Add tag" />}
    </div>
  );
}
