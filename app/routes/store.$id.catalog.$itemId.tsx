// Growpefy Store → add / edit one product (dish, course, room ...): details, photos, options, variants, categories.
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { Form, Link, useActionData, useLoaderData, useNavigation, useParams } from "@remix-run/react";
import { useEffect, useRef, useState } from "react";
import { Icon } from "~/components/Icons";
import type { ItemImage } from "~/db.server";
import { Notice } from "~/components/ui";
import { requireStore, requireViewer } from "~/lib/auth.server";
import { packOf } from "~/lib/business-types";
import { catalogAllowed, catalogFacets, deleteItem, getItem, listCategories, saveItem, type ItemStatus, type VariantInput } from "~/lib/catalog.server";
import { formatINR, rupeesToPaise } from "~/lib/pricing";
import { storePath } from "~/lib/store-code";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const viewer = await requireViewer(request);
  const store = await requireStore(viewer, params.id);
  if (!catalogAllowed(viewer, store)) throw new Response("Not found", { status: 404 });
  const pack = packOf(store.businessType);
  const [categories, facets] = await Promise.all([listCategories(store.id), catalogFacets(store.id)]);
  const site = {
    name: store.name, slug: store.slug,
    host: store.storefrontDomain && store.storefrontDomainStatus === "live" ? `https://${store.storefrontDomain}` : `${new URL(request.url).origin}/s/${store.slug}`,
  };
  if (params.itemId === "new") return json({ pack, categories, facets, site, item: null, variants: [], categoryIds: [] as number[] });
  const found = await getItem(store.id, Number(params.itemId));
  if (!found) throw new Response("Not found", { status: 404 });
  return json({ pack, categories, facets, site, item: found.item, variants: found.variants, categoryIds: found.categoryIds });
}

const str = (v: FormDataEntryValue | null) => String(v ?? "").trim();
const num = (v: FormDataEntryValue | null) => { const n = Number(str(v)); return str(v) === "" || !Number.isFinite(n) ? null : n; };

export async function action({ request, params }: ActionFunctionArgs) {
  const viewer = await requireViewer(request);
  const store = await requireStore(viewer, params.id);
  if (!catalogAllowed(viewer, store)) throw new Response("Not found", { status: 404 });
  const fd = await request.formData();
  const id = params.itemId === "new" ? undefined : Number(params.itemId);

  if (fd.get("intent") === "delete" && id) {
    await deleteItem(store.id, id);
    return redirect(`${storePath(store.id)}/catalog`);
  }

  try {
    const options = JSON.parse(str(fd.get("options")) || "[]") as { name: string; values: string[] }[];
    const rows = JSON.parse(str(fd.get("variants")) || "[]") as Row[];
    const kg = (w: string, unit: string) => { const n = Number(w); return w.trim() === "" || !Number.isFinite(n) ? null : Math.round(unit === "g" ? n : n * 1000); };
    const unit = str(fd.get("weightUnit")) === "g" ? "g" : "kg";
    const tracked = fd.get("track") === "on";
    const variants: VariantInput[] = rows.map((r) => ({
      title: r.title, optionValues: r.optionValues, sku: r.sku.trim() || null,
      pricePaise: rupeesToPaise(r.price) ?? 0, compareAtPaise: rupeesToPaise(r.compareAt),
      stock: !tracked || r.stock.trim() === "" ? (tracked ? 0 : null) : Math.max(0, Math.round(Number(r.stock) || 0)),
      weightGrams: kg(r.weight ?? "", unit),
    }));
    const status = (["active", "draft", "archived"].includes(str(fd.get("status"))) ? str(fd.get("status")) : "draft") as ItemStatus;
    const extra = {
      costPaise: rupeesToPaise(str(fd.get("cost"))), chargeTax: fd.get("chargeTax") === "on", gstRate: num(fd.get("gstRate")),
      barcode: str(fd.get("barcode")) || null, continueSelling: fd.get("continueSelling") === "on", physical: fd.get("physical") === "on",
      hsn: str(fd.get("hsn")) || null, origin: str(fd.get("origin")) || null, weightUnit: unit,
      dims: { l: num(fd.get("dimL")), w: num(fd.get("dimW")), h: num(fd.get("dimH")) },
      site: readSite(fd),
    };
    const newId = await saveItem(store, {
      title: str(fd.get("title")), handle: str(fd.get("handle")) || undefined, descriptionHtml: cleanHtml(str(fd.get("description"))), status,
      vendor: str(fd.get("vendor")) || null, productType: str(fd.get("productType")) || null,
      tags: str(fd.get("tags")).split(",").map((t) => t.trim()).filter(Boolean),
      images: readMedia(str(fd.get("media"))),
      options: options.filter((o) => o.name.trim() && o.values.length), variants,
      categoryIds: fd.getAll("category").map(Number).filter(Boolean),
      seoTitle: str(fd.get("seoTitle")) || null, seoDescription: str(fd.get("seoDescription")) || null, extra,
    }, id);
    if (!id) return redirect(`${storePath(store.id)}/catalog/${newId}?saved=1`);
    return json({ ok: "Saved", error: null });
  } catch (e) {
    return json({ ok: null, error: e instanceof Error ? e.message : "Couldn't save" }, { status: 400 });
  }
}

/** Website details (badge, chips, key features, specs, questions) used by storefront themes such as Pulse. */
function readSite(fd: FormData) {
  const lines = (k: string) => str(fd.get(k)).split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const pair = (l: string, sep: RegExp) => { const m = l.split(sep); return [m[0].trim(), m.slice(1).join(" ").trim()] as const; };
  return {
    badge: str(fd.get("siteBadge")).slice(0, 30),
    subtitle: str(fd.get("siteSubtitle")).slice(0, 220),
    feature: str(fd.get("siteFeature")).slice(0, 30),
    chips: str(fd.get("siteChips")).split(",").map((c) => c.trim()).filter(Boolean).slice(0, 6).map((c) => c.slice(0, 24)),
    usp: lines("siteUsp").slice(0, 12).map((l) => l.slice(0, 120)),
    specs: lines("siteSpecs").slice(0, 30).map((l) => pair(l, /:\s*/)).filter(([label]) => label).map(([label, value]) => ({ label: label.slice(0, 60), value: value.slice(0, 200) })),
    banners: readBanners(str(fd.get("siteBanners"))),
    faqs: lines("siteFaqs").slice(0, 20).map((l) => pair(l, /\s*\|\s*/)).filter(([q]) => q).map(([q, a]) => ({ q: q.slice(0, 200), a: a.slice(0, 1000) })),
  };
}

type Banner = { image: string; mobile?: string; alt?: string; link?: string };
/** Wide photos shown under the description, in order. Only http(s) images. */
function readBanners(raw: string): Banner[] {
  let list: unknown = [];
  try { list = JSON.parse(raw || "[]"); } catch { list = []; }
  if (!Array.isArray(list)) return [];
  const ok = (u: unknown) => (typeof u === "string" && /^https?:\/\//.test(u.trim()) ? u.trim() : "");
  return list.slice(0, 20).flatMap((b): Banner[] => {
    const image = ok(b?.image);
    if (!image) return [];
    const mobile = ok(b?.mobile), alt = typeof b?.alt === "string" ? b.alt.slice(0, 160) : "", link = typeof b?.link === "string" ? b.link.trim().slice(0, 300) : "";
    return [{ image, ...(mobile ? { mobile } : {}), ...(alt ? { alt } : {}), ...(link ? { link } : {}) }];
  });
}

/** Description from the editor: keep simple formatting tags only. */
function cleanHtml(html: string) {
  return html
    .replace(/<(script|style|iframe|object|embed)[\s\S]*?<\/\1>/gi, "")
    .replace(/\son\w+="[^"]*"/gi, "").replace(/\son\w+='[^']*'/gi, "")
    .replace(/javascript:/gi, "")
    .slice(0, 60000);
}

/** Photos and video clips from the form, in order (only http(s) links, known types). */
function readMedia(raw: string): ItemImage[] {
  let list: unknown = [];
  try { list = JSON.parse(raw || "[]"); } catch { list = []; }
  if (!Array.isArray(list)) return [];
  return list.slice(0, 30).flatMap((m): ItemImage[] => {
    const url = typeof m?.url === "string" ? m.url.trim() : "";
    if (!/^https?:\/\//.test(url)) return [];
    const type = m?.type === "video" ? "video" : "image";
    const poster = typeof m?.poster === "string" && /^https?:\/\//.test(m.poster) ? m.poster : undefined;
    return [{ url, type, ...(poster ? { poster } : {}), ...(typeof m?.alt === "string" && m.alt ? { alt: m.alt.slice(0, 200) } : {}) }];
  });
}

type Row = { title: string; optionValues: string[]; price: string; compareAt: string; sku: string; stock: string; weight?: string };
const rupees = (p: number | null | undefined) => (p == null ? "" : String(p / 100));

/** Every combination of option values, keeping what was already typed for a combination. */
function combine(options: { name: string; values: string[] }[], old: Row[]): Row[] {
  const used = options.filter((o) => o.name.trim() && o.values.length);
  const blank: Row = { title: "Default", optionValues: [], price: "", compareAt: "", sku: "", stock: "", weight: "" };
  if (!used.length) return [{ ...(old.find((r) => r.optionValues.length === 0) ?? old[0] ?? blank), title: "Default", optionValues: [] }];
  let combos: string[][] = [[]];
  for (const o of used) combos = combos.flatMap((c) => o.values.map((v) => [...c, v]));
  const first = old[0];
  return combos.slice(0, 250).map((vals) => {
    const key = vals.join(" / ");
    const had = old.find((r) => r.optionValues.join(" / ") === key);
    return had ?? { title: key, optionValues: vals, price: first?.price ?? "", compareAt: first?.compareAt ?? "", sku: "", stock: "", weight: first?.weight ?? "" };
  });
}

type SiteDetails = { banners?: Banner[]; badge?: string; subtitle?: string; feature?: string; chips?: string[]; usp?: string[]; specs?: { label: string; value: string }[]; faqs?: { q: string; a: string }[] };
type Extra = { site?: SiteDetails; costPaise?: number | null; chargeTax?: boolean; gstRate?: number | null; barcode?: string | null; continueSelling?: boolean; physical?: boolean; hsn?: string | null; origin?: string | null; weightUnit?: "kg" | "g"; dims?: { l: number | null; w: number | null; h: number | null } };
const plain = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();

export default function EditItem() {
  const { pack, categories, facets, site, item, variants, categoryIds } = useLoaderData<typeof loader>();
  const a = useActionData<typeof action>();
  const nav = useNavigation();
  const saving = nav.state === "submitting" && nav.formData?.get("intent") !== "delete";
  const formRef = useRef<HTMLFormElement>(null);
  const [dirty, setDirty] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);
  const Item = pack.item[0].toUpperCase() + pack.item.slice(1);
  const ex = ((item?.extra ?? {}) as Extra);
  const unit0 = ex.weightUnit === "g" ? "g" : "kg";

  const [title, setTitle] = useState(item?.title ?? "");
  const [desc, setDesc] = useState(item?.descriptionHtml ?? "");
  const [options, setOptions] = useState<{ name: string; values: string[] }[]>(item?.options ?? []);
  type V = { title: string; optionValues: string[]; pricePaise: number; compareAtPaise: number | null; sku: string | null; stock: number | null; weightGrams: number | null };
  const vs = variants as unknown as V[];
  const toW = (g: number | null) => (g == null ? "" : String(unit0 === "g" ? g : g / 1000));
  const [rows, setRows] = useState<Row[]>(
    vs.length
      ? vs.map((v) => ({ title: v.title, optionValues: v.optionValues, price: rupees(v.pricePaise), compareAt: rupees(v.compareAtPaise), sku: v.sku ?? "", stock: v.stock == null ? "" : String(v.stock), weight: toW(v.weightGrams) }))
      : [{ title: "Default", optionValues: [], price: "", compareAt: "", sku: "", stock: "", weight: "" }],
  );
  const [media, setMedia] = useState<ItemImage[]>(((item?.images ?? []) as ItemImage[]).map((m) => ({ ...m, type: m.type ?? "image" })));
  const [track, setTrack] = useState(item ? vs.some((v) => v.stock != null) : true);
  const [physical, setPhysical] = useState(ex.physical ?? true);
  const [cost, setCost] = useState(rupees(ex.costPaise));
  const [show, setShow] = useState<Record<string, boolean>>({ compare: Boolean(vs[0]?.compareAtPaise), cost: ex.costPaise != null, tax: Boolean(ex.chargeTax), sku: Boolean(vs[0]?.sku), barcode: Boolean(ex.barcode), customs: Boolean(ex.hsn || ex.origin) });
  const [seoOpen, setSeoOpen] = useState(false);
  const [seoTitle, setSeoTitle] = useState(item?.seoTitle ?? "");
  const [seoDesc, setSeoDesc] = useState(item?.seoDescription ?? "");
  const [handle, setHandle] = useState(item?.handle ?? "");
  const [tags, setTags] = useState<string[]>(item?.tags ?? []);
  const [cats, setCats] = useState<number[]>(categoryIds);
  const [status, setStatus] = useState(item?.status ?? "active");

  useEffect(() => { if (a?.ok) { setDirty(false); setSavedFlash(true); const t = setTimeout(() => setSavedFlash(false), 2500); return () => clearTimeout(t); } }, [a]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const setOption = (i: number, next: { name: string; values: string[] } | null) => {
    const list = next ? options.map((o, j) => (j === i ? next : o)) : options.filter((_, j) => j !== i);
    setOptions(list);
    setRows((old) => combine(list, old));
    setDirty(true);
  };
  const setRow = (i: number, key: keyof Row, value: string) => { setRows((old) => old.map((r, j) => (j === i ? { ...r, [key]: value } : r))); setDirty(true); };
  const setAll = (key: keyof Row, value: string) => { setRows((old) => old.map((r) => ({ ...r, [key]: value }))); setDirty(true); };
  const single = rows.length === 1 && rows[0].optionValues.length === 0;
  const r0 = rows[0];

  // Search listing writes itself from the title and description until edited
  const autoHandle = toHandleClient(title);
  const listingTitle = (seoTitle || title || `${Item} title`).slice(0, 70);
  const listingDesc = (seoDesc || plain(desc) || `Add a description to see how this ${pack.item} might appear in a search engine listing.`).slice(0, 160);
  const url = `${site.host}/product/${handle || autoHandle || "…"}`;
  const priceN = Number(r0?.price) || 0;
  const costN = Number(cost) || 0;
  const profit = priceN && costN ? priceN - costN : null;

  return (
    <Form method="post" ref={formRef} onChange={() => setDirty(true)} className="mx-auto max-w-[1000px] pb-10">
      {/* Unsaved changes bar */}
      {(dirty || !item) && (
        <div className="sticky top-2 z-30 mb-3 flex justify-center">
          <div className="flex items-center gap-2 rounded-xl bg-[#1a1a1a] py-1.5 pl-4 pr-1.5 text-[13px] text-white shadow-[0_8px_24px_-8px_rgba(0,0,0,.5)]">
            <span className="mr-2 font-medium">{item ? "Unsaved changes" : `New ${pack.item}`}</span>
            {item && <button type="button" onClick={() => window.location.reload()} className="h-7 rounded-lg px-2.5 font-medium text-[#e3e3e3] hover:bg-white/10">Discard</button>}
            <button type="submit" className="h-7 rounded-lg bg-white px-3 font-semibold text-[#303030] hover:bg-[#f1f1f1]" disabled={saving}>{saving ? "Saving…" : "Save"}</button>
          </div>
        </div>
      )}

      <div className="mb-4 flex min-h-[32px] items-center gap-2">
        <Link to=".." relative="path" className="flex h-7 w-7 items-center justify-center rounded-lg text-ink-soft hover:bg-black/5" aria-label={`Back to ${pack.items}`}><Icon name="arrow" className="h-4 w-4 rotate-180" /></Link>
        <Icon name="tag" className="h-4 w-4 text-ink-soft" />
        <Link to=".." relative="path" className="text-[13px] font-medium text-ink-soft hover:text-ink">{pack.items}</Link>
        <span className="text-ink-faint">/</span>
        <h1 className="min-w-0 flex-1 truncate text-[15px] font-semibold">{item ? item.title : `Add ${pack.item}`}</h1>
        {savedFlash && <span className="text-[12.5px] font-medium text-[#0c5132]">Saved ✓</span>}
        {item && item.status === "active" && <a href={`${site.host}/product/${item.handle}`} target="_blank" rel="noreferrer" className="btn-secondary"><Icon name="eye" className="h-4 w-4" />View</a>}
      </div>
      {a?.error && <div className="mb-4"><Notice tone="error">{a.error}</Notice></div>}

      <input type="hidden" name="options" value={JSON.stringify(options)} />
      <input type="hidden" name="variants" value={JSON.stringify(rows)} />
      <input type="hidden" name="media" value={JSON.stringify(media)} />
      <input type="hidden" name="description" value={desc} />
      <input type="hidden" name="tags" value={tags.join(",")} />
      <input type="hidden" name="status" value={status} />
      {cats.map((c) => <input key={c} type="hidden" name="category" value={c} />)}

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="min-w-0 space-y-4">
          <section className="panel space-y-4 p-4">
            <label className="block"><span className="label">Title</span>
              <input name="title" required value={title} onChange={(e) => setTitle(e.target.value)} className="input w-full" placeholder={pack.item === "product" ? "Short sleeve t-shirt" : `${Item} name`} />
            </label>
            <div><span className="label">Description</span><RichText value={desc} onChange={(v) => { setDesc(v); setDirty(true); }} /></div>
            <div><span className="label">Media</span><MediaManager media={media} setMedia={(m) => { setMedia(m); setDirty(true); }} /></div>
          </section>

          {single && (
            <section className="panel overflow-hidden">
              <div className="space-y-3 p-4">
                <h2 className="text-[13.5px] font-semibold">Price</h2>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Money label="Price" value={r0.price} onChange={(v) => setRow(0, "price", v)} required />
                  {show.compare && <Money label="Compare-at price (MRP)" value={r0.compareAt} onChange={(v) => setRow(0, "compareAt", v)} hint={Number(r0.compareAt) > priceN && priceN ? `${Math.round((1 - priceN / Number(r0.compareAt)) * 100)}% off shown on the website` : undefined} />}
                  {show.cost && <Money label="Cost per item" name="cost" value={cost} onChange={setCost} hint="Customers won't see this" />}
                  {show.cost && <div className="flex gap-6 self-end pb-1 text-[12.5px]"><span><span className="block text-ink-faint">Profit</span><span className="num font-semibold">{profit == null ? "—" : formatINR(Math.round(profit * 100))}</span></span><span><span className="block text-ink-faint">Margin</span><span className="num font-semibold">{profit == null || !priceN ? "—" : `${Math.round((profit / priceN) * 100)}%`}</span></span></div>}
                  {show.tax && (
                    <label className="block"><span className="label">GST rate</span>
                      <select name="gstRate" defaultValue={ex.gstRate ?? 18} className="input w-full">{[0, 5, 12, 18, 28].map((g) => <option key={g} value={g}>{g}%</option>)}</select>
                    </label>
                  )}
                </div>
                {!show.cost && <input type="hidden" name="cost" value={cost} />}
                {show.tax && <input type="hidden" name="chargeTax" value="on" />}
              </div>
              <ChipRow items={[
                { k: "compare", label: "Compare-at" }, { k: "cost", label: "Cost per item" }, { k: "tax", label: "Charge GST", on: show.tax },
              ]} show={show} toggle={(k) => setShow({ ...show, [k]: !show[k] })} />
            </section>
          )}

          <section className="panel overflow-hidden">
            <div className="space-y-3 p-4">
              <div className="flex items-center gap-2">
                <h2 className="flex-1 text-[13.5px] font-semibold">Inventory</h2>
                <Toggle name="track" label="Inventory tracked" checked={track} onChange={(v) => { setTrack(v); setDirty(true); }} />
              </div>
              {single && track && (
                <div className="rounded-lg shadow-[inset_0_0_0_1px_rgb(var(--rule))]">
                  <div className="flex items-center justify-between bg-paper px-3 py-2 text-[12px] font-medium text-ink-soft"><span>Location</span><span>Quantity</span></div>
                  <div className="flex items-center gap-3 px-3 py-2">
                    <span className="flex-1 truncate text-[13px]">{site.name} warehouse</span>
                    <input inputMode="numeric" value={r0.stock} onChange={(e) => setRow(0, "stock", e.target.value.replace(/[^0-9]/g, ""))} className="input w-28 text-right" placeholder="0" aria-label="Quantity" />
                  </div>
                </div>
              )}
              {!single && track && <p className="text-[12.5px] text-ink-soft">Set quantity for each variant below.</p>}
              {(show.sku || show.barcode) && single && (
                <div className="grid gap-3 sm:grid-cols-2">
                  {show.sku && <label className="block"><span className="label">SKU (stock keeping unit)</span><input value={r0.sku} onChange={(e) => setRow(0, "sku", e.target.value)} className="input w-full" /></label>}
                  {show.barcode && <label className="block"><span className="label">Barcode (ISBN, UPC, GTIN…)</span><input name="barcode" defaultValue={ex.barcode ?? ""} className="input w-full" /></label>}
                </div>
              )}
              {track && <label className="flex items-center gap-2 text-[13px]"><input type="checkbox" name="continueSelling" defaultChecked={ex.continueSelling} />Continue selling when out of stock</label>}
            </div>
            {single && <ChipRow items={[{ k: "sku", label: "SKU" }, { k: "barcode", label: "Barcode" }]} show={show} toggle={(k) => setShow({ ...show, [k]: !show[k] })} />}
          </section>

          <section className="panel overflow-hidden">
            <div className="space-y-3 p-4">
              <div className="flex items-center gap-2">
                <h2 className="flex-1 text-[13.5px] font-semibold">Shipping</h2>
                <Toggle name="physical" label="Physical product" checked={physical} onChange={(v) => { setPhysical(v); setDirty(true); }} />
              </div>
              {physical ? (
                <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
                  <div className="grid grid-cols-[1fr_auto] items-end gap-2">
                    <label className="block"><span className="label">Weight</span>
                      <input inputMode="decimal" value={single ? r0.weight ?? "" : rows[0]?.weight ?? ""} onChange={(e) => (single ? setRow(0, "weight", e.target.value) : setAll("weight", e.target.value))} className="input w-full" placeholder="0.0" />
                    </label>
                    <select name="weightUnit" defaultValue={unit0} className="input w-20" aria-label="Weight unit"><option value="kg">kg</option><option value="g">g</option></select>
                  </div>
                  <div><span className="label">Packed size (cm)</span>
                    <div className="flex items-center gap-1.5">
                      <input name="dimL" defaultValue={ex.dims?.l ?? ""} inputMode="decimal" className="input w-16" placeholder="L" aria-label="Length" />×
                      <input name="dimW" defaultValue={ex.dims?.w ?? ""} inputMode="decimal" className="input w-16" placeholder="W" aria-label="Width" />×
                      <input name="dimH" defaultValue={ex.dims?.h ?? ""} inputMode="decimal" className="input w-16" placeholder="H" aria-label="Height" />
                    </div>
                  </div>
                  <p className="text-[12px] text-ink-faint sm:col-span-2">Used to book couriers and work out shipping charges.</p>
                </div>
              ) : <p className="text-[12.5px] text-ink-soft">Customers won't enter a shipping address for this {pack.item}.</p>}
              {show.customs && physical && (
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="block"><span className="label">Country of origin</span><input name="origin" defaultValue={ex.origin ?? "India"} className="input w-full" /></label>
                  <label className="block"><span className="label">HSN code</span><input name="hsn" defaultValue={ex.hsn ?? ""} className="input w-full" placeholder="e.g. 8517" /></label>
                </div>
              )}
            </div>
            {physical && <ChipRow items={[{ k: "customs", label: "Country of origin & HSN" }]} show={show} toggle={(k) => setShow({ ...show, [k]: !show[k] })} />}
          </section>

          <section className="panel overflow-hidden">
            <div className="p-4">
              <h2 className="text-[13.5px] font-semibold">Variants</h2>
              <div className="mt-3 space-y-2">
                {options.map((o, i) => <OptionEditor key={i} option={o} hint={pack.optionHints[i] ?? "Option"} onChange={(n) => setOption(i, n)} />)}
                {options.length < 3 && (
                  <button type="button" onClick={() => setOptions([...options, { name: pack.optionHints[options.length] ?? "", values: [] }])} className="flex items-center gap-2 rounded-lg px-1 py-1.5 text-[13px] font-medium text-[#005bd3] hover:underline">
                    <Icon name="plus" className="h-4 w-4" />{options.length ? "Add another option" : `Add options like ${pack.optionHints.slice(0, 2).join(" or ").toLowerCase()}`}
                  </button>
                )}
              </div>
            </div>
            {!single && (
              <div className="scroll-thin overflow-x-auto border-t border-rule">
                <table className="table min-w-[680px]">
                  <thead><tr><th>Variant</th><th>Price</th><th>MRP</th>{track && <th>Available</th>}<th>SKU</th></tr></thead>
                  <tbody>
                    {rows.map((r, i) => (
                      <tr key={r.title + i}>
                        <td className="font-medium">{r.title}</td>
                        <td><MoneyInput value={r.price} onChange={(v) => setRow(i, "price", v)} label={`Price ${r.title}`} required /></td>
                        <td><MoneyInput value={r.compareAt} onChange={(v) => setRow(i, "compareAt", v)} label={`MRP ${r.title}`} /></td>
                        {track && <td><input inputMode="numeric" value={r.stock} onChange={(e) => setRow(i, "stock", e.target.value.replace(/[^0-9]/g, ""))} className="input w-24 text-right" placeholder="0" aria-label={`Stock ${r.title}`} /></td>}
                        <td><input value={r.sku} onChange={(e) => setRow(i, "sku", e.target.value)} className="input w-32" aria-label={`SKU ${r.title}`} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="px-4 py-2 text-[12px] text-ink-faint">{rows.length} variants · total stock {rows.reduce((n, r) => n + (Number(r.stock) || 0), 0).toLocaleString("en-IN")}</p>
              </div>
            )}
          </section>

          <BannerList initial={ex.site?.banners ?? []} onDirty={() => setDirty(true)} />

          <section className="panel p-4">
            <h2 className="text-[13.5px] font-semibold">Website details</h2>
            <p className="mt-0.5 text-[12px] text-ink-faint">Shown on product cards and the product page of themes like Pulse. All optional.</p>
            <div className="mt-3 grid gap-3 sm:grid-cols-3">
              <label className="block"><span className="label">Badge on the card</span><input name="siteBadge" defaultValue={ex.site?.badge ?? ""} placeholder="New launch" maxLength={30} className="input w-full" /></label>
              <label className="block"><span className="label">Feature label</span><input name="siteFeature" defaultValue={ex.site?.feature ?? ""} placeholder="32 dB ANC" maxLength={30} className="input w-full" /></label>
              <label className="block"><span className="label">Feature chips</span><input name="siteChips" defaultValue={(ex.site?.chips ?? []).join(", ")} placeholder="50H playtime, Fast charge" className="input w-full" /></label>
            </div>
            <label className="mt-3 block"><span className="label">Short line under the title</span><input name="siteSubtitle" defaultValue={ex.site?.subtitle ?? ""} placeholder="Hybrid ANC earbuds with 50 hours of playback and app control" maxLength={220} className="input w-full" /></label>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <label className="block"><span className="label">Key features <span className="font-normal text-ink-faint">· one per line</span></span><textarea name="siteUsp" defaultValue={(ex.site?.usp ?? []).join("\n")} rows={5} placeholder={"32 dB hybrid ANC\n50 hours total playback\nIPX5 water resistance"} className="input w-full" /></label>
              <label className="block"><span className="label">Specifications <span className="font-normal text-ink-faint">· Label: value</span></span><textarea name="siteSpecs" defaultValue={(ex.site?.specs ?? []).map((x) => `${x.label}: ${x.value}`).join("\n")} rows={5} placeholder={"Driver: 13 mm\nBluetooth: 5.4\nCharging: Type-C"} className="input w-full" /></label>
            </div>
            <label className="mt-3 block"><span className="label">Questions <span className="font-normal text-ink-faint">· one per line: Question | Answer</span></span><textarea name="siteFaqs" defaultValue={(ex.site?.faqs ?? []).map((x) => `${x.q} | ${x.a}`).join("\n")} rows={4} placeholder={"Is it waterproof? | It is IPX5 sweat and splash resistant."} className="input w-full" /></label>
          </section>

          <section className="panel p-4">
            <div className="flex items-center">
              <h2 className="flex-1 text-[13.5px] font-semibold">Search engine listing</h2>
              <button type="button" onClick={() => setSeoOpen(!seoOpen)} className="flex h-7 w-7 items-center justify-center rounded-lg text-ink-soft hover:bg-black/5" aria-label="Edit search engine listing" aria-expanded={seoOpen}><Icon name="design" className="h-4 w-4" /></button>
            </div>
            <div className="mt-3 rounded-lg bg-paper px-3 py-2.5">
              <p className="text-[12px] text-ink-soft">{site.name}</p>
              <p className="truncate text-[12px] text-[#0b6b2e]">{url}</p>
              <p className="mt-0.5 truncate text-[15px] text-[#1a0dab]">{listingTitle}</p>
              <p className="line-clamp-2 text-[12.5px] text-ink-soft">{listingDesc}</p>
              {!seoTitle && !seoDesc && title && <p className="mt-1.5 text-[11.5px] text-ink-faint">Made automatically from your title and description.</p>}
            </div>
            {seoOpen && (
              <div className="mt-3 space-y-3">
                <label className="block"><span className="label flex justify-between">Page title<span className="font-normal text-ink-faint">{(seoTitle || title).length}/70</span></span><input name="seoTitle" value={seoTitle} onChange={(e) => setSeoTitle(e.target.value)} placeholder={title} maxLength={120} className="input w-full" /></label>
                <label className="block"><span className="label flex justify-between">Meta description<span className="font-normal text-ink-faint">{(seoDesc || plain(desc)).slice(0, 999).length}/160</span></span><textarea name="seoDescription" value={seoDesc} onChange={(e) => setSeoDesc(e.target.value)} rows={3} placeholder={plain(desc).slice(0, 160)} className="input w-full" /></label>
                <label className="block"><span className="label">URL handle</span>
                  <div className="flex items-center rounded-lg shadow-[inset_0_0_0_1px_#d4d4d4]"><span className="pl-2.5 text-[12.5px] text-ink-faint">/product/</span><input name="handle" value={handle} onChange={(e) => setHandle(toHandleClient(e.target.value, true))} placeholder={autoHandle} className="min-w-0 flex-1 border-0 bg-transparent px-1 py-1.5 text-[13px] outline-none" /></div>
                </label>
              </div>
            )}
            {!seoOpen && (<><input type="hidden" name="seoTitle" value={seoTitle} /><input type="hidden" name="seoDescription" value={seoDesc} /><input type="hidden" name="handle" value={handle} /></>)}
          </section>

          {item && (
            <div className="flex justify-start">
              <button type="submit" name="intent" value="delete" formNoValidate className="btn-secondary text-[#8e1f0b]"
                onClick={(e) => { if (!confirm(`Delete “${item.title}”? This can't be undone.`)) e.preventDefault(); }}>
                <Icon name="trash" className="h-4 w-4" />Delete {pack.item}
              </button>
            </div>
          )}
        </div>

        <aside className="min-w-0 space-y-4">
          <section className="panel p-4">
            <span className="label">Status</span>
            <div className="relative">
              <span className={`pointer-events-none absolute left-2.5 top-1/2 h-2 w-2 -translate-y-1/2 rounded-full ${status === "active" ? "bg-[#29845a]" : status === "draft" ? "bg-[#5ea0ff]" : "bg-ink-faint"}`} />
              <select value={status} onChange={(e) => { setStatus(e.target.value as ItemStatus); setDirty(true); }} className="input w-full" style={{ paddingLeft: 22 }} aria-label="Status">
                <option value="active">Active</option><option value="draft">Draft</option><option value="archived">Archived</option>
              </select>
            </div>
            <p className="mt-2 text-[12px] text-ink-faint">{status === "active" ? "Shown on your website and sold at checkout." : status === "draft" ? "Hidden from your website until you make it active." : "Hidden and kept for your records."}</p>
          </section>

          <section className="panel space-y-3 p-4">
            <h2 className="text-[13.5px] font-semibold">{Item} organization</h2>
            <label className="block"><span className="label">Type</span><input name="productType" list="gp-types" defaultValue={item?.productType ?? ""} className="input w-full" placeholder="e.g. Smart watch" /></label>
            <datalist id="gp-types">{facets.types.map((t) => <option key={t} value={t} />)}</datalist>
            <label className="block"><span className="label">Brand</span><input name="vendor" list="gp-vendors" defaultValue={item?.vendor ?? site.name} className="input w-full" /></label>
            <datalist id="gp-vendors">{facets.vendors.map((t) => <option key={t} value={t} />)}</datalist>
            <div><span className="label">{pack.categories === "Categories" ? "Collections" : pack.categories}</span>
              <Picker all={categories.map((c) => ({ id: c.id, label: c.title }))} value={cats} onChange={(v) => { setCats(v); setDirty(true); }} placeholder={`Add to ${pack.categories === "Categories" ? "a collection" : pack.categories.toLowerCase()}`} />
            </div>
            <div><span className="label">Tags</span><TagInput value={tags} onChange={(v) => { setTags(v); setDirty(true); }} /></div>
          </section>

          <section className="panel p-4">
            <span className="label">Theme template</span>
            <select className="input w-full" defaultValue="default" aria-label="Theme template"><option value="default">Default {pack.item}</option></select>
          </section>
        </aside>
      </div>
    </Form>
  );
}

function toHandleClient(t: string, keepEnd = false) {
  const h = t.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+/, "").slice(0, 80);
  return keepEnd ? h : h.replace(/-+$/, "");
}

function Money({ label, value, onChange, hint, required, name }: { label: string; value: string; onChange: (v: string) => void; hint?: string; required?: boolean; name?: string }) {
  return (
    <label className="block"><span className="label">{label}</span>
      <MoneyInput value={value} onChange={onChange} required={required} name={name} label={label} wide />
      {hint && <span className="mt-1 block text-[12px] text-ink-faint">{hint}</span>}
    </label>
  );
}

function MoneyInput({ value, onChange, label, required, name, wide }: { value: string; onChange: (v: string) => void; label: string; required?: boolean; name?: string; wide?: boolean }) {
  return (
    <span className={`flex items-center rounded-lg bg-[#fdfdfd] shadow-[inset_0_0_0_1px_#d4d4d4] focus-within:shadow-[inset_0_0_0_2px_#005bd3] ${wide ? "w-full" : "w-28"}`}>
      <span className="pl-2.5 text-[13px] text-ink-faint">₹</span>
      <input name={name} inputMode="decimal" value={value} onChange={(e) => onChange(e.target.value.replace(/[^0-9.]/g, ""))} required={required} placeholder="0.00" aria-label={label} className="h-8 min-w-0 flex-1 border-0 bg-transparent px-1.5 text-[13px] outline-none" />
    </span>
  );
}

function ChipRow({ items, show, toggle }: { items: { k: string; label: string; on?: boolean }[]; show: Record<string, boolean>; toggle: (k: string) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5 border-t border-rule bg-paper px-4 py-2.5">
      {items.map((c) => (
        <button key={c.k} type="button" onClick={() => toggle(c.k)} aria-pressed={show[c.k]}
          className={`inline-flex h-7 items-center gap-1.5 rounded-lg px-2.5 text-[12.5px] font-medium ${show[c.k] ? "bg-[#303030] text-white" : "bg-white text-ink shadow-[inset_0_0_0_1px_rgb(var(--rule))] hover:bg-paper-sunk"}`}>
          {c.label}{c.on !== undefined && <span className={`rounded px-1 text-[11px] ${show[c.k] ? "bg-white/20" : "bg-paper-sunk"}`}>{show[c.k] ? "Yes" : "No"}</span>}
        </button>
      ))}
    </div>
  );
}

function Toggle({ name, label, checked, onChange }: { name: string; label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex cursor-pointer items-center gap-2 text-[12.5px] text-ink-soft">
      {label}
      <input type="checkbox" name={name} checked={checked} onChange={(e) => onChange(e.target.checked)} className="peer sr-only" />
      <span className="relative h-5 w-9 rounded-full bg-[#d4d4d4] transition peer-checked:bg-[#303030] peer-focus-visible:shadow-[0_0_0_2px_#005bd3] after:absolute after:left-0.5 after:top-0.5 after:h-4 after:w-4 after:rounded-full after:bg-white after:transition peer-checked:after:translate-x-4" />
    </label>
  );
}

function OptionEditor({ option, hint, onChange }: { option: { name: string; values: string[] }; hint: string; onChange: (o: { name: string; values: string[] } | null) => void }) {
  const [draft, setDraft] = useState("");
  const add = () => { const v = draft.trim(); if (v && !option.values.includes(v)) onChange({ ...option, values: [...option.values, v] }); setDraft(""); };
  return (
    <div className="rounded-lg p-3 shadow-[inset_0_0_0_1px_rgb(var(--rule))]">
      <div className="flex items-end gap-2">
        <label className="block w-40"><span className="label">Option name</span><input value={option.name} onChange={(e) => onChange({ ...option, name: e.target.value })} placeholder={hint} className="input w-full" /></label>
        <span className="flex-1" />
        <button type="button" onClick={() => onChange(null)} className="flex h-8 w-8 items-center justify-center rounded-lg text-ink-soft hover:bg-black/5" aria-label="Remove option"><Icon name="trash" className="h-4 w-4" /></button>
      </div>
      <span className="label mt-3">Option values</span>
      <div className="flex flex-wrap items-center gap-1.5 rounded-lg bg-[#fdfdfd] p-1.5 shadow-[inset_0_0_0_1px_#d4d4d4] focus-within:shadow-[inset_0_0_0_2px_#005bd3]">
        {option.values.map((v) => (
          <span key={v} className="inline-flex h-6 items-center gap-1 rounded-md bg-paper-sunk pl-2 pr-1 text-[12.5px]">{v}
            <button type="button" onClick={() => onChange({ ...option, values: option.values.filter((x) => x !== v) })} className="rounded p-0.5 hover:bg-black/10" aria-label={`Remove ${v}`}><Icon name="close" className="h-3 w-3" /></button>
          </span>
        ))}
        <input value={draft} onChange={(e) => setDraft(e.target.value)} onBlur={add}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === ",") { e.preventDefault(); add(); } else if (e.key === "Backspace" && !draft && option.values.length) onChange({ ...option, values: option.values.slice(0, -1) }); }}
          placeholder={option.values.length ? "Add another value" : "Type a value and press Enter"} className="h-6 min-w-[140px] flex-1 border-0 bg-transparent px-1 text-[13px] outline-none" />
      </div>
    </div>
  );
}

function TagInput({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const [draft, setDraft] = useState("");
  const add = () => { const v = draft.trim().replace(/,$/, ""); if (v && !value.includes(v)) onChange([...value, v]); setDraft(""); };
  return (
    <div className="flex flex-wrap items-center gap-1.5 rounded-lg bg-[#fdfdfd] p-1.5 shadow-[inset_0_0_0_1px_#d4d4d4] focus-within:shadow-[inset_0_0_0_2px_#005bd3]">
      {value.map((t) => (
        <span key={t} className="inline-flex h-6 items-center gap-1 rounded-md bg-paper-sunk pl-2 pr-1 text-[12.5px]">{t}
          <button type="button" onClick={() => onChange(value.filter((x) => x !== t))} className="rounded p-0.5 hover:bg-black/10" aria-label={`Remove ${t}`}><Icon name="close" className="h-3 w-3" /></button>
        </span>
      ))}
      <input value={draft} onChange={(e) => setDraft(e.target.value)} onBlur={add} onKeyDown={(e) => { if (e.key === "Enter" || e.key === ",") { e.preventDefault(); add(); } else if (e.key === "Backspace" && !draft && value.length) onChange(value.slice(0, -1)); }}
        placeholder={value.length ? "" : "bestseller, new"} className="h-6 min-w-[90px] flex-1 border-0 bg-transparent px-1 text-[13px] outline-none" aria-label="Add tag" />
    </div>
  );
}

function Picker({ all, value, onChange, placeholder }: { all: { id: number; label: string }[]; value: number[]; onChange: (v: number[]) => void; placeholder: string }) {
  const left = all.filter((x) => !value.includes(x.id));
  return (
    <div className="space-y-1.5">
      {value.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {value.map((id) => { const c = all.find((x) => x.id === id); return c ? (
            <span key={id} className="inline-flex h-6 items-center gap-1 rounded-md bg-paper-sunk pl-2 pr-1 text-[12.5px]">{c.label}
              <button type="button" onClick={() => onChange(value.filter((x) => x !== id))} className="rounded p-0.5 hover:bg-black/10" aria-label={`Remove ${c.label}`}><Icon name="close" className="h-3 w-3" /></button>
            </span>) : null; })}
        </div>
      )}
      {all.length === 0 ? <p className="text-[12px] text-ink-faint">None yet. Create them on the Collections page.</p> : left.length > 0 && (
        <select value="" onChange={(e) => e.target.value && onChange([...value, Number(e.target.value)])} className="input w-full text-ink-soft" aria-label={placeholder}>
          <option value="">{placeholder}</option>{left.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
        </select>
      )}
    </div>
  );
}

/** "Description banners": wide photos under the description. Upload, reorder with the arrows, add a phone photo or a link. */
function BannerList({ initial, onDirty }: { initial: Banner[]; onDirty: () => void }) {
  const { id: storeId } = useParams();
  const [list, setList] = useState<Banner[]>(initial);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [open, setOpen] = useState<number | null>(null);
  const addRef = useRef<HTMLInputElement>(null);
  const mobRef = useRef<HTMLInputElement>(null);
  const target = useRef<number>(-1);
  const change = (next: Banner[]) => { setList(next); onDirty(); };
  const upload = async (f: File) => {
    if (!f.type.startsWith("image/")) throw new Error("Banners must be photos (JPG, PNG or WebP).");
    const r = await sendFile(`${storePath(storeId!)}/media`, f, () => {});
    return r.url;
  };
  const addFiles = async (files: FileList) => {
    setErr(null);
    const out: Banner[] = [];
    for (const f of Array.from(files).slice(0, 20 - list.length)) {
      setBusy(`Uploading ${f.name}…`);
      try { out.push({ image: await upload(f) }); } catch (e) { setErr(e instanceof Error ? e.message : "Upload failed"); }
    }
    setBusy(null);
    if (out.length) change([...list, ...out]);
  };
  const setMobile = async (f: File) => {
    const i = target.current; setErr(null); setBusy("Uploading phone photo…");
    try { const url = await upload(f); change(list.map((b, j) => (j === i ? { ...b, mobile: url } : b))); } catch (e) { setErr(e instanceof Error ? e.message : "Upload failed"); }
    setBusy(null);
  };
  const move = (i: number, j: number) => { if (j < 0 || j >= list.length) return; const n = list.slice(); [n[i], n[j]] = [n[j], n[i]]; change(n); setOpen(open === i ? j : open); };
  const edit = (i: number, k: "alt" | "link", v: string) => change(list.map((b, j) => (j === i ? { ...b, [k]: v } : b)));
  return (
    <section className="panel p-4">
      <input type="hidden" name="siteBanners" value={JSON.stringify(list)} />
      <div className="flex items-start gap-3">
        <div className="flex-1">
          <h2 className="text-[13.5px] font-semibold">Description banners</h2>
          <p className="mt-0.5 text-[12px] text-ink-faint">Wide photos shown one below the other under the description, like a brand page. Use the arrows to change the order.</p>
        </div>
        {list.length < 20 && <button type="button" className="btn-secondary h-8" onClick={() => addRef.current?.click()} disabled={Boolean(busy)}><Icon name="plus" className="h-4 w-4" />Add banners</button>}
      </div>
      {list.length === 0 ? (
        <button type="button" onClick={() => addRef.current?.click()} disabled={Boolean(busy)} className="mt-3 flex w-full flex-col items-center gap-1 rounded-xl border border-dashed border-[#c9c9c9] px-4 py-7 text-[12.5px] text-ink-soft hover:bg-black/[.02]">
          <Icon name="download" className="h-5 w-5 rotate-180" /><b className="font-semibold text-ink">Upload banner photos</b><span>Wide images work best, for example 1600 × 800. You can pick several at once.</span>
        </button>
      ) : (
        <ol className="mt-3 space-y-2">
          {list.map((b, i) => (
            <li key={`${b.image}-${i}`} className="rounded-xl border border-rule bg-white">
              <div className="flex items-center gap-3 p-2">
                <span className="w-5 text-center text-[12px] font-semibold text-ink-faint">{i + 1}</span>
                <img src={b.image} alt="" className="h-14 w-28 shrink-0 rounded-lg object-cover bg-paper" loading="lazy" />
                {b.mobile ? <img src={b.mobile} alt="" title="Phone photo" className="h-14 w-9 shrink-0 rounded-md object-cover bg-paper" loading="lazy" /> : null}
                <div className="min-w-0 flex-1 text-[12px] text-ink-soft">
                  <p className="truncate">{b.alt || "No description"}</p>
                  <p className="truncate text-ink-faint">{b.mobile ? "Separate phone photo" : "Same photo on phones"}{b.link ? ` · links to ${b.link}` : ""}</p>
                </div>
                <div className="flex items-center gap-0.5">
                  <button type="button" onClick={() => move(i, i - 1)} disabled={i === 0} className="flex h-7 w-7 items-center justify-center rounded-md hover:bg-black/5 disabled:opacity-30" aria-label="Move up"><Icon name="arrow" className="h-4 w-4 -rotate-90" /></button>
                  <button type="button" onClick={() => move(i, i + 1)} disabled={i === list.length - 1} className="flex h-7 w-7 items-center justify-center rounded-md hover:bg-black/5 disabled:opacity-30" aria-label="Move down"><Icon name="arrow" className="h-4 w-4 rotate-90" /></button>
                  <button type="button" onClick={() => setOpen(open === i ? null : i)} className="flex h-7 items-center rounded-md px-2 text-[12px] hover:bg-black/5" aria-expanded={open === i}>Edit</button>
                  <button type="button" onClick={() => { change(list.filter((_, j) => j !== i)); setOpen(null); }} className="flex h-7 w-7 items-center justify-center rounded-md text-[#8e1f0b] hover:bg-black/5" aria-label="Remove banner"><Icon name="trash" className="h-4 w-4" /></button>
                </div>
              </div>
              {open === i && (
                <div className="grid gap-3 border-t border-rule p-3 sm:grid-cols-2">
                  <label className="block"><span className="label">Description (for Google and screen readers)</span><input value={b.alt ?? ""} onChange={(e) => edit(i, "alt", e.target.value)} maxLength={160} className="input w-full" placeholder="50 hours of battery life" /></label>
                  <label className="block"><span className="label">Link (optional)</span><input value={b.link ?? ""} onChange={(e) => edit(i, "link", e.target.value)} className="input w-full" placeholder="/category/earbuds" /></label>
                  <div className="sm:col-span-2 flex flex-wrap items-center gap-2 text-[12px] text-ink-soft">
                    <span>Phone photo (optional, tall images look best on phones):</span>
                    <button type="button" className="btn-secondary h-7" disabled={Boolean(busy)} onClick={() => { target.current = i; mobRef.current?.click(); }}>{b.mobile ? "Change" : "Upload"}</button>
                    {b.mobile && <button type="button" className="btn-secondary h-7" onClick={() => change(list.map((x, j) => (j === i ? { image: x.image, ...(x.alt ? { alt: x.alt } : {}), ...(x.link ? { link: x.link } : {}) } : x)))}>Remove</button>}
                  </div>
                </div>
              )}
            </li>
          ))}
        </ol>
      )}
      {busy && <p className="mt-2 text-[12px] text-ink-soft">{busy}</p>}
      {err && <p className="mt-2 text-[12px] text-[#8e1f0b]">{err}</p>}
      <input ref={addRef} type="file" accept="image/*" multiple className="sr-only" onChange={(e) => { if (e.target.files?.length) addFiles(e.target.files); e.target.value = ""; }} />
      <input ref={mobRef} type="file" accept="image/*" className="sr-only" onChange={(e) => { const f = e.target.files?.[0]; if (f) setMobile(f); e.target.value = ""; }} />
    </section>
  );
}

/** Small rich-text box: bold, italic, underline, headings, lists, links; HTML view for power users. */
function RichText({ value, onChange }: { value: string; onChange: (html: string) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [code, setCode] = useState(false);
  useEffect(() => { if (ref.current && ref.current.innerHTML !== value && !code) ref.current.innerHTML = value; }, [code]); // eslint-disable-line react-hooks/exhaustive-deps
  const cmd = (c: string, arg?: string) => { ref.current?.focus(); document.execCommand(c, false, arg); onChange(ref.current?.innerHTML ?? ""); };
  const B = ({ c, arg, label, children }: { c: string; arg?: string; label: string; children: React.ReactNode }) => (
    <button type="button" onMouseDown={(e) => { e.preventDefault(); cmd(c, arg); }} title={label} aria-label={label} className="flex h-7 min-w-7 items-center justify-center rounded-md px-1.5 text-[13px] text-ink-soft hover:bg-black/5 hover:text-ink" disabled={code}>{children}</button>
  );
  return (
    <div className="overflow-hidden rounded-lg bg-[#fdfdfd] shadow-[inset_0_0_0_1px_#d4d4d4] focus-within:shadow-[inset_0_0_0_2px_#005bd3]">
      <div className="flex flex-wrap items-center gap-0.5 border-b border-rule bg-paper px-1.5 py-1">
        <select onChange={(e) => { cmd("formatBlock", e.target.value); e.target.value = ""; }} defaultValue="" className="h-7 rounded-md border-0 bg-transparent px-1.5 text-[12.5px] text-ink-soft outline-none hover:bg-black/5" aria-label="Text style" disabled={code}>
          <option value="" disabled>Paragraph</option><option value="p">Paragraph</option><option value="h2">Heading</option><option value="h3">Subheading</option>
        </select>
        <span className="mx-1 h-4 w-px bg-rule" />
        <B c="bold" label="Bold"><b>B</b></B><B c="italic" label="Italic"><i className="font-serif">I</i></B><B c="underline" label="Underline"><u>U</u></B>
        <span className="mx-1 h-4 w-px bg-rule" />
        <B c="insertUnorderedList" label="Bullet list">•≡</B><B c="insertOrderedList" label="Numbered list">1.</B>
        <button type="button" onMouseDown={(e) => { e.preventDefault(); const u = prompt("Link address"); if (u) cmd("createLink", u); }} className="flex h-7 items-center rounded-md px-1.5 text-[12.5px] text-ink-soft hover:bg-black/5" aria-label="Add link" disabled={code}>Link</button>
        <B c="removeFormat" label="Clear formatting">⌫</B>
        <span className="flex-1" />
        <button type="button" onClick={() => setCode(!code)} className={`flex h-7 items-center rounded-md px-1.5 font-mono text-[12px] ${code ? "bg-[#303030] text-white" : "text-ink-soft hover:bg-black/5"}`} aria-pressed={code} title="Show HTML">&lt;/&gt;</button>
      </div>
      {code
        ? <textarea value={value} onChange={(e) => onChange(e.target.value)} rows={8} className="block w-full resize-y border-0 bg-transparent px-3 py-2 font-mono text-[12px] outline-none" aria-label="Description HTML" />
        : <div ref={ref} contentEditable suppressContentEditableWarning onInput={() => onChange(ref.current?.innerHTML ?? "")} className="rte min-h-[150px] px-3 py-2 text-[13px] leading-relaxed outline-none [&_h2]:text-[16px] [&_h2]:font-semibold [&_h3]:text-[14px] [&_h3]:font-semibold [&_ol]:list-decimal [&_ol]:pl-5 [&_ul]:list-disc [&_ul]:pl-5 [&_a]:text-[#005bd3] [&_a]:underline" aria-label="Description" role="textbox" aria-multiline="true" />}
    </div>
  );
}

// ---------- photos & video clips ----------

const ACCEPT = "image/jpeg,image/png,image/webp,image/gif,video/mp4,video/webm,video/quicktime";
type Upload = { id: number; name: string; pct: number; error?: string };

/** Big photos are shrunk in the browser first (max 2048 px, WebP), so pages stay fast and uploads are quick. */
async function shrink(file: File): Promise<Blob> {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type) || file.size < 600 * 1024) return file;
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, 2048 / Math.max(bmp.width, bmp.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bmp.width * scale);
    canvas.height = Math.round(bmp.height * scale);
    canvas.getContext("2d")!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    const out = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/webp", 0.86));
    return out && out.size < file.size ? out : file;
  } catch {
    return file;
  }
}

function sendFile(url: string, blob: Blob, onPct: (n: number) => void) {
  return new Promise<{ url: string; type: "image" | "video" }>((resolve, reject) => {
    const x = new XMLHttpRequest();
    x.open("POST", url);
    x.setRequestHeader("Content-Type", blob.type);
    if (blob instanceof File && blob.name) x.setRequestHeader("X-File-Name", encodeURIComponent(blob.name));
    x.upload.onprogress = (e) => e.lengthComputable && onPct(Math.round((e.loaded / e.total) * 100));
    x.onload = () => {
      let d: { url?: string; type?: "image" | "video"; error?: string } = {};
      try { d = JSON.parse(x.responseText); } catch { /* not json */ }
      if (x.status < 300 && d.url) resolve({ url: d.url, type: d.type ?? "image" });
      else reject(new Error(d.error ?? `Upload failed (${x.status})`));
    };
    x.onerror = () => reject(new Error("No internet. Please try again."));
    x.send(blob);
  });
}

function MediaManager({ media, setMedia: set }: { media: ItemImage[]; setMedia: (m: ItemImage[]) => void }) {
  const mediaRef = useRef(media);
  mediaRef.current = media;
  const setMedia = (f: ItemImage[] | ((m: ItemImage[]) => ItemImage[])) => set(typeof f === "function" ? f(mediaRef.current) : f);
  const { id: storeId } = useParams();
  const input = useRef<HTMLInputElement>(null);
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [drag, setDrag] = useState(false);
  const [link, setLink] = useState("");

  const upload = async (files: FileList | File[]) => {
    for (const file of Array.from(files).slice(0, 20)) {
      const id = Date.now() + Math.random();
      setUploads((u) => [...u, { id, name: file.name, pct: 0 }]);
      try {
        const blob = await shrink(file);
        const r = await sendFile(`${storePath(storeId)}/media`, blob, (pct) => setUploads((u) => u.map((x) => (x.id === id ? { ...x, pct } : x))));
        setMedia((m) => [...m, { url: r.url, type: r.type }]);
        setUploads((u) => u.filter((x) => x.id !== id));
      } catch (e) {
        setUploads((u) => u.map((x) => (x.id === id ? { ...x, error: e instanceof Error ? e.message : "Upload failed" } : x)));
      }
    }
  };
  const move = (i: number, d: number) => setMedia((m) => { const n = [...m]; const j = i + d; if (j < 0 || j >= n.length) return m; [n[i], n[j]] = [n[j], n[i]]; return n; });
  const addLink = () => {
    const url = link.trim();
    if (!/^https?:\/\//.test(url)) return;
    setMedia((m) => [...m, { url, type: /\.(mp4|webm|mov)(\?|$)/i.test(url) ? "video" : "image" }]);
    setLink("");
  };

  return (
    <div className="space-y-2">

      {media.length > 0 && (
        <ul className="grid grid-cols-[repeat(auto-fill,minmax(104px,1fr))] gap-2">
          {media.map((m, i) => (
            <li key={m.url} className={`group relative overflow-hidden rounded-lg bg-paper-sunk shadow-[0_0_0_1px_rgba(0,0,0,.06)] ${i === 0 ? "col-span-2 row-span-2" : ""}`}>
              {m.type === "video"
                ? <video src={m.url} poster={m.poster} muted playsInline preload="metadata" className="aspect-square w-full object-cover" />
                : <img src={m.url} alt="" className="aspect-square w-full object-cover" loading="lazy" />}
              {m.type === "video" && <span className="absolute left-1.5 top-1.5 rounded bg-black/70 px-1.5 py-0.5 text-[10px] font-semibold text-white">Video</span>}
              {i === 0 && <span className="absolute bottom-1.5 left-1.5 rounded bg-white/90 px-1.5 py-0.5 text-[10px] font-semibold">Cover</span>}
              <div className="absolute right-1 top-1 flex gap-1 opacity-100 sm:opacity-0 sm:transition sm:group-hover:opacity-100">
                {i > 0 && <button type="button" onClick={() => move(i, -1)} className="rounded bg-white/90 px-1.5 text-xs" aria-label="Move earlier">←</button>}
                <button type="button" onClick={() => setMedia((x) => x.filter((_, j) => j !== i))} className="rounded bg-white/90 px-1.5 text-xs text-bad" aria-label="Remove">✕</button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {uploads.map((u) => (
        <div key={u.id} className="rounded-lg border border-rule px-3 py-2 text-xs">
          <div className="flex justify-between gap-2"><span className="truncate">{u.name}</span><span className={u.error ? "text-bad" : "text-ink-soft"}>{u.error ?? `${u.pct}%`}</span></div>
          {!u.error && <div className="mt-1.5 h-1 rounded bg-paper-sunk"><div className="h-1 rounded bg-pine transition-all" style={{ width: `${u.pct}%` }} /></div>}
          {u.error && <button type="button" className="mt-1 text-ink-faint underline" onClick={() => setUploads((x) => x.filter((y) => y.id !== u.id))}>Dismiss</button>}
        </div>
      ))}

      <button type="button" onClick={() => input.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); if (e.dataTransfer.files.length) void upload(e.dataTransfer.files); }}
        className={`flex w-full flex-col items-center gap-1.5 rounded-lg border border-dashed px-4 py-7 text-center transition ${drag ? "border-[#005bd3] bg-[#f2f7fe]" : "border-[#b5b5b5] hover:bg-paper"}`}>
        <span className="flex items-center gap-2"><span className="rounded-lg bg-paper-sunk px-2.5 py-1 text-[12.5px] font-semibold text-ink">Upload new</span><span className="text-[12.5px] font-medium text-ink-soft">or drop files</span></span>
        <span className="text-[12px] text-ink-faint">Images (up to 15 MB) and videos (MP4, WebM, MOV up to 150 MB) · first one is the cover</span>
      </button>
      <input ref={input} type="file" accept={ACCEPT} multiple hidden onChange={(e) => { if (e.target.files?.length) void upload(e.target.files); e.target.value = ""; }} />

      <div className="flex gap-2">
        <input value={link} onChange={(e) => setLink(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addLink(); } }}
          placeholder="Or paste a photo / video link" className="input min-w-0 flex-1" aria-label="Photo or video link" />
        <button type="button" onClick={addLink} className="btn-secondary">Add</button>
      </div>
    </div>
  );
}
