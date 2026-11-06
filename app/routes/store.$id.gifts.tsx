import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Form, useActionData, useLoaderData, useNavigation } from "@remix-run/react";
import { and, desc, eq } from "drizzle-orm";
import { useEffect, useState } from "react";
import { ProductPicker, parsePicked, type PickedProduct } from "~/components/ProductPicker";
import { EmptyState, Notice, RowAction, Section, StatusBadge, SubmitButton, TextField } from "~/components/ui";
import { db, freeOffers, stores } from "~/db.server";
import { mixTitle } from "~/lib/pricing";
import { requireStore, requireViewer } from "~/lib/auth.server";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const store = await requireStore(await requireViewer(request), params.id);
  const offers = await db.select().from(freeOffers).where(eq(freeOffers.storeId, store.id)).orderBy(desc(freeOffers.createdAt));
  return json({
    storeId: store.id, offers,
    mix: {
      enabled: store.mixEnabled, buyQty: store.mixBuyQty, title: store.mixTitle ?? "",
      prepaid: { on: store.mixPrepaidOn, free: store.mixFreeQty, which: store.mixFreeWhich, keep: store.mixKeepPrepaid, pct: store.prepaidDiscountPct },
      cod: { on: store.mixCodOn, free: store.mixCodFreeQty, which: store.mixCodFreeWhich, keep: store.mixKeepCod, pct: store.codDiscountPct, codEnabled: store.codEnabled },
    },
  });
}

const int = (v: FormDataEntryValue | null, min: number, max: number, d: number) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : d;
};

/** Reads an add or edit form. Returns errors keyed for the form that sent it. */
function readOffer(fd: FormData) {
  const buyMode = fd.get("buyMode") === "any" ? "any" : "products";
  const buyProducts = buyMode === "products" ? parsePicked(fd.get("buyProducts")) : [];
  const freeProducts = parsePicked(fd.get("freeProducts"));
  const minQty = int(fd.get("minQty"), 1, 50, 1);
  const freeQty = int(fd.get("freeQty"), 1, 20, 1);
  const pr = String(fd.get("paymentRestriction") ?? "any");
  const errors: string[] = [];
  if (buyMode === "products" && !buyProducts.length) errors.push("Pick the products the customer has to buy, or choose “Any product”.");
  if (!freeProducts.length) errors.push("Pick at least one free product.");
  const name = String(fd.get("name") ?? "").trim().slice(0, 80)
    || `Buy ${minQty} get ${freeProducts.length * freeQty} free`;
  return {
    data: { name, buyMode, buyProducts, minQty, freeProducts, freeQty, repeat: fd.get("repeat") === "on", paymentRestriction: ["prepaid", "cod"].includes(pr) ? pr : "any" },
    error: errors[0] ?? null,
  };
}

export async function action({ request, params }: ActionFunctionArgs) {
  const store = await requireStore(await requireViewer(request), params.id);
  const fd = await request.formData();
  const id = Number(fd.get("id"));
  const own = and(eq(freeOffers.id, id), eq(freeOffers.storeId, store.id));

  switch (fd.get("intent")) {
    case "mix": {
      const enabled = fd.get("mixEnabled") === "on";
      const buyQty = int(fd.get("mixBuyQty"), 2, 50, 3);
      const prepaidOn = fd.get("mixPrepaidOn") === "on";
      const codOn = fd.get("mixCodOn") === "on";
      if (enabled && !prepaidOn && !codOn) return json({ ok: null, errors: { mix: "Turn the deal on for online payment, COD, or both." } as Record<string, string> }, { status: 400 });
      const free = (k: string) => Math.min(buyQty - 1, int(fd.get(k), 1, 49, 1));
      const which = (k: string) => (fd.get(k) === "high" ? "high" : "low");
      await db.update(stores).set({
        mixEnabled: enabled, mixBuyQty: buyQty,
        mixPrepaidOn: prepaidOn, mixFreeQty: free("mixFreeQty"), mixFreeWhich: which("mixFreeWhich"), mixKeepPrepaid: fd.get("mixKeepPrepaid") === "on",
        mixCodOn: codOn, mixCodFreeQty: free("mixCodFreeQty"), mixCodFreeWhich: which("mixCodFreeWhich"), mixKeepCod: fd.get("mixKeepCod") === "on",
        mixTitle: String(fd.get("mixTitle") ?? "").trim().slice(0, 60) || null,
      }).where(eq(stores.id, store.id));
      return json({ ok: enabled ? "Mix & Match deal is live on your checkout" : "Mix & Match deal turned off", errors: null });
    }
    case "add": {
      const r = readOffer(fd);
      if (r.error) return json({ ok: null, errors: { add: r.error } as Record<string, string> }, { status: 400 });
      await db.insert(freeOffers).values({ storeId: store.id, ...r.data });
      return json({ ok: `“${r.data.name}” is live`, errors: null });
    }
    case "update": {
      const r = readOffer(fd);
      if (r.error) return json({ ok: null, errors: { [`edit${id}`]: r.error } as Record<string, string> }, { status: 400 });
      await db.update(freeOffers).set(r.data).where(own);
      return json({ ok: `“${r.data.name}” updated`, errors: null });
    }
    case "toggle": {
      const [o] = await db.select().from(freeOffers).where(own);
      if (o) await db.update(freeOffers).set({ active: !o.active }).where(own);
      return json({ ok: null, errors: null });
    }
    case "delete":
      await db.delete(freeOffers).where(own);
      return json({ ok: "Offer deleted", errors: null });
  }
  return json({ ok: null, errors: { add: "Unknown action" } as Record<string, string> }, { status: 400 });
}

type Offer = ReturnType<typeof useLoaderData<typeof loader>>["offers"][number];

export default function Gifts() {
  const { storeId, offers, mix } = useLoaderData<typeof loader>();
  const res = useActionData<typeof action>();
  const errors = (res?.errors ?? {}) as Record<string, string>;

  return (
    <div className="max-w-4xl space-y-5">
      {res?.ok && <Notice tone="success">{res.ok}</Notice>}
      <MixDeal mix={mix} error={errors.mix} />

      <Notice>
        Free gifts are added to the checkout automatically at ₹0 when the cart qualifies, and go into the Shopify order at ₹0 with a “Free gift” note.
        Examples: <b>Buy 1 get 1</b> (buy A, free B), <b>Buy 2 get 1</b> (any 2 of A and B, free C), <b>Buy any 3 get 1</b> (any product).
      </Notice>

      <Section title="Create a free gift offer">
        <Form method="post" className="space-y-5" key={offers.length}>
          <OfferFields storeId={storeId} />
          {errors.add && <p className="error-text">{errors.add}</p>}
          <SubmitButton intent="add" busyText="Creating">Create offer</SubmitButton>
        </Form>
      </Section>

      {offers.length === 0 ? (
        <EmptyState title="No free gift offers yet">Create one above. It goes live on the checkout right away.</EmptyState>
      ) : (
        <section className="panel">
          <h2 className="border-b border-rule px-5 py-4 text-[15px] font-semibold">Your offers</h2>
          <ul className="divide-y divide-rule">
            {offers.map((o) => <OfferRow key={o.id} o={o} storeId={storeId} error={errors[`edit${o.id}`]} />)}
          </ul>
        </section>
      )}
    </div>
  );
}

function summary(o: Pick<Offer, "buyMode" | "buyProducts" | "minQty" | "freeProducts" | "freeQty" | "repeat">) {
  const buy = o.buyMode === "any" ? `any ${o.minQty} item${o.minQty === 1 ? "" : "s"}` : `${o.minQty} of ${o.buyProducts.map((p) => p.title).join(" / ")}`;
  const free = o.freeProducts.map((p) => (o.freeQty > 1 ? `${o.freeQty}× ${p.title}` : p.title)).join(" + ");
  return { buy, free, repeat: o.repeat ? `Repeats: every ${o.minQty} bought gets the gift again` : null };
}

function OfferRow({ o, storeId, error }: { o: Offer; storeId: number; error?: string }) {
  const [editing, setEditing] = useState(false);
  const nav = useNavigation();
  const saving = nav.state !== "idle" && nav.formData?.get("intent") === "update" && nav.formData?.get("id") === String(o.id);
  useEffect(() => { if (!saving && !error) setEditing(false); }, [saving]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (error) setEditing(true); }, [error]);
  const s = summary(o);

  return (
    <li className="px-5 py-4">
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-2 font-medium">
            <span aria-hidden>🎁</span>{o.name} <StatusBadge status={o.active ? "live" : "off"} label={o.active ? "Live" : "Paused"} />
            {o.paymentRestriction !== "any" && <span className="rounded bg-paper-sunk px-1.5 py-px text-[11px] font-medium text-ink-soft">{o.paymentRestriction === "prepaid" ? "Online payment only" : "COD only"}</span>}
          </p>
          <p className="mt-1 text-sm text-ink-soft"><span className="text-ink-faint">Buy</span> {s.buy}</p>
          <p className="text-sm text-ink-soft"><span className="text-ink-faint">Get free</span> <b className="text-good">{s.free}</b></p>
          {s.repeat && <p className="text-xs text-ink-faint">{s.repeat}</p>}
        </div>
        <div className="flex">
          <button type="button" className="btn-quiet" onClick={() => setEditing((e) => !e)} aria-expanded={editing}>{editing ? "Cancel" : "Edit"}</button>
          <RowAction intent="toggle" id={o.id} label={o.active ? "Pause" : "Resume"} />
          <RowAction intent="delete" id={o.id} label="Delete" danger confirm={`Delete "${o.name}"?`} />
        </div>
      </div>
      {editing && (
        <Form method="post" className="mt-4 space-y-5 rounded-lg border border-rule bg-paper/60 p-4">
          <input type="hidden" name="id" value={o.id} />
          <OfferFields storeId={storeId} o={o} />
          {error && <p className="error-text">{error}</p>}
          <div className="flex gap-2">
            <SubmitButton intent="update" busyText="Saving">Save changes</SubmitButton>
            <button type="button" className="btn-secondary" onClick={() => setEditing(false)}>Cancel</button>
          </div>
        </Form>
      )}
    </li>
  );
}

function OfferFields({ storeId, o }: { storeId: number; o?: Offer }) {
  const [mode, setMode] = useState(o?.buyMode === "any" ? "any" : "products");
  const [minQty, setMinQty] = useState(o?.minQty ?? 1);
  const [freeQty, setFreeQty] = useState(o?.freeQty ?? 1);
  const freeCount = Math.max(1, o?.freeProducts.length ?? 1);
  const gifts = freeCount * freeQty;

  return (
    <>
      <TextField label="Offer name (shown to customers)" name="name" defaultValue={o?.name} placeholder={`Buy ${minQty} get ${Math.max(1, gifts)} free`} maxLength={80} />

      <fieldset className="space-y-3 rounded-lg border border-rule p-4">
        <legend className="px-1 text-sm font-semibold">1. Customer buys</legend>
        <input type="hidden" name="buyMode" value={mode} />
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Which products count">
          {[["products", "Selected products"], ["any", "Any product"]].map(([v, l]) => (
            <button key={v} type="button" role="radio" aria-checked={mode === v} onClick={() => setMode(v)}
              className={`rounded-lg border px-3 py-1.5 text-sm ${mode === v ? "border-ink bg-ink font-medium text-white" : "border-rule-strong bg-surface text-ink-soft hover:text-ink"}`}>{l}</button>
          ))}
        </div>
        <div className="grid gap-4 sm:grid-cols-[160px_minmax(0,1fr)]">
          <label className="block">
            <span className="label">Minimum quantity</span>
            <input type="number" name="minQty" min={1} max={50} value={minQty} onChange={(e) => setMinQty(Math.max(1, Number(e.target.value) || 1))} className="input num" />
            <span className="hint">1 = Buy 1, 2 = Buy 2…</span>
          </label>
          {mode === "products" ? (
            <div>
              <span className="label">Products that count</span>
              <ProductPicker storeId={storeId} name="buyProducts" initial={(o?.buyProducts ?? []) as PickedProduct[]} placeholder="Search products the customer buys" />
              <span className="hint">Any mix counts. With A and B picked and minimum 2: A+A, A+B or B+B all qualify.</span>
            </div>
          ) : (
            <p className="self-center text-sm text-ink-soft">Every product in the store counts towards the minimum quantity.</p>
          )}
        </div>
      </fieldset>

      <fieldset className="space-y-3 rounded-lg border border-emerald-200 bg-emerald-50/40 p-4">
        <legend className="px-1 text-sm font-semibold">2. Customer gets free</legend>
        <ProductPicker storeId={storeId} name="freeProducts" initial={(o?.freeProducts ?? []) as PickedProduct[]} placeholder="Search free gift products" />
        <div className="grid gap-4 sm:grid-cols-[160px_minmax(0,1fr)]">
          <label className="block">
            <span className="label">Quantity of each</span>
            <input type="number" name="freeQty" min={1} max={20} value={freeQty} onChange={(e) => setFreeQty(Math.max(1, Number(e.target.value) || 1))} className="input num" />
          </label>
          <p className="self-center text-xs text-ink-faint">Pick several products to give them all. For Buy 1 get 2, pick 2 products, or 1 product with quantity 2. The first in-stock option of each gift is used.</p>
        </div>
      </fieldset>

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className="label">Payment</span>
          <select name="paymentRestriction" defaultValue={o?.paymentRestriction ?? "any"} className="input">
            <option value="any">Online and COD</option>
            <option value="prepaid">Online payment only</option>
            <option value="cod">COD only</option>
          </select>
        </label>
        <label className="flex items-start gap-2.5 self-end pb-2.5 text-sm">
          <input type="checkbox" name="repeat" defaultChecked={o?.repeat ?? false} className="mt-0.5 h-4 w-4 accent-[rgb(var(--brand))]" />
          <span>Repeat for every {minQty} bought<span className="block text-xs text-ink-faint">Buy {minQty * 2} → {Math.max(1, gifts) * 2} free</span></span>
        </label>
      </div>
    </>
  );
}

type Mix = ReturnType<typeof useLoaderData<typeof loader>>["mix"];
type Side = { on: boolean; free: number; which: "low" | "high"; keep: boolean };

const RS = (p: number) => "₹" + p.toLocaleString("en-IN");
const SAMPLE = [300, 750, 425, 550, 999, 650, 375, 820];

/** Which sample items are free and what the customer pays. */
function example(buy: number, side: Side) {
  const items = SAMPLE.slice(0, Math.max(3, buy));
  if (!side.on) return { items, free: new Set<number>(), pay: items.reduce((n, p) => n + p, 0) };
  const order = items.map((p, i) => ({ p, i })).sort((a, b) => (side.which === "high" ? b.p - a.p : a.p - b.p));
  const free = new Set(order.slice(0, side.free).map((x) => x.i));
  return { items, free, pay: items.reduce((n, p, i) => n + (free.has(i) ? 0 : p), 0) };
}

/** Store-wide "buy N, get M of them free" deal, set separately for online payment and COD. */
function MixDeal({ mix, error }: { mix: Mix; error?: string }) {
  const [on, setOn] = useState(mix.enabled);
  const [buy, setBuy] = useState(Math.max(2, mix.buyQty));
  const init = (x: { on: boolean; free: number; which: string; keep: boolean }): Side => ({ on: x.on, free: Math.max(1, x.free), which: x.which === "high" ? "high" : "low", keep: x.keep });
  const [pre, setPre] = useState<Side>(init(mix.prepaid));
  const [cod, setCod] = useState<Side>(init(mix.cod));
  useEffect(() => {
    setPre((s) => ({ ...s, free: Math.min(s.free, buy - 1) }));
    setCod((s) => ({ ...s, free: Math.min(s.free, buy - 1) }));
  }, [buy]);

  const sides: { key: "prepaid" | "cod"; label: string; icon: string; s: Side; set: (f: (s: Side) => Side) => void; pct: number; names: [string, string, string, string] }[] = [
    { key: "prepaid", label: "Online payment", icon: "💳", s: pre, set: setPre, pct: mix.prepaid.pct, names: ["mixPrepaidOn", "mixFreeQty", "mixFreeWhich", "mixKeepPrepaid"] },
    { key: "cod", label: "Cash on Delivery", icon: "💵", s: cod, set: setCod, pct: mix.cod.pct, names: ["mixCodOn", "mixCodFreeQty", "mixCodFreeWhich", "mixKeepCod"] },
  ];

    const summary = !pre.on && !cod.on ? "Turn on for at least one payment method."
    : `Online: ${pre.on ? `Buy ${buy - pre.free}, Get ${pre.free} Free (${pre.which === "low" ? "lowest" : "highest"} price)` : "off"} · COD: ${cod.on ? `Buy ${buy - cod.free}, Get ${cod.free} Free (${cod.which === "low" ? "lowest" : "highest"} price)` : "off"}`;
  return (
    <section className={`panel overflow-hidden ${on ? "ring-2 ring-pine/30" : ""}`}>
      <Form method="post">
        <div className="flex flex-wrap items-center gap-4 bg-[linear-gradient(135deg,#0E1714,#0B5D4B)] px-5 py-4 text-white">
          <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-white/10 text-2xl" aria-hidden>🛍️</span>
          <div className="min-w-0 flex-1">
            <p className="text-[15px] font-semibold">Mix & Match deal</p>
            <p className="text-sm text-white/75">Customer adds any {buy} items and some of them become free. Set it separately for online payment and COD.</p>
          </div>
          <label className="flex cursor-pointer items-center gap-2.5 text-sm font-medium">
            {on ? "On" : "Off"}
            <input type="checkbox" name="mixEnabled" checked={on} onChange={(e) => setOn(e.target.checked)} className="peer sr-only" />
            <span aria-hidden className={`relative h-6 w-11 rounded-full transition peer-focus-visible:ring-2 peer-focus-visible:ring-white ${on ? "bg-emerald-400" : "bg-white/25"}`}>
              <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${on ? "left-[22px]" : "left-0.5"}`} />
            </span>
          </label>
        </div>

        {/* Keep saved values when the whole deal is off */}
        {!on && (
          <>
            <input type="hidden" name="mixBuyQty" value={buy} />
            <input type="hidden" name="mixTitle" value={mix.title} />
            {sides.map((x) => (
              <span key={x.key}>
                {x.s.on && <input type="hidden" name={x.names[0]} value="on" />}
                <input type="hidden" name={x.names[1]} value={x.s.free} />
                <input type="hidden" name={x.names[2]} value={x.s.which} />
                {x.s.keep && <input type="hidden" name={x.names[3]} value="on" />}
              </span>
            ))}
          </>
        )}

                {on && (
          <div className="space-y-5 p-5">
            <div className="grid gap-4 sm:grid-cols-[200px_minmax(0,1fr)]">
              <label className="block">
                <span className="label">Items in cart</span>
                <input type="number" name="mixBuyQty" min={2} max={50} value={buy} onChange={(e) => setBuy(Math.max(2, Number(e.target.value) || 2))} className="input num" />
                <span className="hint">Minimum 2. Any products count.</span>
              </label>
              <label className="block">
                <span className="label">Title on checkout (optional)</span>
                <input name="mixTitle" defaultValue={mix.title} placeholder={`Buy ${buy - (pre.on ? pre.free : cod.free)}, Get ${pre.on ? pre.free : cod.free} Free`} maxLength={60} className="input" />
                <span className="hint">Leave empty to show the right title for each payment method automatically.</span>
              </label>
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              {sides.map((x) => {
                const ex = example(buy, x.s);
                return (
                  <fieldset key={x.key} className={`rounded-xl border-2 p-4 transition ${x.s.on ? "border-pine/40 bg-pine-tint/20" : "border-rule bg-paper/60"}`}>
                    <div className="flex items-center justify-between gap-3">
                      <legend className="flex items-center gap-2 text-sm font-semibold"><span aria-hidden>{x.icon}</span>{x.label}</legend>
                      <label className="flex cursor-pointer items-center gap-2 text-xs font-medium text-ink-soft">
                        {x.s.on ? "Deal on" : "Deal off"}
                        <input type="checkbox" name={x.names[0]} checked={x.s.on} onChange={(e) => x.set((s) => ({ ...s, on: e.target.checked }))} className="peer sr-only" />
                        <span aria-hidden className={`relative h-5 w-9 rounded-full transition peer-focus-visible:ring-2 peer-focus-visible:ring-brand ${x.s.on ? "bg-pine" : "bg-rule-strong"}`}>
                          <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all ${x.s.on ? "left-[18px]" : "left-0.5"}`} />
                        </span>
                      </label>
                    </div>
                    {x.key === "cod" && !mix.cod.codEnabled && <p className="mt-2 text-xs text-warn">COD is turned off for this store in Settings.</p>}

                    {x.s.on ? (
                      <div className="mt-4 space-y-3.5">
                        <label className="block">
                          <span className="label">Free items</span>
                          <input type="number" name={x.names[1]} min={1} max={buy - 1} value={x.s.free}
                            onChange={(e) => x.set((s) => ({ ...s, free: Math.min(buy - 1, Math.max(1, Number(e.target.value) || 1)) }))} className="input num" />
                          <span className="hint">Up to {buy - 1}.</span>
                        </label>
                        <div>
                          <span className="label">Which items are free</span>
                          <input type="hidden" name={x.names[2]} value={x.s.which} />
                          <div className="flex rounded-lg border border-rule-strong bg-surface p-0.5" role="radiogroup" aria-label={`Which items are free on ${x.label}`}>
                            {[["low", "Lowest price"], ["high", "Highest price"]].map(([v, l]) => (
                              <button key={v} type="button" role="radio" aria-checked={x.s.which === v} onClick={() => x.set((s) => ({ ...s, which: v as Side["which"] }))}
                                className={`flex-1 rounded-md px-2 py-1.5 text-sm ${x.s.which === v ? "bg-ink font-medium text-white" : "text-ink-soft hover:text-ink"}`}>{l}</button>
                            ))}
                          </div>
                        </div>
                        <label className="flex cursor-pointer items-start gap-2.5 text-sm">
                          <input type="checkbox" name={x.names[3]} checked={x.s.keep} onChange={(e) => x.set((s) => ({ ...s, keep: e.target.checked }))} className="mt-0.5 h-4 w-4 accent-[rgb(var(--brand))]" />
                          <span>Keep the {x.key === "prepaid" ? "online" : "COD"} discount ({x.pct}% + product discounts) with the deal
                            <span className="block text-xs text-ink-faint">{x.s.keep ? "Discount still applies to the items the customer pays for." : "Discount turns off once the deal applies."}</span></span>
                        </label>
                      </div>
                    ) : (
                      <>
                        <input type="hidden" name={x.names[1]} value={x.s.free} />
                        <input type="hidden" name={x.names[2]} value={x.s.which} />
                        {x.s.keep && <input type="hidden" name={x.names[3]} value="on" />}
                        <p className="mt-3 text-sm text-ink-soft">No Mix & Match on {x.label.toLowerCase()}. Normal discounts apply.</p>
                      </>
                    )}

                    <div className="mt-4 rounded-lg border border-rule bg-surface p-3">
                      <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint">Example cart</p>
                      <ul className="mt-2 space-y-1.5">
                        {ex.items.map((p, i) => (
                          <li key={i} className="flex items-center justify-between text-xs">
                            <span>Product {String.fromCharCode(65 + i)}</span>
                            {ex.free.has(i)
                              ? <span className="flex items-center gap-1.5"><s className="num text-ink-faint">{RS(p)}</s><b className="rounded bg-good px-1 py-px text-[10px] text-white">FREE</b></span>
                              : <span className="num font-medium">{RS(p)}</span>}
                          </li>
                        ))}
                      </ul>
                      <div className="mt-2 flex justify-between border-t border-rule pt-2 text-xs font-semibold"><span>Customer pays (before discounts)</span><span className="num">{RS(ex.pay)}</span></div>
                    </div>
                  </fieldset>
                );
              })}
            </div>

            <p className="text-xs text-ink-faint">
              More items than {buy} still get only the set number free. Coupons and bank offers always keep working.
              If one payment method gives more free items, checkout tells the customer (e.g. “Pay online and get 2 items FREE instead”).
              Shopify orders show it as a discount (MIXMATCH).
            </p>
          </div>
        )}

        <div className="flex items-center justify-between gap-3 border-t border-rule px-5 py-3">
          {error ? <p className="error-text mt-0">{error}</p> : <span className="text-xs text-ink-faint">{on ? summary : "Turn on to set it up."}</span>}
          <SubmitButton intent="mix" busyText="Saving">Save deal</SubmitButton>
        </div>
      </Form>
    </section>
  );
}
