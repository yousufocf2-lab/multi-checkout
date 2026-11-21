// Shipping → Label design: the store chooses how its shipping labels look (size, logo or name, what's shown),
// with a live preview of the real PDF.
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Link, useFetcher, useLoaderData } from "@remix-run/react";
import { eq } from "drizzle-orm";
import { useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "~/components/Icons";
import { db, stores } from "~/db.server";
import { can, requireStore, requireViewer } from "~/lib/auth.server";
import { DEFAULT_LABEL, LABEL_SIZES, resolveLabel, type LabelConfig } from "~/lib/label-config";
import { storePath } from "~/lib/store-code";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const viewer = await requireViewer(request);
  const store = await requireStore(viewer, params.id);
  if (!can(viewer, "rto") && !can(viewer, "settings")) throw new Response("Not allowed", { status: 403 });
  return json({ storeId: store.id, name: store.name, storeLogo: store.logoUrl, cfg: resolveLabel(store.labelConfig) });
}

export async function action({ request, params }: ActionFunctionArgs) {
  const viewer = await requireViewer(request);
  const store = await requireStore(viewer, params.id);
  if (!can(viewer, "rto") && !can(viewer, "settings")) return json({ ok: null, error: "Not allowed" }, { status: 403 });
  const fd = await request.formData();
  let raw: unknown = {};
  try { raw = JSON.parse(String(fd.get("cfg") ?? "{}")); } catch { return json({ ok: null, error: "Couldn't read the design." }); }
  const cfg = fd.get("intent") === "reset" ? DEFAULT_LABEL : resolveLabel(raw);
  await db.update(stores).set({ labelConfig: cfg }).where(eq(stores.id, store.id));
  return json({ ok: fd.get("intent") === "reset" ? "Label design reset." : "Label design saved. New labels use it.", error: null });
}

/** Any image → PNG (max 800 px wide) in the browser, so the PDF can always use it. */
async function toPng(file: File): Promise<Blob> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((ok, bad) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => bad(new Error("That image couldn't be read.")); i.src = url; });
    const scale = Math.min(1, 800 / img.naturalWidth);
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(img.naturalWidth * scale));
    c.height = Math.max(1, Math.round(img.naturalHeight * scale));
    const ctx = c.getContext("2d")!;
    ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, c.width, c.height); // transparent → white (thermal paper)
    ctx.drawImage(img, 0, 0, c.width, c.height);
    return await new Promise<Blob>((ok, bad) => c.toBlob((b) => (b ? ok(b) : bad(new Error("Couldn't convert the image."))), "image/png"));
  } finally {
    URL.revokeObjectURL(url);
  }
}

export default function LabelDesign() {
  const d = useLoaderData<typeof loader>();
  const save = useFetcher<{ ok: string | null; error: string | null }>();
  const [cfg, setCfg] = useState<LabelConfig>(d.cfg);
  const [saved, setSaved] = useState(JSON.stringify(d.cfg));
  const [uploading, setUploading] = useState("");
  const set = <K extends keyof LabelConfig>(k: K, v: LabelConfig[K]) => setCfg((p) => ({ ...p, [k]: v }));
  const base = storePath(d.storeId);
  const dirty = JSON.stringify(cfg) !== saved;
  useEffect(() => { if (save.state === "idle" && save.data?.ok) setSaved(JSON.stringify(cfg)); }, [save.state, save.data]); // eslint-disable-line react-hooks/exhaustive-deps

  // Live preview: the real PDF, redrawn shortly after a change
  const [src, setSrc] = useState(`${base}/logistics/labels?preview=${encodeURIComponent(JSON.stringify(d.cfg))}`);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    const t = setTimeout(() => setSrc(`${base}/logistics/labels?preview=${encodeURIComponent(JSON.stringify(cfg))}#toolbar=0&view=FitH`), 600);
    return () => clearTimeout(t);
  }, [cfg, base]);

  const upload = async (file: File | undefined) => {
    if (!file) return;
    setUploading("Uploading…");
    try {
      const png = await toPng(file);
      const r = await fetch(`${base}/media`, { method: "POST", headers: { "Content-Type": "image/png", "X-File-Name": encodeURIComponent(`label-logo-${file.name}`) }, body: png });
      const j = (await r.json()) as { url?: string; error?: string };
      if (!j.url) throw new Error(j.error ?? "Upload failed");
      setCfg((p) => ({ ...p, logoUrl: j.url!, logo: true }));
      setUploading("");
    } catch (e) {
      setUploading(e instanceof Error ? e.message : "Upload failed");
    }
  };
  const useStoreLogo = useMemo(() => d.storeLogo && /\.(png|jpe?g)(\?|$)/i.test(d.storeLogo) ? d.storeLogo : null, [d.storeLogo]);

  return (
    <div className="mx-auto w-full max-w-6xl space-y-4 pb-10">
      <div className="flex flex-wrap items-center gap-3">
        <Link to={`${base}/logistics`} className="flex h-8 items-center gap-1 rounded-lg px-2 text-[13px] font-medium text-ink-soft hover:bg-black/5"><Icon name="chevron" className="h-4 w-4 rotate-90" />Shipments</Link>
        <div className="min-w-0 flex-1">
          <h1 className="text-[18px] font-semibold tracking-tight">Shipping label design</h1>
          <p className="text-[12.5px] text-ink-soft">Choose the size and what your labels show. Every label printed from Shipments uses this design.</p>
        </div>
        <button type="button" disabled={save.state !== "idle"} onClick={() => { if (confirm("Reset the label to the default design?")) save.submit({ intent: "reset", cfg: "{}" }, { method: "post" }); }} className="btn-secondary h-9 px-3 text-sm">Reset</button>
        <button type="button" disabled={!dirty || save.state !== "idle"} onClick={() => save.submit({ intent: "save", cfg: JSON.stringify(cfg) }, { method: "post" })} className="btn-primary h-9 px-4 text-sm disabled:opacity-50">{save.state !== "idle" ? "Saving…" : dirty ? "Save design" : "Saved"}</button>
      </div>
      {save.data?.error && <p role="alert" className="rounded-lg bg-[#fdeceb] px-3 py-2 text-[13px] text-[#8e1f0b]">{save.data.error}</p>}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
        <div className="space-y-4">
          <Card title="Label size">
            <div className="grid grid-cols-2 gap-2">
              {LABEL_SIZES.map((s) => (
                <button key={s.id} type="button" onClick={() => set("size", s.id)} aria-pressed={cfg.size === s.id}
                  className={`flex items-center gap-3 rounded-xl p-3 text-left transition ${cfg.size === s.id ? "bg-pine-tint shadow-[inset_0_0_0_2px_rgb(var(--brand))]" : "bg-white shadow-[inset_0_0_0_1px_#e3e3e3] hover:bg-paper"}`}>
                  <SizeIcon id={s.id} on={cfg.size === s.id} />
                  <span className="min-w-0"><span className="block text-[13px] font-semibold">{s.title}</span><span className="block text-[11.5px] text-ink-soft">{s.sub}</span></span>
                </button>
              ))}
            </div>
            {(cfg.size === "a4" || cfg.size === "a4x4") && (
              <label className="mt-3 flex items-center gap-3 text-[12.5px]"><input type="color" value={cfg.accent} onChange={(e) => set("accent", e.target.value)} className="h-8 w-10 cursor-pointer rounded border border-rule" />
                <span><b className="font-medium">Brand colour</b><span className="block text-[11.5px] text-ink-soft">For colour printers: the COD box and the header. Thermal labels stay black.</span></span></label>
            )}
          </Card>

          <Card title="Brand">
            <div className="flex flex-wrap gap-2">
              <Pill on={!cfg.logo} onClick={() => set("logo", false)}>Store name</Pill>
              <Pill on={cfg.logo} onClick={() => (cfg.logoUrl ? set("logo", true) : useStoreLogo ? setCfg((p) => ({ ...p, logo: true, logoUrl: useStoreLogo })) : document.getElementById("label-logo")?.click())}>Logo</Pill>
            </div>
            {cfg.logo ? (
              <div className="mt-3 flex items-center gap-3">
                {cfg.logoUrl && <img src={cfg.logoUrl} alt="" className="h-12 max-w-[160px] rounded border border-rule bg-white object-contain p-1" />}
                <button type="button" onClick={() => document.getElementById("label-logo")?.click()} className="btn-secondary h-8 px-3 text-[12.5px]">{cfg.logoUrl ? "Change logo" : "Upload logo"}</button>
                {useStoreLogo && cfg.logoUrl !== useStoreLogo && <button type="button" onClick={() => set("logoUrl", useStoreLogo)} className="text-[12px] font-medium text-[#005bd3]">Use store logo</button>}
              </div>
            ) : (
              <input value={cfg.brandName} onChange={(e) => set("brandName", e.target.value)} placeholder={d.name} maxLength={60} className="input mt-3 h-9 text-[13px]" aria-label="Brand name on the label" />
            )}
            <input id="label-logo" type="file" accept="image/*" className="hidden" onChange={(e) => { void upload(e.target.files?.[0]); e.target.value = ""; }} />
            {uploading && <p className="mt-2 text-[12px] text-ink-soft">{uploading}</p>}
            <p className="mt-2 text-[11.5px] text-ink-faint">A black logo on white prints best on thermal labels. Without a logo, the name is printed.</p>
          </Card>

          <Card title="Customer">
            <Check on={cfg.showMobile} onChange={(v) => set("showMobile", v)} label="Customer's mobile number" hint="The courier calls this number. Hide it only if your courier doesn't need it on the label." />
          </Card>

          <Card title="Products">
            <div className="flex flex-wrap gap-2">
              {([["name", "Product name"], ["sku", "SKU only"], ["both", "SKU + name"], ["none", "Don't show"]] as const).map(([id, l]) => <Pill key={id} on={cfg.product === id} onClick={() => set("product", id)}>{l}</Pill>)}
            </div>
            {(cfg.product === "name" || cfg.product === "both") && (
              <label className="mt-3 flex items-center gap-2 text-[12.5px] text-ink-soft">Cut the name after <input type="number" min={10} max={120} value={cfg.nameChars} onChange={(e) => set("nameChars", Number(e.target.value) || 60)} className="input h-8 w-20 text-[13px]" /> characters</label>
            )}
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              <Check on={cfg.showQty} onChange={(v) => set("showQty", v)} label="Quantity" />
              <Check on={cfg.showPrice} onChange={(v) => set("showPrice", v)} label="Item price and total" />
            </div>
            <p className="mt-2 text-[11.5px] text-ink-faint">SKU comes from your Growpefy products. Items without a SKU show their name.</p>
          </Card>

          <Card title="Order and payment">
            <div className="grid gap-2 sm:grid-cols-2">
              <Check on={cfg.showOrderBarcode} onChange={(v) => set("showOrderBarcode", v)} label="Order number barcode" />
              <Check on={cfg.showDate} onChange={(v) => set("showDate", v)} label="Order date" />
              <Check on={cfg.showSortCode} onChange={(v) => set("showSortCode", v)} label="Delhivery sort code" />
              <Check on={cfg.showInvoiceValue} onChange={(v) => set("showInvoiceValue", v)} label="Order value on prepaid labels" />
            </div>
            <p className="mt-2 text-[11.5px] text-ink-faint">The cash on delivery amount and the AWB barcode are always printed, large, as couriers need them.</p>
          </Card>

          <Card title="Your address">
            <Check on={cfg.showReturn} onChange={(v) => set("showReturn", v)} label="Return address" hint="Where the parcel comes back if it isn't delivered." />
            {cfg.showReturn && <textarea value={cfg.returnAddress} onChange={(e) => set("returnAddress", e.target.value)} rows={2} maxLength={300} placeholder="Leave empty to use the pickup address" className="input mt-2 text-[13px]" />}
            <div className="mt-3"><Check on={cfg.showPickup} onChange={(v) => set("showPickup", v)} label="Pickup address" hint="Printed separately only when it's different from the return address." /></div>
            {(cfg.showPickup || cfg.showReturn) && <textarea value={cfg.pickupAddress} onChange={(e) => set("pickupAddress", e.target.value)} rows={2} maxLength={300} placeholder="Warehouse address, city, state, PIN" className="input mt-2 text-[13px]" />}
            <div className="mt-3"><Check on={cfg.showGst} onChange={(v) => set("showGst", v)} label="GSTIN" /></div>
            {cfg.showGst && <input value={cfg.gstin} onChange={(e) => set("gstin", e.target.value.toUpperCase())} maxLength={15} placeholder="22AAAAA0000A1Z5" className="input mt-2 h-9 text-[13px] uppercase" />}
          </Card>

          <Card title="Note at the bottom">
            <input value={cfg.note} onChange={(e) => set("note", e.target.value)} maxLength={120} placeholder="e.g. Handle with care · Fragile" className="input h-9 text-[13px]" />
          </Card>
        </div>

        <div className="lg:sticky lg:top-4 lg:self-start">
          <div className="panel overflow-hidden p-0">
            <div className="flex items-center justify-between border-b border-rule px-4 py-2.5">
              <p className="text-[13px] font-semibold">Preview</p>
              <a href={src.replace(/#.*$/, "")} target="_blank" rel="noreferrer" className="text-[12px] font-medium text-[#005bd3]">Open full size</a>
            </div>
            <div className="bg-[#e9e9ea] p-3">
              <iframe key={src} title="Label preview" src={src} className="h-[640px] w-full rounded-md border-0 bg-white" />
            </div>
            <p className="px-4 py-2.5 text-[11.5px] text-ink-faint">Shows your latest order. The sort code here is a sample; real labels get it from Delhivery. Print at 100% (actual size), not "fit to page".</p>
          </div>
        </div>
      </div>
      {save.data?.ok && <div className="fixed bottom-5 left-1/2 z-[80] -translate-x-1/2 rounded-lg bg-[#1a1a1a] px-3.5 py-2 text-[13px] font-medium text-white shadow-lg" role="status">{save.data.ok}</div>}
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className="panel p-4"><h2 className="mb-3 text-[11.5px] font-semibold uppercase tracking-wide text-ink-soft">{title}</h2>{children}</section>;
}
function Pill({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return <button type="button" onClick={onClick} aria-pressed={on} className={`rounded-lg px-3 py-1.5 text-[12.5px] font-medium ${on ? "bg-ink text-white" : "bg-white text-ink-soft shadow-[inset_0_0_0_1px_#d4d4d4] hover:text-ink"}`}>{children}</button>;
}
function Check({ on, onChange, label, hint }: { on: boolean; onChange: (v: boolean) => void; label: string; hint?: string }) {
  return (
    <label className="flex cursor-pointer items-start gap-2.5">
      <input type="checkbox" checked={on} onChange={(e) => onChange(e.target.checked)} className="mt-0.5 h-4 w-4 accent-[rgb(var(--brand))]" />
      <span className="text-[13px]"><span className="font-medium">{label}</span>{hint && <span className="block text-[11.5px] text-ink-soft">{hint}</span>}</span>
    </label>
  );
}
function SizeIcon({ id, on }: { id: string; on: boolean }) {
  const c = on ? "rgb(var(--brand))" : "#9ca3af";
  const box = id === "6x4" ? { w: 30, h: 20 } : id === "4x6" ? { w: 20, h: 30 } : { w: 24, h: 32 };
  return (
    <svg width="34" height="34" viewBox="0 0 34 34" aria-hidden="true">
      <rect x={(34 - box.w) / 2} y={(34 - box.h) / 2} width={box.w} height={box.h} rx="2" fill="#fff" stroke={c} strokeWidth="1.6" />
      {id === "a4x4" && <path d={`M17 ${(34 - box.h) / 2} V${(34 + box.h) / 2} M${(34 - box.w) / 2} 17 H${(34 + box.w) / 2}`} stroke={c} strokeWidth="1" strokeDasharray="2 2" />}
      {id !== "a4x4" && <rect x={(34 - box.w) / 2 + 4} y={(34 - box.h) / 2 + 5} width={box.w - 8} height="4" fill={c} opacity=".6" />}
    </svg>
  );
}
