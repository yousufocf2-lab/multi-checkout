import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Form, useActionData, useLoaderData, useNavigation } from "@remix-run/react";
import { and, desc, eq } from "drizzle-orm";
import { useEffect, useState } from "react";
import { ProductPicker, parsePicked, type PickedProduct } from "~/components/ProductPicker";
import { EmptyState, Notice, RowAction, Section, StatusBadge, SubmitButton, TextField } from "~/components/ui";
import { db, freeOffers } from "~/db.server";
import { requireStore, requireViewer } from "~/lib/auth.server";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const store = await requireStore(await requireViewer(request), params.id);
  const offers = await db.select().from(freeOffers).where(eq(freeOffers.storeId, store.id)).orderBy(desc(freeOffers.createdAt));
  return json({ storeId: store.id, offers });
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
  const { storeId, offers } = useLoaderData<typeof loader>();
  const res = useActionData<typeof action>();
  const errors = (res?.errors ?? {}) as Record<string, string>;

  return (
    <div className="max-w-4xl space-y-5">
      {res?.ok && <Notice tone="success">{res.ok}</Notice>}
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
