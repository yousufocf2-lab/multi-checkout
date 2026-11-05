// Growpefy Store → add / edit one product (dish, course, room ...): details, photos, options, variants, categories.
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { Form, Link, useActionData, useLoaderData, useParams } from "@remix-run/react";
import { useRef, useState } from "react";
import type { ItemImage } from "~/db.server";
import { Notice, SubmitButton } from "~/components/ui";
import { requireStore, requireViewer } from "~/lib/auth.server";
import { packOf } from "~/lib/business-types";
import { catalogAllowed, deleteItem, getItem, listCategories, saveItem, type ItemStatus, type VariantInput } from "~/lib/catalog.server";
import { rupeesToPaise } from "~/lib/pricing";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const viewer = await requireViewer(request);
  const store = await requireStore(viewer, params.id);
  if (!catalogAllowed(viewer, store)) throw new Response("Not found", { status: 404 });
  const pack = packOf(store.businessType);
  const categories = await listCategories(store.id);
  if (params.itemId === "new") return json({ pack, categories, item: null, variants: [], categoryIds: [] as number[] });
  const found = await getItem(store.id, Number(params.itemId));
  if (!found) throw new Response("Not found", { status: 404 });
  return json({ pack, categories, item: found.item, variants: found.variants, categoryIds: found.categoryIds });
}

const str = (v: FormDataEntryValue | null) => String(v ?? "").trim();

export async function action({ request, params }: ActionFunctionArgs) {
  const viewer = await requireViewer(request);
  const store = await requireStore(viewer, params.id);
  if (!catalogAllowed(viewer, store)) throw new Response("Not found", { status: 404 });
  const fd = await request.formData();
  const id = params.itemId === "new" ? undefined : Number(params.itemId);

  if (fd.get("intent") === "delete" && id) {
    await deleteItem(store.id, id);
    return redirect(`/dashboard/stores/${store.id}/catalog`);
  }

  try {
    const options = JSON.parse(str(fd.get("options")) || "[]") as { name: string; values: string[] }[];
    const rows = JSON.parse(str(fd.get("variants")) || "[]") as { title: string; optionValues: string[]; price: string; compareAt: string; sku: string; stock: string }[];
    const variants: VariantInput[] = rows.map((r) => ({
      title: r.title, optionValues: r.optionValues, sku: r.sku.trim() || null,
      pricePaise: rupeesToPaise(r.price) ?? 0, compareAtPaise: rupeesToPaise(r.compareAt),
      stock: r.stock.trim() === "" ? null : Math.max(0, Math.round(Number(r.stock) || 0)),
    }));
    const status = (["active", "draft", "archived"].includes(str(fd.get("status"))) ? str(fd.get("status")) : "draft") as ItemStatus;
    const newId = await saveItem(store, {
      title: str(fd.get("title")), handle: str(fd.get("handle")) || undefined, descriptionHtml: str(fd.get("description")), status,
      vendor: str(fd.get("vendor")) || null, productType: str(fd.get("productType")) || null,
      tags: str(fd.get("tags")).split(",").map((t) => t.trim()).filter(Boolean),
      images: readMedia(str(fd.get("media"))),
      options: options.filter((o) => o.name.trim() && o.values.length), variants,
      categoryIds: fd.getAll("category").map(Number).filter(Boolean),
      seoTitle: str(fd.get("seoTitle")) || null, seoDescription: str(fd.get("seoDescription")) || null,
    }, id);
    if (!id) return redirect(`/dashboard/stores/${store.id}/catalog/${newId}?saved=1`);
    return json({ ok: "Saved.", error: null });
  } catch (e) {
    return json({ ok: null, error: e instanceof Error ? e.message : "Couldn't save" }, { status: 400 });
  }
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

type Row = { title: string; optionValues: string[]; price: string; compareAt: string; sku: string; stock: string };
const rupees = (p: number | null | undefined) => (p == null ? "" : String(p / 100));

/** Every combination of option values, keeping prices already typed for a combination. */
function combine(options: { name: string; values: string[] }[], old: Row[]): Row[] {
  const used = options.filter((o) => o.name.trim() && o.values.length);
  if (!used.length) return [old.find((r) => r.optionValues.length === 0) ?? old[0] ?? { title: "Default", optionValues: [], price: "", compareAt: "", sku: "", stock: "" }].map((r) => ({ ...r, title: "Default", optionValues: [] }));
  let combos: string[][] = [[]];
  for (const o of used) combos = combos.flatMap((c) => o.values.map((v) => [...c, v]));
  const first = old[0];
  return combos.slice(0, 250).map((vals) => {
    const key = vals.join(" / ");
    const had = old.find((r) => r.optionValues.join(" / ") === key);
    return had ?? { title: key, optionValues: vals, price: first?.price ?? "", compareAt: first?.compareAt ?? "", sku: "", stock: "" };
  });
}

export default function EditItem() {
  const { pack, categories, item, variants, categoryIds } = useLoaderData<typeof loader>();
  const a = useActionData<typeof action>();
  const saved = typeof window !== "undefined" && new URLSearchParams(window.location.search).get("saved") === "1";
  const Item = pack.item[0].toUpperCase() + pack.item.slice(1);

  const [options, setOptions] = useState<{ name: string; values: string[] }[]>(item?.options ?? []);
  type V = { title: string; optionValues: string[]; pricePaise: number; compareAtPaise: number | null; sku: string | null; stock: number | null };
  const vs = variants as unknown as V[];
  const [rows, setRows] = useState<Row[]>(
    vs.length
      ? vs.map((v) => ({ title: v.title, optionValues: v.optionValues, price: rupees(v.pricePaise), compareAt: rupees(v.compareAtPaise), sku: v.sku ?? "", stock: v.stock == null ? "" : String(v.stock) }))
      : [{ title: "Default", optionValues: [], price: "", compareAt: "", sku: "", stock: "" }],
  );
  const [media, setMedia] = useState<ItemImage[]>(((item?.images ?? []) as ItemImage[]).map((m) => ({ ...m, type: m.type ?? "image" })));

  const setOption = (i: number, next: { name: string; values: string[] } | null) => {
    const list = next ? options.map((o, j) => (j === i ? next : o)) : options.filter((_, j) => j !== i);
    setOptions(list);
    setRows((old) => combine(list, old));
  };
  const setRow = (i: number, key: keyof Row, value: string) => setRows((old) => old.map((r, j) => (j === i ? { ...r, [key]: value } : r)));
  const single = rows.length === 1 && rows[0].optionValues.length === 0;

  return (
    <Form method="post" className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <Link to=".." relative="path" className="btn-quiet" aria-label={`Back to ${pack.items}`}>←</Link>
        <h1 className="flex-1 text-[22px] font-semibold tracking-tight">{item ? item.title : `Add ${pack.item}`}</h1>
        <SubmitButton className="btn-primary" busyText="Saving">Save</SubmitButton>
      </div>
      {(a?.ok || saved) && <Notice tone="success">{a?.ok ?? "Saved."}</Notice>}
      {a?.error && <Notice tone="error">{a.error}</Notice>}

      <input type="hidden" name="options" value={JSON.stringify(options)} />
      <input type="hidden" name="variants" value={JSON.stringify(rows)} />
      <input type="hidden" name="media" value={JSON.stringify(media)} />

      <div className="flex flex-wrap items-start gap-5">
        <div className="min-w-0 flex-[3_1_520px] space-y-5">
          <section className="panel space-y-4 p-5">
            <label className="block text-sm font-medium">Name
              <input name="title" required defaultValue={item?.title ?? ""} className="input mt-1.5 w-full" placeholder={`${Item} name`} />
            </label>
            <label className="block text-sm font-medium">Description
              <textarea name="description" rows={6} defaultValue={item?.descriptionHtml ?? ""} className="input mt-1.5 w-full py-2 font-normal" />
            </label>
          </section>

          <MediaManager media={media} setMedia={setMedia} />

          <section className="panel space-y-4 p-5">
            <div className="flex items-center">
              <h2 className="flex-1 text-[15px] font-semibold">{single ? "Price" : "Variants"}</h2>
              {options.length < 3 && (
                <button type="button" className="btn-quiet text-sm" onClick={() => setOptions([...options, { name: pack.optionHints[options.length] ?? "", values: [] }])}>
                  + Add option ({pack.optionHints.slice(0, 2).join(", ")}…)
                </button>
              )}
            </div>

            {options.map((o, i) => (
              <div key={i} className="flex flex-wrap items-end gap-2 rounded-xl bg-paper p-3">
                <label className="text-xs text-ink-soft">Option
                  <input value={o.name} onChange={(e) => setOption(i, { ...o, name: e.target.value })} className="input mt-1 h-9 w-36" />
                </label>
                <label className="min-w-0 flex-1 text-xs text-ink-soft">Values, separated by commas
                  <input defaultValue={o.values.join(", ")} onBlur={(e) => setOption(i, { ...o, values: e.target.value.split(",").map((v) => v.trim()).filter(Boolean) })} className="input mt-1 h-9 w-full" placeholder="Black, Silver, Blue" />
                </label>
                <button type="button" className="btn-quiet h-9 text-sm text-bad" onClick={() => setOption(i, null)}>Remove</button>
              </div>
            ))}

            <div className="scroll-thin overflow-x-auto">
              <table className="table min-w-[640px]">
                <thead><tr>{!single && <th>Variant</th>}<th>Price (₹)</th><th>MRP (₹)</th><th>SKU</th><th>Stock</th></tr></thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={r.title + i}>
                      {!single && <td className="text-sm font-medium">{r.title}</td>}
                      <td><input inputMode="decimal" value={r.price} onChange={(e) => setRow(i, "price", e.target.value)} className="input h-9 w-28" aria-label={`Price ${r.title}`} required /></td>
                      <td><input inputMode="decimal" value={r.compareAt} onChange={(e) => setRow(i, "compareAt", e.target.value)} className="input h-9 w-28" aria-label={`MRP ${r.title}`} /></td>
                      <td><input value={r.sku} onChange={(e) => setRow(i, "sku", e.target.value)} className="input h-9 w-32" aria-label={`SKU ${r.title}`} /></td>
                      <td><input inputMode="numeric" value={r.stock} onChange={(e) => setRow(i, "stock", e.target.value)} className="input h-9 w-24" placeholder="Not tracked" aria-label={`Stock ${r.title}`} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <details className="panel p-5">
            <summary className="cursor-pointer text-[15px] font-semibold">Search engine listing</summary>
            <div className="mt-4 space-y-3">
              <label className="block text-sm">Page title<input name="seoTitle" defaultValue={item?.seoTitle ?? ""} className="input mt-1.5 w-full" /></label>
              <label className="block text-sm">Description<textarea name="seoDescription" rows={2} defaultValue={item?.seoDescription ?? ""} className="input mt-1.5 w-full py-2" /></label>
              <label className="block text-sm">URL handle<input name="handle" defaultValue={item?.handle ?? ""} className="input mt-1.5 w-full" placeholder="made from the name" /></label>
            </div>
          </details>
        </div>

        <aside className="min-w-0 flex-[1_1_260px] space-y-5">
          <section className="panel space-y-3 p-5">
            <label className="block text-sm font-medium">Status
              <select name="status" defaultValue={item?.status ?? "active"} className="input mt-1.5 w-full">
                <option value="active">Active (on the website)</option>
                <option value="draft">Draft (hidden)</option>
                <option value="archived">Archived</option>
              </select>
            </label>
          </section>
          <section className="panel space-y-3 p-5">
            <h2 className="text-[15px] font-semibold">{pack.categories}</h2>
            {categories.length === 0 ? <p className="text-sm text-ink-faint">Add categories on the {pack.items} page.</p> : categories.map((c) => (
              <label key={c.id} className="flex items-center gap-2 text-sm"><input type="checkbox" name="category" value={c.id} defaultChecked={categoryIds.includes(c.id)} />{c.title}</label>
            ))}
          </section>
          <section className="panel space-y-3 p-5">
            <label className="block text-sm">Type<input name="productType" defaultValue={item?.productType ?? ""} className="input mt-1.5 w-full" placeholder="Smartwatch" /></label>
            <label className="block text-sm">Brand<input name="vendor" defaultValue={item?.vendor ?? ""} className="input mt-1.5 w-full" /></label>
            <label className="block text-sm">Tags<input name="tags" defaultValue={(item?.tags ?? []).join(", ")} className="input mt-1.5 w-full" placeholder="bestseller, new" /></label>
          </section>
          {item && (
            <button type="submit" name="intent" value="delete" formNoValidate className="btn-danger w-full"
              onClick={(e) => { if (!confirm(`Delete “${item.title}”? This can't be undone.`)) e.preventDefault(); }}>
              Delete {pack.item}
            </button>
          )}
        </aside>
      </div>
    </Form>
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

function MediaManager({ media, setMedia }: { media: ItemImage[]; setMedia: React.Dispatch<React.SetStateAction<ItemImage[]>> }) {
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
        const r = await sendFile(`/dashboard/stores/${storeId}/media`, blob, (pct) => setUploads((u) => u.map((x) => (x.id === id ? { ...x, pct } : x))));
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
    <section className="panel space-y-3 p-5">
      <div className="flex items-center">
        <h2 className="flex-1 text-[15px] font-semibold">Photos & videos</h2>
        <span className="text-xs text-ink-faint">First one is the cover</span>
      </div>

      {media.length > 0 && (
        <ul className="grid grid-cols-[repeat(auto-fill,minmax(104px,1fr))] gap-2">
          {media.map((m, i) => (
            <li key={m.url} className="group relative overflow-hidden rounded-xl border border-rule bg-paper-sunk">
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
        className={`flex w-full flex-col items-center gap-1 rounded-xl border-2 border-dashed px-4 py-6 text-center transition ${drag ? "border-pine bg-pine-tint/40" : "border-rule-strong hover:border-pine"}`}>
        <span className="text-sm font-semibold text-pine">Upload photos or videos</span>
        <span className="text-xs text-ink-faint">Drag files here or tap to choose · photos up to 15 MB · videos (MP4, WebM, MOV) up to 150 MB</span>
      </button>
      <input ref={input} type="file" accept={ACCEPT} multiple hidden onChange={(e) => { if (e.target.files?.length) void upload(e.target.files); e.target.value = ""; }} />

      <div className="flex gap-2">
        <input value={link} onChange={(e) => setLink(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addLink(); } }}
          placeholder="Or paste a photo / video link" className="input h-9 min-w-0 flex-1 text-sm" aria-label="Photo or video link" />
        <button type="button" onClick={addLink} className="btn-secondary h-9">Add</button>
      </div>
    </section>
  );
}
