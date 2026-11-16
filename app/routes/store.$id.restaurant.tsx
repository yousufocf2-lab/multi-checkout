// Restaurant → Settings: how this restaurant / cloud kitchen takes orders.
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Form, Link, useActionData, useLoaderData, useNavigation } from "@remix-run/react";
import { eq } from "drizzle-orm";
import { useEffect, useState } from "react";
import { Icon } from "~/components/Icons";
import { Notice, PageHeader } from "~/components/ui";
import { db, stores } from "~/db.server";
import { requireStore, requireViewer } from "~/lib/auth.server";
import { DAYS, DELIVERY_PARTNERS, openNow, resolveRestaurant, type RestaurantSettings } from "~/lib/restaurant";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const viewer = await requireViewer(request);
  const store = await requireStore(viewer, params.id);
  if (store.businessType !== "restaurant") throw new Response("These settings are for restaurants and cloud kitchens.", { status: 404 });
  const r = resolveRestaurant(store.restaurant);
  return json({ r, open: openNow(r) });
}

export async function action({ request, params }: ActionFunctionArgs) {
  const viewer = await requireViewer(request);
  const store = await requireStore(viewer, params.id);
  if (store.businessType !== "restaurant") throw new Response("Not found", { status: 404 });
  const fd = await request.formData();
  const intent = String(fd.get("intent") ?? "save");
  const cur = resolveRestaurant(store.restaurant);
  if (intent === "pause" || intent === "resume") {
    const m = Number(fd.get("minutes") ?? 0);
    const until = intent === "resume" ? null : m === -1
      ? (() => { const d = new Date(Date.now() + 5.5 * 3600_000); d.setUTCHours(23, 59, 0, 0); return new Date(d.getTime() - 5.5 * 3600_000).toISOString(); })()
      : new Date(Date.now() + Math.min(Math.max(m, 5), 24 * 60) * 60_000).toISOString();
    await db.update(stores).set({ restaurant: { ...cur, pausedUntil: until } }).where(eq(stores.id, store.id));
    return json({ ok: intent === "resume" ? "Taking orders again." : "Orders paused.", error: null });
  }
  let raw: RestaurantSettings;
  try { raw = JSON.parse(String(fd.get("settings") ?? "{}")); } catch { return json({ ok: null, error: "Couldn't read the settings. Reload and try again." }, { status: 400 }); }
  const next = resolveRestaurant({ ...raw, pausedUntil: cur.pausedUntil });
  if (!next.modes.delivery && !next.modes.takeaway && !next.modes.dineIn) return json({ ok: null, error: "Turn on at least one way to order: delivery, takeaway or dine-in." }, { status: 400 });
  await db.update(stores).set({ restaurant: next }).where(eq(stores.id, store.id));
  return json({ ok: "Saved.", error: null });
}

type R = ReturnType<typeof resolveRestaurant>;

export default function RestaurantSettingsPage() {
  const d = useLoaderData<typeof loader>();
  const a = useActionData<typeof action>();
  const nav = useNavigation();
  const [r, setR] = useState<R>(d.r);
  useEffect(() => setR(d.r), [d.r]);
  const dirty = JSON.stringify(r) !== JSON.stringify(d.r);
  const set = <K extends keyof R>(k: K, v: R[K]) => setR((x) => ({ ...x, [k]: v }));
  const setDl = (p: Partial<R["delivery"]>) => setR((x) => ({ ...x, delivery: { ...x.delivery, ...p } }));
  const setDay = (i: number, p: Partial<R["hours"][number]>) => setR((x) => ({ ...x, hours: x.hours.map((h, j) => (j === i ? { ...h, ...p } : h)) }));
  const [tablesText, setTablesText] = useState(d.r.tables.join(", "));
  useEffect(() => setTablesText(d.r.tables.join(", ")), [d.r.tables]);
  const paused = d.r.pausedUntil && new Date(d.r.pausedUntil) > new Date();

  return (
    <div className="max-w-[960px] space-y-5">
      <PageHeader title="Restaurant settings" icon="settings" description="How customers order from you: delivery, takeaway and dine-in, your hours and delivery area."
        actions={<Link to="../kitchen" relative="path" className="btn-secondary h-9"><Icon name="bell" className="h-4 w-4" />Kitchen screen</Link>} />

      {a?.ok && <Notice tone="success">{a.ok}</Notice>}
      {a?.error && <Notice tone="error">{a.error}</Notice>}

      {/* Open / pause */}
      <section className="panel flex flex-wrap items-center gap-3 p-4">
        <span className={`inline-flex items-center gap-2 text-sm font-semibold ${d.open.open ? "text-[#0B5D4B]" : "text-[#b42318]"}`}>
          <i className={`h-2.5 w-2.5 rounded-full ${d.open.open ? "bg-[#1baf7a]" : "bg-[#d92d20]"}`} />
          {d.open.open ? "Open, taking orders" : paused ? `Paused until ${new Date(d.r.pausedUntil!).toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "numeric", minute: "2-digit" })}` : "Closed now (outside your hours)"}
        </span>
        <Form method="post" className="ml-auto flex flex-wrap items-center gap-1.5">
          {paused ? (
            <button name="intent" value="resume" className="btn-primary h-9">Resume orders</button>
          ) : (
            <>
              <span className="text-xs text-ink-soft">Busy? Pause new orders for</span>
              <input type="hidden" name="intent" value="pause" />
              {[[30, "30 min"], [60, "1 hour"], [-1, "Rest of today"]].map(([m, l]) => <button key={m} name="minutes" value={m} className="btn-secondary h-8 text-[12.5px]">{l}</button>)}
            </>
          )}
        </Form>
      </section>

      <Form method="post" className="space-y-5">
        <input type="hidden" name="intent" value="save" />
        <input type="hidden" name="settings" value={JSON.stringify({ ...r, tables: tablesText.split(/[,\n]/).map((t) => t.trim()).filter(Boolean) })} />

        <Card title="How customers order" hint="Turn on the ways you serve food.">
          <div className="grid gap-3 sm:grid-cols-3">
            {([["delivery", "Delivery", "We bring it to their address"], ["takeaway", "Takeaway", "They order and pick it up"], ["dineIn", "Dine-in", "They order at the table (QR)"]] as const).map(([k, l, h]) => (
              <label key={k} className={`flex cursor-pointer gap-3 rounded-xl border-2 p-3 transition ${r.modes[k] ? "border-ink bg-[#f7f8fa]" : "border-rule"}`}>
                <input type="checkbox" className="mt-0.5 h-4 w-4" checked={r.modes[k]} onChange={(e) => set("modes", { ...r.modes, [k]: e.target.checked })} />
                <span><span className="block text-sm font-semibold">{l}</span><span className="text-xs text-ink-soft">{h}</span></span>
              </label>
            ))}
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <Num label="Usual cooking time" suffix="min" value={r.prepMinutes} onChange={(v) => set("prepMinutes", v)} hint="Shown to customers and used to flag late orders in the kitchen." />
            {r.modes.takeaway && <Num label="Minimum order for takeaway" prefix="₹" value={r.takeawayMinOrder} onChange={(v) => set("takeawayMinOrder", v)} />}
          </div>
        </Card>

        <Card title="Opening hours" hint="Orders are taken only in these hours (India time). A slot can go past midnight, like 6 PM to 2 AM.">
          <div className="divide-y divide-rule">
            {DAYS.map((day, i) => {
              const h = r.hours[i];
              return (
                <div key={day} className="flex flex-wrap items-center gap-3 py-2.5">
                  <span className="w-24 text-sm font-medium">{day}</span>
                  <label className="inline-flex items-center gap-1.5 text-[13px] text-ink-soft"><input type="checkbox" className="h-4 w-4" checked={!h.closed} onChange={(e) => setDay(i, { closed: !e.target.checked })} />Open</label>
                  {!h.closed ? (
                    <div className="flex flex-1 flex-wrap items-center gap-2">
                      {h.slots.map((s, j) => (
                        <span key={j} className="inline-flex items-center gap-1 rounded-lg bg-paper-sunk px-1.5 py-1">
                          <input type="time" value={s.open} onChange={(e) => setDay(i, { slots: h.slots.map((x, k) => (k === j ? { ...x, open: e.target.value } : x)) })} className="input h-8 w-[110px] text-[13px]" aria-label={`${day} opens`} />
                          <span className="text-xs text-ink-faint">to</span>
                          <input type="time" value={s.close} onChange={(e) => setDay(i, { slots: h.slots.map((x, k) => (k === j ? { ...x, close: e.target.value } : x)) })} className="input h-8 w-[110px] text-[13px]" aria-label={`${day} closes`} />
                          {h.slots.length > 1 && <button type="button" onClick={() => setDay(i, { slots: h.slots.filter((_, k) => k !== j) })} className="rounded p-1 text-ink-faint hover:text-ink" aria-label="Remove slot"><Icon name="close" className="h-3.5 w-3.5" /></button>}
                        </span>
                      ))}
                      {h.slots.length < 3 && <button type="button" onClick={() => setDay(i, { slots: [...h.slots, { open: "18:00", close: "23:00" }] })} className="text-[12.5px] font-medium text-ink-soft hover:text-ink">+ Add break / slot</button>}
                    </div>
                  ) : <span className="text-[13px] text-ink-faint">Closed all day</span>}
                  {i === 0 && <button type="button" onClick={() => set("hours", r.hours.map(() => ({ ...r.hours[0], slots: r.hours[0].slots.map((s) => ({ ...s })) })))} className="ml-auto text-[12.5px] font-medium text-ink-soft underline decoration-dotted hover:text-ink">Copy to all days</button>}
                </div>
              );
            })}
          </div>
        </Card>

        {r.modes.delivery && (
          <Card title="Delivery" hint="Who delivers, how far, and what it costs.">
            <div className="grid gap-3 sm:grid-cols-2">
              {([["own", "Our own riders", "Your team delivers. You assign riders yourself."], ["third_party", "A delivery partner", "Porter, Shadowfax, Borzo and others pick up from you."]] as const).map(([k, l, h]) => (
                <label key={k} className={`flex cursor-pointer gap-3 rounded-xl border-2 p-3 transition ${r.delivery.by === k ? "border-ink bg-[#f7f8fa]" : "border-rule"}`}>
                  <input type="radio" name="by" className="mt-0.5 h-4 w-4" checked={r.delivery.by === k} onChange={() => setDl({ by: k })} />
                  <span><span className="block text-sm font-semibold">{l}</span><span className="text-xs text-ink-soft">{h}</span></span>
                </label>
              ))}
            </div>
            {r.delivery.by === "third_party" && (
              <label className="mt-3 block max-w-xs text-[13px] font-medium">Delivery partner
                <select value={r.delivery.partner} onChange={(e) => setDl({ partner: e.target.value })} className="input mt-1 h-9 w-full">
                  <option value="">Choose…</option>
                  {DELIVERY_PARTNERS.map((p) => <option key={p} value={p}>{p}</option>)}
                </select>
                <span className="mt-1 block text-xs font-normal text-ink-faint">Booking the partner from the kitchen screen comes next. For now, book them in their own app.</span>
              </label>
            )}
            <div className="mt-4 grid gap-3 sm:grid-cols-4">
              <Num label="Deliver up to" suffix="km" step={0.5} value={r.delivery.radiusKm} onChange={(v) => setDl({ radiusKm: v })} />
              <Num label="Minimum order" prefix="₹" value={r.delivery.minOrder} onChange={(v) => setDl({ minOrder: v })} />
              <Num label="Free delivery above" prefix="₹" value={r.delivery.freeAbove ?? 0} onChange={(v) => setDl({ freeAbove: v > 0 ? v : null })} hint="0 = never free" />
              <Num label="Time on the road" suffix="min" value={r.delivery.etaMinutes} onChange={(v) => setDl({ etaMinutes: v })} />
            </div>
            <div className="mt-4">
              <p className="mb-1.5 text-[13px] font-medium">Delivery charge by distance</p>
              <div className="overflow-hidden rounded-xl border border-rule">
                {r.delivery.slabs.map((s, i) => (
                  <div key={i} className="flex flex-wrap items-center gap-2 border-b border-rule px-3 py-2 last:border-0">
                    <span className="text-[13px] text-ink-soft">{i === 0 ? "Up to" : `Above ${r.delivery.slabs[i - 1].upToKm} km, up to`}</span>
                    <input type="number" min={0.5} step={0.5} value={s.upToKm} onChange={(e) => setDl({ slabs: r.delivery.slabs.map((x, j) => (j === i ? { ...x, upToKm: Number(e.target.value) } : x)) })} className="input h-8 w-20 text-[13px]" aria-label="Up to km" />
                    <span className="text-[13px] text-ink-soft">km:</span>
                    <span className="text-[13px]">₹</span>
                    <input type="number" min={0} value={s.fee} onChange={(e) => setDl({ slabs: r.delivery.slabs.map((x, j) => (j === i ? { ...x, fee: Number(e.target.value) } : x)) })} className="input h-8 w-24 text-[13px]" aria-label="Fee" />
                    {r.delivery.slabs.length > 1 && <button type="button" onClick={() => setDl({ slabs: r.delivery.slabs.filter((_, j) => j !== i) })} className="ml-auto rounded p-1 text-ink-faint hover:text-ink" aria-label="Remove"><Icon name="close" className="h-4 w-4" /></button>}
                  </div>
                ))}
              </div>
              {r.delivery.slabs.length < 8 && <button type="button" onClick={() => { const last = r.delivery.slabs[r.delivery.slabs.length - 1]; setDl({ slabs: [...r.delivery.slabs, { upToKm: (last?.upToKm ?? 0) + 2, fee: (last?.fee ?? 0) + 20 }] }); }} className="mt-2 text-[12.5px] font-medium text-ink-soft hover:text-ink">+ Add distance slab</button>}
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_140px_140px]">
              <label className="block text-[13px] font-medium">Kitchen address
                <input value={r.location.address} onChange={(e) => set("location", { ...r.location, address: e.target.value })} className="input mt-1 h-9 w-full" placeholder="Shop no., street, area, city" />
              </label>
              <label className="block text-[13px] font-medium">Latitude
                <input value={r.location.lat ?? ""} onChange={(e) => set("location", { ...r.location, lat: e.target.value === "" ? null : Number(e.target.value) })} inputMode="decimal" className="input mt-1 h-9 w-full" placeholder="28.6139" />
              </label>
              <label className="block text-[13px] font-medium">Longitude
                <input value={r.location.lng ?? ""} onChange={(e) => set("location", { ...r.location, lng: e.target.value === "" ? null : Number(e.target.value) })} inputMode="decimal" className="input mt-1 h-9 w-full" placeholder="77.2090" />
              </label>
            </div>
            <p className="mt-1 text-xs text-ink-faint">Open your kitchen in Google Maps, long-press the pin and copy the two numbers. They're used to measure delivery distance.</p>
          </Card>
        )}

        {r.modes.dineIn && (
          <Card title="Tables" hint="Each table gets its own QR code (coming in the next update). Separate with commas.">
            <textarea value={tablesText} onChange={(e) => setTablesText(e.target.value)} rows={2} className="input w-full text-[13px]" placeholder="1, 2, 3, 4, Garden 1, Garden 2" />
            <p className="mt-1 text-xs text-ink-faint">{tablesText.split(/[,\n]/).map((t) => t.trim()).filter(Boolean).length} tables</p>
          </Card>
        )}

        <Card title="Kitchen" hint="How new orders arrive on the kitchen screen.">
          <label className="flex items-start gap-2.5 py-1 text-sm"><input type="checkbox" className="mt-0.5 h-4 w-4" checked={r.kitchen.sound} onChange={(e) => set("kitchen", { ...r.kitchen, sound: e.target.checked })} /><span>Ring for new orders<span className="block text-xs text-ink-faint">Tap "Turn on sound" once on the kitchen screen.</span></span></label>
          <label className="flex items-start gap-2.5 py-1 text-sm"><input type="checkbox" className="mt-0.5 h-4 w-4" checked={r.kitchen.autoAccept} onChange={(e) => set("kitchen", { ...r.kitchen, autoAccept: e.target.checked })} /><span>Accept new orders automatically<span className="block text-xs text-ink-faint">They go straight to Preparing. You can still reject one.</span></span></label>
        </Card>

        <div className="sticky bottom-3 z-10 flex items-center gap-3 rounded-xl bg-white/90 p-3 shadow-lift backdrop-blur">
          <span className="text-[13px] text-ink-soft">{dirty ? "You have unsaved changes" : "All changes saved"}</span>
          <button type="button" disabled={!dirty} onClick={() => { setR(d.r); setTablesText(d.r.tables.join(", ")); }} className="btn-secondary ml-auto h-9">Discard</button>
          <button className="btn-primary h-9" disabled={!dirty || nav.state !== "idle"}>{nav.state === "submitting" ? "Saving…" : "Save"}</button>
        </div>
      </Form>
    </div>
  );
}

function Card({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="panel p-5">
      <h2 className="text-[15px] font-semibold">{title}</h2>
      {hint && <p className="mb-3 mt-0.5 text-[13px] text-ink-soft">{hint}</p>}
      {children}
    </section>
  );
}

function Num({ label, value, onChange, prefix, suffix, hint, step = 1 }: { label: string; value: number; onChange: (v: number) => void; prefix?: string; suffix?: string; hint?: string; step?: number }) {
  return (
    <label className="block text-[13px] font-medium">{label}
      <span className="mt-1 flex items-center overflow-hidden rounded-[9px] border border-[#d1d5dc] bg-white focus-within:border-ink">
        {prefix && <span className="pl-3 text-ink-soft">{prefix}</span>}
        <input type="number" min={0} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} className="h-9 w-full min-w-0 border-0 bg-transparent px-2 text-[13px] outline-none" />
        {suffix && <span className="pr-3 text-xs text-ink-soft">{suffix}</span>}
      </span>
      {hint && <span className="mt-1 block text-xs font-normal text-ink-faint">{hint}</span>}
    </label>
  );
}
