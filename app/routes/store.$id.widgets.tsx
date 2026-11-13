// Settings → Widgets: add-ons for the store's website: product reviews (stars, photos/videos, approval rules, colours) and product filters (which filters, where, how they look).
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Form, Link, useActionData, useLoaderData, useSearchParams } from "@remix-run/react";
import { useState } from "react";
import { and, eq, sql } from "drizzle-orm";
import { Card } from "~/components/settings-ui";
import { Notice, SubmitButton } from "~/components/ui";
import { catalogItems, db, productReviews, stores } from "~/db.server";
import { can, requireStore, requireViewer } from "~/lib/auth.server";
import { storePath } from "~/lib/store-code";
import { filterSettings, reviewSettings, widgetSettings, FILTER_DEFAULTS, FILTER_TYPES, REVIEW_DEFAULTS, SORTS, type FilterDef, type FilterSettings, type FilterType, type ReviewSettings } from "~/lib/widgets";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const viewer = await requireViewer(request);
  const store = await requireStore(viewer, params.id);
  if (!can(viewer, "settings")) throw new Response("Not allowed", { status: 403 });
  const [pending] = await db.select({ n: sql<number>`count(*)::int` }).from(productReviews).where(and(eq(productReviews.storeId, store.id), eq(productReviews.status, "pending")));
  // Option names (Colour, Size…) and tag prefixes (age:, material:…) in this store's catalog, offered as filters
  const [opts, tags] = await Promise.all([
    db.execute(sql`select o->>'name' as name, count(*)::int as n from ${catalogItems}, jsonb_array_elements(${catalogItems.options}) o where ${catalogItems.storeId} = ${store.id} and ${catalogItems.status} = 'active' group by 1 order by 2 desc limit 20`),
    db.execute(sql`select split_part(t, ':', 1) as name, count(*)::int as n from ${catalogItems}, jsonb_array_elements_text(${catalogItems.tags}) t where ${catalogItems.storeId} = ${store.id} and t like '%:%' group by 1 order by 2 desc limit 20`),
  ]);
  const names = (r: unknown) => ((r as { rows?: { name: string }[] }).rows ?? (r as { name: string }[])).map((x) => String(x.name ?? "").trim()).filter((n) => n && n.length <= 40);
  const w = widgetSettings(store.widgetSettings);
  return json({ storeId: store.id, reviews: w.reviews, filters: w.filters, pending: Number(pending?.n ?? 0), optionNames: names(opts), tagNames: names(tags).filter((n) => !["badge", "chip"].includes(n.toLowerCase())) });
}

export async function action({ request, params }: ActionFunctionArgs) {
  const viewer = await requireViewer(request);
  const store = await requireStore(viewer, params.id);
  if (!can(viewer, "settings")) throw new Response("Not allowed", { status: 403 });
  const fd = await request.formData();
  const current = (store.widgetSettings ?? {}) as Record<string, unknown>;
  if (fd.get("intent") === "filters") {
    let raw: unknown = null;
    try { raw = JSON.parse(String(fd.get("filters") ?? "null")); } catch { return json({ ok: null, error: "Couldn't read those settings. Please try again." }, { status: 400 }); }
    await db.update(stores).set({ widgetSettings: { ...current, filters: filterSettings(raw) } }).where(eq(stores.id, store.id));
    return json({ ok: "Saved. Category and search pages use these filters now.", error: null });
  }
  const on = (k: string) => fd.get(k) === "on";
  const reviews = reviewSettings({
    enabled: on("enabled"), starLight: String(fd.get("starLight") ?? ""), starDark: String(fd.get("starDark") ?? ""),
    textLight: String(fd.get("textLight") ?? ""), textDark: String(fd.get("textDark") ?? ""),
    allowPhotos: on("allowPhotos"), allowVideos: on("allowVideos"), maxVideoSeconds: Number(fd.get("maxVideoSeconds")), maxMedia: Number(fd.get("maxMedia")),
    moderation: String(fd.get("moderation")) as ReviewSettings["moderation"], lowUpTo: Number(fd.get("lowUpTo")), checkMedia: on("checkMedia"),
    showVerified: on("showVerified"), showDate: on("showDate"), showBreakdown: on("showBreakdown"), sort: String(fd.get("sort")) as ReviewSettings["sort"],
  });
  await db.update(stores).set({ widgetSettings: { ...current, reviews } }).where(eq(stores.id, store.id));
  return json({ ok: "Saved. Your website uses these settings now.", error: null });
}

export default function Widgets() {
  const d = useLoaderData<typeof loader>();
  const a = useActionData<typeof action>();
  const [sp, setSp] = useSearchParams();
  const tab = sp.get("w") === "filters" ? "filters" : "reviews";
  return (
    <div className="mx-auto max-w-[820px] space-y-4">
      <div className="flex gap-1 rounded-xl bg-[#ebebeb] p-1 text-[13px] font-medium" role="tablist">
        {([["reviews", "Product reviews"], ["filters", "Product filters"]] as const).map(([k, label]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setSp(k === "reviews" ? {} : { w: k }, { replace: true, preventScrollReset: true })}
            className={`flex-1 rounded-[9px] px-3 py-1.5 ${tab === k ? "bg-white shadow-[0_1px_2px_rgba(0,0,0,.12)]" : "text-ink-soft hover:text-ink"}`}>{label}</button>
        ))}
      </div>
      {a?.ok && <Notice tone="success">{a.ok}</Notice>}
      {a?.error && <Notice tone="error">{a.error}</Notice>}
      {tab === "reviews" ? <ReviewsForm /> : <FiltersForm />}
    </div>
  );
}

function ReviewsForm() {
  const d = useLoaderData<typeof loader>();
  const [s, setS] = useState<ReviewSettings>(d.reviews);
  const set = <K extends keyof ReviewSettings>(k: K, v: ReviewSettings[K]) => setS((x) => ({ ...x, [k]: v }));
  const rule = s.moderation === "none" ? "Every review goes live straight away." : s.moderation === "low" ? `Reviews with ${s.lowUpTo === 1 ? "1 star" : `1 to ${s.lowUpTo} stars`} wait for you; higher ratings go live straight away.` : "Every review waits until you approve it.";

  return (
    <Form method="post" className="space-y-4">

      <Card>
        <label className="flex items-start gap-3 pt-4">
          <input type="checkbox" name="enabled" checked={s.enabled} onChange={(e) => set("enabled", e.target.checked)} className="mt-1" />
          <span className="flex-1">
            <span className="block text-[14px] font-semibold">Product reviews</span>
            <span className="block text-[13px] text-ink-soft">Star ratings, written reviews, photos and short videos from your customers. When this is on, the theme editor shows where to place the stars and the reviews.</span>
          </span>
          <Link to={`${storePath(d.storeId)}/reviews`} className="btn-secondary h-8 shrink-0">Manage reviews{d.pending ? ` · ${d.pending} waiting` : ""}</Link>
        </label>
      </Card>

      <fieldset disabled={!s.enabled} className="space-y-4 disabled:opacity-50">
        <Card title="Who checks reviews before they go live" description={rule}>
          <Choice name="moderation" value={s.moderation} onChange={(v) => set("moderation", v as ReviewSettings["moderation"])} options={[["all", "I approve every review"], ["low", "Only low ratings"], ["none", "Publish straight away"]]} />
          {s.moderation === "low" && (
            <div className="mt-3 flex flex-wrap items-center gap-2 text-[13px]">
              <span>Check ratings from 1 up to</span>
              <div className="flex gap-1">{[1, 2, 3, 4].map((n) => (
                <label key={n} className={`cursor-pointer rounded-lg px-2.5 py-1 ${s.lowUpTo === n ? "bg-[#303030] text-white" : "shadow-[0_0_0_1px_rgba(0,0,0,.12)]"}`}>
                  <input type="radio" name="lowUpTo" value={n} checked={s.lowUpTo === n} onChange={() => set("lowUpTo", n)} className="sr-only" />{n} ★
                </label>
              ))}</div>
            </div>
          )}
          {s.moderation !== "low" && <input type="hidden" name="lowUpTo" value={s.lowUpTo} />}
          <Check name="checkMedia" checked={s.checkMedia} onChange={(v) => set("checkMedia", v)} label="Always check reviews that have photos or videos" hint="Recommended: you see every picture and clip before shoppers do." />
        </Card>

        <Card title="Photos and videos" description="Customers can add pictures and short clips to their review.">
          <Check name="allowPhotos" checked={s.allowPhotos} onChange={(v) => set("allowPhotos", v)} label="Allow photos" />
          <Check name="allowVideos" checked={s.allowVideos} onChange={(v) => set("allowVideos", v)} label="Allow short videos" />
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <label className="block text-[13px]"><span className="label">Longest video</span>
              <select name="maxVideoSeconds" value={s.maxVideoSeconds} onChange={(e) => set("maxVideoSeconds", Number(e.target.value))} className="input w-full" disabled={!s.allowVideos}>
                {[15, 30, 45, 60, 90].map((n) => <option key={n} value={n}>{n} seconds</option>)}
              </select></label>
            <label className="block text-[13px]"><span className="label">Most files per review</span>
              <select name="maxMedia" value={s.maxMedia} onChange={(e) => set("maxMedia", Number(e.target.value))} className="input w-full">
                {[1, 2, 3, 4, 5, 6, 8].map((n) => <option key={n} value={n}>{n}</option>)}
              </select></label>
          </div>
          {!s.allowVideos && <input type="hidden" name="maxVideoSeconds" value={s.maxVideoSeconds} />}
        </Card>

        <Card title="Colours" description="The theme picks the light or dark set from your website’s background colour.">
          <div className="grid gap-4 sm:grid-cols-2">
            <ColorSet title="Light background" bg="#ffffff" star={s.starLight} text={s.textLight} onStar={(v) => set("starLight", v)} onText={(v) => set("textLight", v)} starName="starLight" textName="textLight" defStar={REVIEW_DEFAULTS.starLight} />
            <ColorSet title="Dark background" bg="#121212" star={s.starDark} text={s.textDark} onStar={(v) => set("starDark", v)} onText={(v) => set("textDark", v)} starName="starDark" textName="textDark" defStar={REVIEW_DEFAULTS.starDark} />
          </div>
        </Card>

        <Card title="What shoppers see">
          <Check name="showBreakdown" checked={s.showBreakdown} onChange={(v) => set("showBreakdown", v)} label="Rating bars (how many 5★, 4★…)" />
          <Check name="showVerified" checked={s.showVerified} onChange={(v) => set("showVerified", v)} label="“Verified buyer” tag on reviews you mark as verified" />
          <Check name="showDate" checked={s.showDate} onChange={(v) => set("showDate", v)} label="Review date" />
          <label className="mt-3 block max-w-[280px] text-[13px]"><span className="label">Show first</span>
            <select name="sort" value={s.sort} onChange={(e) => set("sort", e.target.value as ReviewSettings["sort"])} className="input w-full">
              <option value="newest">Newest</option><option value="highest">Highest rating</option><option value="media">With photos and videos</option>
            </select></label>
        </Card>
      </fieldset>
      {!s.enabled && <>{(["starLight", "starDark", "textLight", "textDark", "moderation", "lowUpTo", "maxVideoSeconds", "maxMedia", "sort"] as const).map((k) => <input key={k} type="hidden" name={k} value={String(s[k])} />)}{(["allowPhotos", "allowVideos", "checkMedia", "showVerified", "showDate", "showBreakdown"] as const).map((k) => s[k] ? <input key={k} type="hidden" name={k} value="on" /> : null)}</>}

      <div className="flex justify-end"><SubmitButton className="btn-primary" busyText="Saving">Save</SubmitButton></div>
    </Form>
  );
}

function ColorSet({ title, bg, star, text, onStar, onText, starName, textName, defStar }: { title: string; bg: string; star: string; text: string; onStar: (v: string) => void; onText: (v: string) => void; starName: string; textName: string; defStar: string }) {
  const ink = bg === "#ffffff" ? "#111111" : "#f2f2f2";
  return (
    <div className="rounded-xl p-3 shadow-[0_0_0_1px_rgba(0,0,0,.08)]">
      <p className="text-[12.5px] font-semibold">{title}</p>
      <div className="mt-2 rounded-lg px-3 py-3" style={{ background: bg }}>
        <p style={{ color: star, fontSize: 18, letterSpacing: 2 }}>★★★★★</p>
        <p style={{ color: text || ink, fontSize: 13 }}>Sound is clear and the battery lasts all week.</p>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2 text-[12.5px]">
        <label className="flex items-center gap-2"><input type="color" value={star} onChange={(e) => onStar(e.target.value)} className="h-8 w-9 cursor-pointer rounded border-0 bg-transparent p-0" aria-label={`${title} stars`} /><span>Stars</span><input type="hidden" name={starName} value={star} /></label>
        <label className="flex items-center gap-2"><input type="color" value={text || ink} onChange={(e) => onText(e.target.value)} className="h-8 w-9 cursor-pointer rounded border-0 bg-transparent p-0" aria-label={`${title} text`} /><span>Text</span><input type="hidden" name={textName} value={text} /></label>
      </div>
      <div className="mt-2 flex gap-3 text-[11.5px]">
        {star !== defStar && <button type="button" className="text-ink-soft underline" onClick={() => onStar(defStar)}>Default stars</button>}
        {text && <button type="button" className="text-ink-soft underline" onClick={() => onText("")}>Theme text colour</button>}
      </div>
    </div>
  );
}

function Choice({ name, value, onChange, options }: { name: string; value: string; onChange: (v: string) => void; options: [string, string][] }) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map(([v, label]) => (
        <label key={v} className={`cursor-pointer rounded-[10px] px-3 py-2 text-[13px] ${value === v ? "font-medium shadow-[0_0_0_2px_#303030]" : "shadow-[0_0_0_1px_rgba(0,0,0,.12)] hover:bg-[#fafafa]"}`}>
          <input type="radio" name={name} value={v} checked={value === v} onChange={() => onChange(v)} className="sr-only" />{label}
        </label>
      ))}
    </div>
  );
}

function Check({ name, checked, onChange, label, hint }: { name: string; checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string }) {
  return (
    <label className="mt-3 flex items-start gap-2 text-[13px]">
      <input type="checkbox" name={name} checked={checked} onChange={(e) => onChange(e.target.checked)} className="mt-0.5" />
      <span><span className="font-medium">{label}</span>{hint && <span className="block text-[12px] text-ink-soft">{hint}</span>}</span>
    </label>
  );
}

// ---------- Product filters ----------

const DISPLAY_LABEL: Record<string, string> = { checkbox: "Tick boxes", chips: "Chips", swatch: "Colour dots", list: "Text links" };

function FiltersForm() {
  const d = useLoaderData<typeof loader>();
  const [s, setS] = useState<FilterSettings>(d.filters as FilterSettings);
  const [bands, setBands] = useState(s.priceBands.join(", "));
  const [adding, setAdding] = useState("");
  const set = <K extends keyof FilterSettings>(k: K, v: FilterSettings[K]) => setS((x) => ({ ...x, [k]: v }));
  const setF = (i: number, patch: Partial<FilterDef>) => set("filters", s.filters.map((f, j) => (j === i ? { ...f, ...patch } : f)));
  const move = (i: number, by: number) => { const l = s.filters.slice(); const [x] = l.splice(i, 1); l.splice(i + by, 0, x); set("filters", l); };
  const used = new Set(s.filters.map((f) => `${f.type}:${(f.key ?? "").toLowerCase()}`));

  // Ready-made choices: one per filter type, plus one per option name and tag prefix found in the catalog
  const choices: { v: string; label: string; def: FilterDef }[] = [];
  const mk = (type: FilterType, label: string, key?: string): FilterDef => {
    const meta = FILTER_TYPES.find((t) => t.type === type)!;
    const colour = type === "option" && /colou?r/i.test(key ?? "");
    const id = `${type === "option" || type === "tag" ? (key ?? type) : type}`.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 24) || type;
    return { id, type, label, ...(key ? { key } : {}), display: colour ? "swatch" : type === "option" ? "chips" : meta.displays[0], open: true };
  };
  for (const t of FILTER_TYPES) if (!t.needsKey && !used.has(`${t.type}:`)) choices.push({ v: t.type, label: t.label, def: mk(t.type, t.label === "In stock only" ? "Availability" : t.label) });
  for (const n of d.optionNames) if (!used.has(`option:${n.toLowerCase()}`)) choices.push({ v: `option:${n}`, label: `Option: ${n}`, def: mk("option", n, n) });
  for (const n of d.tagNames) if (!used.has(`tag:${n.toLowerCase()}`)) choices.push({ v: `tag:${n}`, label: `Tags starting “${n}:”`, def: mk("tag", n.charAt(0).toUpperCase() + n.slice(1), n) });
  const add = (v: string) => {
    let def: FilterDef | undefined = choices.find((c) => c.v === v)?.def;
    if (v === "option-new") def = mk("option", "Size", "Size");
    if (v === "tag-new") def = mk("tag", "Age", "age");
    if (!def) return;
    let id = def.id, n = 2;
    while (s.filters.some((f) => f.id === id)) id = `${def.id}-${n++}`;
    set("filters", [...s.filters, { ...def, id }]);
    setAdding("");
  };
  const payload = JSON.stringify({ ...s, priceBands: bands.split(/[,\s]+/).map((x) => Number(x.replace(/[^\d]/g, ""))).filter(Boolean) });

  return (
    <Form method="post" className="space-y-4">
      <input type="hidden" name="intent" value="filters" />
      <input type="hidden" name="filters" value={payload} />
      <Card>
        <label className="flex items-start gap-3 pt-4">
          <input type="checkbox" checked={s.enabled} onChange={(e) => set("enabled", e.target.checked)} className="mt-1" />
          <span className="flex-1">
            <span className="block text-[14px] font-semibold">Product filters</span>
            <span className="block text-[13px] text-ink-soft">Let shoppers narrow your category and search pages by price, colour, size, rating and more. You choose which filters show, in what order, where they sit and how they look. Each theme’s category page can still hide them in the theme editor.</span>
          </span>
        </label>
      </Card>

      <fieldset disabled={!s.enabled} className="space-y-4 disabled:opacity-50">
        <Card title="Where the filters sit">
          <div className="grid gap-2 sm:grid-cols-3">
            {(["sidebar", "top", "drawer"] as const).map((l) => (
              <label key={l} className={`cursor-pointer rounded-xl p-3 text-[13px] ${s.layout === l ? "shadow-[0_0_0_2px_#303030]" : "shadow-[0_0_0_1px_rgba(0,0,0,.12)] hover:bg-[#fafafa]"}`}>
                <input type="radio" name="_layout" checked={s.layout === l} onChange={() => set("layout", l)} className="sr-only" />
                <LayoutPic layout={l} side={s.side} />
                <span className="mt-2 block font-medium">{l === "sidebar" ? "Sidebar" : l === "top" ? "Top bar" : "Slide-out panel"}</span>
                <span className="block text-[12px] text-ink-soft">{l === "sidebar" ? "Always open beside the products" : l === "top" ? "Compact dropdowns above the products" : "A Filter button opens a panel"}</span>
              </label>
            ))}
          </div>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            {s.layout !== "top" && <div><span className="label">Side</span><Choice name="_side" value={s.side} onChange={(v) => set("side", v as FilterSettings["side"])} options={[["left", "Left"], ["right", "Right"]]} /></div>}
            <div><span className="label">On phones</span><Choice name="_mobile" value={s.mobile} onChange={(v) => set("mobile", v as FilterSettings["mobile"])} options={[["sheet", "Slide up from bottom"], ["drawer", "Slide in from side"]]} /></div>
          </div>
        </Card>

        <Card title="Look">
          <Choice name="_style" value={s.style} onChange={(v) => set("style", v as FilterSettings["style"])} options={[["minimal", "Minimal lines"], ["boxed", "Boxed card"], ["pills", "Rounded pills"]]} />
          <Check name="_counts" checked={s.showCounts} onChange={(v) => set("showCounts", v)} label="Show how many products each choice has" />
          <Check name="_empty" checked={s.hideEmpty} onChange={(v) => set("hideEmpty", v)} label="Hide choices with no products" hint="Otherwise they show faded." />
          <label className="mt-3 block max-w-[280px] text-[13px]"><span className="label">Choices shown before “+ more”</span>
            <select value={s.maxValues} onChange={(e) => set("maxValues", Number(e.target.value))} className="input w-full">
              {[3, 4, 5, 6, 8, 10, 15, 30].map((n) => <option key={n} value={n}>{n === 30 ? "Show all" : n}</option>)}
            </select></label>
        </Card>

        <Card title="Filters" description="Top to bottom is the order shoppers see. Filters with nothing to choose on a page hide themselves.">
          <div className="divide-y divide-[#ebebeb] rounded-xl shadow-[0_0_0_1px_rgba(0,0,0,.1)]">
            {s.filters.length === 0 && <p className="px-3 py-4 text-[13px] text-ink-soft">No filters yet. Add one below.</p>}
            {s.filters.map((f, i) => {
              const meta = FILTER_TYPES.find((t) => t.type === f.type)!;
              return (
                <div key={f.id} className="flex flex-wrap items-center gap-2 px-3 py-2.5 text-[13px]">
                  <div className="flex flex-col">
                    <button type="button" disabled={i === 0} onClick={() => move(i, -1)} className="h-4 px-1 leading-none text-ink-soft disabled:opacity-25" aria-label={`Move ${f.label} up`}>▲</button>
                    <button type="button" disabled={i === s.filters.length - 1} onClick={() => move(i, 1)} className="h-4 px-1 leading-none text-ink-soft disabled:opacity-25" aria-label={`Move ${f.label} down`}>▼</button>
                  </div>
                  <input value={f.label} onChange={(e) => setF(i, { label: e.target.value })} className="input h-8 w-[150px]" aria-label="Name shoppers see" maxLength={40} />
                  <span className="rounded-md bg-[#f1f1f1] px-2 py-1 text-[11.5px] text-ink-soft">{f.type === "option" ? `Option · ${f.key}` : f.type === "tag" ? `Tags · ${f.key}:` : meta.label}</span>
                  {meta.needsKey && <input value={f.key ?? ""} onChange={(e) => setF(i, { key: e.target.value })} className="input h-8 w-[110px]" placeholder={f.type === "tag" ? "age" : "Size"} aria-label={f.type === "tag" ? "Tag prefix" : "Option name"} />}
                  <span className="ml-auto" />
                  {meta.displays.length > 1 && (
                    <select value={f.display} onChange={(e) => setF(i, { display: e.target.value as FilterDef["display"] })} className="input h-8 w-[120px]" aria-label="Look">
                      {meta.displays.map((x) => <option key={x} value={x}>{DISPLAY_LABEL[x]}</option>)}
                    </select>
                  )}
                  <label className="flex items-center gap-1.5 text-[12.5px]"><input type="checkbox" checked={f.open} onChange={(e) => setF(i, { open: e.target.checked })} />Open</label>
                  <button type="button" onClick={() => set("filters", s.filters.filter((_, j) => j !== i))} className="rounded-md px-2 py-1 text-[12.5px] text-[#8e1f0b] hover:bg-[#fff1ee]">Remove</button>
                </div>
              );
            })}
          </div>
          {s.filters.length < 16 && (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <select value={adding} onChange={(e) => { setAdding(e.target.value); add(e.target.value); }} className="input h-9 w-[280px]" aria-label="Add a filter">
                <option value="">+ Add a filter…</option>
                {choices.map((c) => <option key={c.v} value={c.v}>{c.label}</option>)}
                <option value="option-new">Another variant option…</option>
                <option value="tag-new">Tags with a prefix…</option>
              </select>
              <span className="text-[12px] text-ink-soft">Tip: tag products like <b>age:3-5 years</b> or <b>material:Wood</b> to filter by anything.</span>
            </div>
          )}
          {s.filters.some((f) => f.type === "price") && (
            <label className="mt-4 block text-[13px]"><span className="label">Price steps in ₹</span>
              <input value={bands} onChange={(e) => setBands(e.target.value)} className="input w-full max-w-[360px]" placeholder="499, 999, 1999, 4999" />
              <span className="mt-1 block text-[12px] text-ink-soft">Makes: Under ₹{bands.split(/[,\s]+/).filter(Boolean)[0] ?? "…"}, then each step, then “& above”. Shoppers can also type their own min and max.</span>
            </label>
          )}
        </Card>

        <Card title="Sorting">
          <Check name="_sort" checked={s.showSort} onChange={(v) => set("showSort", v)} label="Show the “Sort by” menu" />
          <div className="mt-2 flex flex-wrap gap-2">
            {SORTS.map(([v, label]) => {
              const on = s.sorts.includes(v);
              return (
                <label key={v} className={`cursor-pointer rounded-lg px-2.5 py-1 text-[12.5px] ${on ? "bg-[#303030] text-white" : "shadow-[0_0_0_1px_rgba(0,0,0,.12)]"} ${!s.showSort ? "opacity-50" : ""}`}>
                  <input type="checkbox" className="sr-only" checked={on} disabled={!s.showSort} onChange={() => set("sorts", on ? s.sorts.filter((x) => x !== v) : SORTS.map((x) => x[0]).filter((x) => x === v || s.sorts.includes(x)))} />{label}
                </label>
              );
            })}
          </div>
        </Card>
      </fieldset>

      <div className="flex items-center justify-between">
        <button type="button" className="text-[12.5px] text-ink-soft underline" onClick={() => { setS(FILTER_DEFAULTS); setBands(FILTER_DEFAULTS.priceBands.join(", ")); }}>Reset to suggested filters</button>
        <SubmitButton className="btn-primary" busyText="Saving">Save</SubmitButton>
      </div>
    </Form>
  );
}

/** Tiny picture of a category page with the filters in place. */
function LayoutPic({ layout, side }: { layout: "sidebar" | "top" | "drawer"; side: "left" | "right" }) {
  const cells = (x0: number, w: number) => [0, 1, 2].flatMap((r) => [0, 1, 2].map((c) => <rect key={`${r}${c}`} x={x0 + c * (w / 3)} y={r < 2 ? (layout === "top" ? 26 : 16) + r * 26 : 999} width={w / 3 - 4} height="22" rx="3" fill="#e3e3e3" />));
  return (
    <svg viewBox="0 0 160 76" className="h-auto w-full rounded-lg bg-[#f7f7f7]" aria-hidden="true">
      {layout === "sidebar" && <><rect x={side === "left" ? 6 : 116} y="10" width="38" height="58" rx="4" fill="#303030" opacity=".85" />{[0, 1, 2, 3].map((i) => <rect key={i} x={side === "left" ? 11 : 121} y={17 + i * 12} width="26" height="4" rx="2" fill="#fff" opacity=".8" />)}{cells(side === "left" ? 52 : 8, 108)}</>}
      {layout === "top" && <>{[0, 1, 2, 3].map((i) => <rect key={i} x={8 + i * 30} y="9" width="26" height="10" rx="5" fill="#303030" opacity=".85" />)}{cells(8, 150)}</>}
      {layout === "drawer" && <>{cells(8, 150)}<rect x="0" y="0" width="160" height="76" fill="#000" opacity=".18" /><rect x={side === "left" ? 0 : 108} y="0" width="52" height="76" fill="#fff" /><rect x={side === "left" ? 4 : 112} y="6" width="40" height="8" rx="3" fill="#303030" opacity=".85" />{[0, 1, 2, 3].map((i) => <rect key={i} x={side === "left" ? 4 : 112} y={22 + i * 11} width="34" height="4" rx="2" fill="#bdbdbd" />)}</>}
    </svg>
  );
}
