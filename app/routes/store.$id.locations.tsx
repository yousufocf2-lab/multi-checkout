// Settings → Locations: warehouses, shops and offices a store keeps stock in or ships from.
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Form, useActionData, useLoaderData, useNavigation } from "@remix-run/react";
import { and, asc, desc, eq, ne, sql } from "drizzle-orm";
import { useEffect, useMemo, useState } from "react";
import { Card, Dialog, Field } from "~/components/settings-ui";
import { Icon } from "~/components/Icons";
import { Notice } from "~/components/ui";
import { db, storeLocations, type StoreLocation } from "~/db.server";
import { requireStore, requireViewer } from "~/lib/auth.server";
import { INDIAN_STATES } from "~/lib/states";
import { addressLines, COUNTRIES, countryOf } from "~/lib/store-profile";

const MAX = 25;
const KINDS = [
  { id: "warehouse", label: "Warehouse" },
  { id: "shop", label: "Shop / outlet" },
  { id: "office", label: "Office" },
  { id: "partner", label: "Fulfilment partner" },
] as const;
type Kind = (typeof KINDS)[number]["id"];

export async function loader({ request, params }: LoaderFunctionArgs) {
  const viewer = await requireViewer(request);
  const store = await requireStore(viewer, params.id);
  const list = await db.select().from(storeLocations).where(eq(storeLocations.storeId, store.id))
    .orderBy(desc(storeLocations.isDefault), desc(storeLocations.active), asc(storeLocations.name));
  return json({ list, country: store.country, max: MAX, business: store.business?.address ?? null });
}

export async function action({ request, params }: ActionFunctionArgs) {
  const viewer = await requireViewer(request);
  const store = await requireStore(viewer, params.id);
  const fd = await request.formData();
  const intent = String(fd.get("intent") ?? "");
  const id = Number(fd.get("id")) || null;
  const mine = id ? and(eq(storeLocations.id, id), eq(storeLocations.storeId, store.id)) : undefined;
  const str = (k: string, max = 160) => String(fd.get(k) ?? "").trim().slice(0, max);

  if (intent === "delete" && mine) {
    const [row] = await db.select().from(storeLocations).where(mine).limit(1);
    if (row?.isDefault) return json({ ok: null, error: "Make another location the default before deleting this one.", errors: null }, { status: 400 });
    await db.delete(storeLocations).where(mine);
    return json({ ok: "Location deleted", error: null, errors: null });
  }
  if (intent === "default" && mine) {
    await db.transaction(async (tx) => {
      await tx.update(storeLocations).set({ isDefault: false }).where(eq(storeLocations.storeId, store.id));
      await tx.update(storeLocations).set({ isDefault: true, active: true }).where(mine);
    });
    return json({ ok: "Default location changed", error: null, errors: null });
  }
  if (intent === "toggle" && mine) {
    const [row] = await db.select().from(storeLocations).where(mine).limit(1);
    if (row?.isDefault && row.active) return json({ ok: null, error: "The default location can't be turned off.", errors: null }, { status: 400 });
    await db.update(storeLocations).set({ active: !row?.active }).where(mine);
    return json({ ok: row?.active ? "Location turned off" : "Location turned on", error: null, errors: null });
  }
  if (intent === "save") {
    const errors: Record<string, string> = {};
    const name = str("name", 80);
    const country = COUNTRIES.some((c) => c.code === str("country")) ? str("country") : "IN";
    const pincode = str("pincode", 12);
    if (!name) errors.name = "Give this location a name.";
    if (!str("line1")) errors.line1 = "Enter the address.";
    if (!str("city", 80)) errors.city = "Enter the city.";
    if (country === "IN" && !/^\d{6}$/.test(pincode)) errors.pincode = "PIN code has 6 digits.";
    const kind = (KINDS.find((k) => k.id === str("kind"))?.id ?? "warehouse") as Kind;
    if (!id) {
      const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(storeLocations).where(eq(storeLocations.storeId, store.id));
      if (n >= MAX) errors.name = `You can add up to ${MAX} locations.`;
    }
    const [dup] = await db.select({ id: storeLocations.id }).from(storeLocations)
      .where(and(eq(storeLocations.storeId, store.id), sql`lower(${storeLocations.name}) = lower(${name})`, id ? ne(storeLocations.id, id) : undefined)).limit(1);
    if (dup) errors.name = "Another location already has this name.";
    if (Object.keys(errors).length) return json({ ok: null, error: null, errors }, { status: 400 });

    const data = {
      name, kind, phone: str("phone", 20) || null,
      address: { line1: str("line1"), line2: str("line2"), city: str("city", 80), state: str("state", 80), pincode, country },
      fulfilsOnline: fd.get("fulfilsOnline") === "on", pickup: fd.get("pickup") === "on",
    };
    if (mine) await db.update(storeLocations).set(data).where(mine);
    else {
      const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(storeLocations).where(eq(storeLocations.storeId, store.id));
      await db.insert(storeLocations).values({ ...data, storeId: store.id, isDefault: n === 0 });
    }
    return json({ ok: id ? "Location saved" : "Location added", error: null, errors: null });
  }
  return json({ ok: null, error: null, errors: null });
}

type Loc = Omit<StoreLocation, "createdAt"> & { createdAt: string };

export default function Locations() {
  const { list, country, max, business } = useLoaderData<typeof loader>();
  const a = useActionData<typeof action>();
  const nav = useNavigation();
  const [editing, setEditing] = useState<Loc | "new" | null>(null);
  const [q, setQ] = useState("");
  const [show, setShow] = useState<"all" | "active" | "off">("all");
  useEffect(() => { if (a?.ok) setEditing(null); }, [a]);

  const rows = useMemo(() => (list as Loc[]).filter((l) =>
    (show === "all" || (show === "active" ? l.active : !l.active))
    && (!q || `${l.name} ${addressLines(l.address).join(" ")}`.toLowerCase().includes(q.toLowerCase()))), [list, q, show]);
  const active = list.filter((l) => l.active).length;
  const busy = nav.state !== "idle" && nav.formData?.get("intent") === "save";
  const errors = (a?.errors ?? {}) as Record<string, string>;

  return (
    <div className="max-w-3xl space-y-4">
      {a?.ok && <Notice tone="success">{a.ok}</Notice>}
      {a?.error && <Notice tone="error">{a.error}</Notice>}

      <Card title="Your locations" description={`${active} active ${active === 1 ? "location" : "locations"} · up to ${max}. The default location is your pickup address for couriers and the origin for shipping rates.`}
        action={<button type="button" className="btn-primary btn shrink-0" onClick={() => setEditing("new")} disabled={list.length >= max}><Icon name="plus" className="h-3.5 w-3.5" />Add location</button>} flush>
        {list.length === 0 ? (
          <div className="border-t border-rule px-4 py-10 text-center">
            <span className="mx-auto flex h-10 w-10 items-center justify-center rounded-xl bg-[#f1f1f1] text-ink-soft"><Icon name="box" className="h-5 w-5" /></span>
            <p className="mt-3 text-[13px] font-semibold">Add where you keep your stock</p>
            <p className="mx-auto mt-1 max-w-sm text-[12.5px] text-ink-soft">Warehouses, shops or a fulfilment partner. Orders, stock and courier pickups use these addresses.</p>
            <button type="button" className="btn-primary btn mt-4" onClick={() => setEditing("new")}>Add your first location</button>
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2 border-t border-rule px-3 py-2">
              <div className="flex rounded-lg bg-[#f1f1f1] p-0.5 text-[12.5px]">
                {(["all", "active", "off"] as const).map((k) => (
                  <button key={k} type="button" onClick={() => setShow(k)} className={`rounded-md px-2.5 py-1 font-medium ${show === k ? "bg-white shadow-[0_0_0_1px_rgba(0,0,0,.08)]" : "text-ink-soft"}`}>{k === "all" ? "All" : k === "active" ? "Active" : "Off"}</button>
                ))}
              </div>
              <label className="flex h-8 min-w-0 flex-1 items-center gap-2 rounded-lg px-2 text-ink-soft shadow-[inset_0_0_0_1px_#e3e3e3] focus-within:shadow-[inset_0_0_0_1px_#005bd3]">
                <Icon name="search" className="h-3.5 w-3.5" />
                <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search locations" className="min-w-0 flex-1 bg-transparent text-[13px] text-ink outline-none" />
              </label>
            </div>
            <ul className="divide-y divide-rule border-t border-rule">
              {rows.map((l) => (
                <li key={l.id} className="flex items-start gap-3 px-4 py-3">
                  <span className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${l.active ? "bg-[#f1f1f1] text-ink-soft" : "bg-[#f7f7f7] text-ink-faint"}`}>
                    <Icon name={l.kind === "shop" ? "stores" : l.kind === "office" ? "home" : l.kind === "partner" ? "shipping" : "box"} className="h-4 w-4" />
                  </span>
                  <button type="button" className="min-w-0 flex-1 text-left" onClick={() => setEditing(l)}>
                    <p className="flex flex-wrap items-center gap-1.5 text-[13px] font-semibold">
                      {l.name}
                      {l.isDefault && <span className="rounded-md bg-[#e3f1df] px-1.5 py-px text-[11px] font-medium text-[#0c5132]">Default</span>}
                      {!l.active && <span className="rounded-md bg-[#f1f1f1] px-1.5 py-px text-[11px] font-medium text-ink-soft">Off</span>}
                    </p>
                    <p className="truncate text-[12.5px] text-ink-soft">{addressLines(l.address).join(", ")}</p>
                    <p className="mt-0.5 text-[11.5px] text-ink-faint">
                      {KINDS.find((k) => k.id === l.kind)?.label}{l.fulfilsOnline ? " · Ships online orders" : ""}{l.pickup ? " · Customer pickup" : ""}{l.phone ? ` · ${l.phone}` : ""}
                    </p>
                  </button>
                  <RowMenu l={l} />
                </li>
              ))}
              {rows.length === 0 && <li className="px-4 py-6 text-center text-[12.5px] text-ink-faint">No locations match.</li>}
            </ul>
          </>
        )}
      </Card>

      <Dialog open={editing !== null} onClose={() => setEditing(null)} title={editing === "new" ? "Add location" : "Edit location"} wide
        footer={<><button type="button" className="btn-secondary btn" onClick={() => setEditing(null)}>Cancel</button><button form="gp-loc" name="intent" value="save" className="btn-primary btn" disabled={busy}>{busy ? "Saving" : "Save"}</button></>}>
        {editing !== null && <LocationForm key={editing === "new" ? "new" : editing.id} l={editing === "new" ? null : editing} country={country} errors={errors} business={business} first={list.length === 0} />}
      </Dialog>
    </div>
  );
}

function RowMenu({ l }: { l: Loc }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [open]);
  const item = (intent: string, label: string, danger?: boolean) => (
    <Form method="post" onSubmit={(e) => { if (danger && !confirm(`Delete ${l.name}?`)) e.preventDefault(); }}>
      <input type="hidden" name="id" value={l.id} /><input type="hidden" name="intent" value={intent} />
      <button className={`block w-full rounded-lg px-3 py-1.5 text-left hover:bg-[#f7f7f7] ${danger ? "text-[#8e1f0b]" : ""}`}>{label}</button>
    </Form>
  );
  return (
    <div className="relative">
      <button type="button" onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }} className="flex h-7 w-7 items-center justify-center rounded-lg text-ink-soft hover:bg-black/5" aria-label={`Actions for ${l.name}`}>•••</button>
      {open && (
        <div className="absolute right-0 top-full z-20 mt-1 w-48 rounded-xl bg-white p-1 text-[13px] shadow-[0_0_0_1px_rgba(0,0,0,.08),0_12px_32px_-8px_rgba(0,0,0,.3)]" onClick={(e) => e.stopPropagation()}>
          {!l.isDefault && item("default", "Make default")}
          {!l.isDefault && item("toggle", l.active ? "Turn off" : "Turn on")}
          {!l.isDefault && item("delete", "Delete", true)}
          {l.isDefault && <p className="px-3 py-1.5 text-[12px] text-ink-faint">Default location. Make another one default to change it.</p>}
        </div>
      )}
    </div>
  );
}

function LocationForm({ l, country: storeCountry, errors, business, first }: { l: Loc | null; country: string; errors: Record<string, string>; business: Loc["address"] | null; first: boolean }) {
  const start = l?.address ?? (first && business ? business : null);
  const [country, setCountry] = useState(start?.country ?? storeCountry ?? "IN");
  const india = country === "IN";
  return (
    <Form method="post" id="gp-loc" className="space-y-3">
      {l && <input type="hidden" name="id" value={l.id} />}
      {!l && first && business?.line1 && <p className="rounded-lg bg-[#f1f8ff] px-3 py-2 text-[12px] text-[#00366c]">Filled in from your business address. Change it if your stock is somewhere else.</p>}
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_200px]">
        <Field label="Location name" hint="Only you see this, e.g. Lucknow warehouse." error={errors.name}><input name="name" defaultValue={l?.name ?? ""} className="input" placeholder="Main warehouse" /></Field>
        <Field label="Type"><select name="kind" defaultValue={l?.kind ?? "warehouse"} className="input">{KINDS.map((k) => <option key={k.id} value={k.id}>{k.label}</option>)}</select></Field>
      </div>
      <Field label="Country"><select name="country" value={country} onChange={(e) => setCountry(e.target.value)} className="input">
        {COUNTRIES.map((c) => <option key={c.code} value={c.code}>{c.flag} {c.name}</option>)}
      </select></Field>
      <Field label="Address" error={errors.line1}><input name="line1" defaultValue={start?.line1 ?? ""} className="input" placeholder="Building, street" /></Field>
      <Field label="Apartment, suite, landmark (optional)"><input name="line2" defaultValue={start?.line2 ?? ""} className="input" /></Field>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="City" error={errors.city}><input name="city" defaultValue={start?.city ?? ""} className="input" /></Field>
        <Field label="State">
          {india
            ? <select name="state" defaultValue={start?.state ?? ""} className="input"><option value="">Select a state</option>{INDIAN_STATES.map((s) => <option key={s.code} value={s.name}>{s.name}</option>)}</select>
            : <input name="state" defaultValue={start?.state ?? ""} className="input" />}
        </Field>
        <Field label={india ? "PIN code" : "Postal code"} error={errors.pincode}><input name="pincode" defaultValue={start?.pincode ?? ""} className="input" inputMode={india ? "numeric" : undefined} /></Field>
      </div>
      <Field label="Phone"><input name="phone" defaultValue={l?.phone ?? ""} className="input" placeholder={`${countryOf(country).dial} `} /></Field>
      <div className="space-y-2 border-t border-rule pt-3">
        <label className="flex cursor-pointer items-start gap-2.5 text-[13px]">
          <input type="checkbox" name="fulfilsOnline" defaultChecked={l?.fulfilsOnline ?? true} className="mt-0.5 h-4 w-4" />
          <span><b className="font-medium">Ship online orders from here</b><span className="block text-[12px] text-ink-faint">Couriers pick up from this address.</span></span>
        </label>
        <label className="flex cursor-pointer items-start gap-2.5 text-[13px]">
          <input type="checkbox" name="pickup" defaultChecked={l?.pickup ?? false} className="mt-0.5 h-4 w-4" />
          <span><b className="font-medium">Customers can pick up orders here</b><span className="block text-[12px] text-ink-faint">Shown as a pickup option at checkout once store pickup is on.</span></span>
        </label>
      </div>
    </Form>
  );
}
