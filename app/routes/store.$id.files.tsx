// Files: every photo, video and document of the store in one place. Upload, search, copy link, rename, alt text, delete.
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useFetcher, useLoaderData, useRevalidator, useSearchParams } from "@remix-run/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "~/components/Icons";
import { EmptyState, Notice } from "~/components/ui";
import { requireStore, requireViewer } from "~/lib/auth.server";
import { catalogAllowed } from "~/lib/catalog.server";
import { deleteFiles, fileUsage, listFiles, updateFile, type FileKind, type FilesData } from "~/lib/files.server";
import { mediaReady } from "~/lib/media.server";
import { storePath } from "~/lib/store-code";
import { db, storeFiles } from "~/db.server";
import { and, eq } from "drizzle-orm";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const viewer = await requireViewer(request);
  const store = await requireStore(viewer, params.id);
  const allowed = catalogAllowed(viewer, store);
  return json({
    base: storePath(store.id), allowed, ready: mediaReady(),
    data: allowed ? await listFiles(store, new URL(request.url).searchParams) : null,
  });
}

export async function action({ request, params }: ActionFunctionArgs) {
  const viewer = await requireViewer(request);
  const store = await requireStore(viewer, params.id);
  if (!catalogAllowed(viewer, store)) return json({ ok: false, error: "Not allowed" }, { status: 403 });
  const fd = await request.formData();
  const intent = String(fd.get("intent") ?? "");
  try {
    if (intent === "usage") {
      const [f] = await db.select({ url: storeFiles.url }).from(storeFiles).where(and(eq(storeFiles.storeId, store.id), eq(storeFiles.id, Number(fd.get("id"))))).limit(1);
      return json({ ok: true, usage: f ? await fileUsage(store.id, f.url) : [] });
    }
    if (intent === "update") {
      await updateFile(store.id, Number(fd.get("id")), { name: fd.has("name") ? String(fd.get("name")) : undefined, alt: fd.has("alt") ? String(fd.get("alt")) : undefined });
      return json({ ok: true, saved: true });
    }
    if (intent === "delete") {
      const ids = String(fd.get("ids") ?? "").split(",").map(Number).filter((n) => n > 0);
      const n = await deleteFiles(store.id, ids);
      return json({ ok: true, deleted: n });
    }
  } catch (e) {
    return json({ ok: false, error: e instanceof Error ? e.message : "Something went wrong" }, { status: 400 });
  }
  return json({ ok: false, error: "Unknown action" }, { status: 400 });
}

type F = FilesData["files"][number];
type Up = { id: number; name: string; pct: number; error?: string; done?: boolean };
const ACCEPT = "image/jpeg,image/png,image/webp,image/gif,image/avif,video/mp4,video/webm,video/quicktime,application/pdf,text/csv,text/plain,application/json,application/zip,.docx,.doc,.xlsx,.xls,.pptx,.woff,.woff2,.ttf,.otf,.mp3";
const EXT_TYPE: Record<string, string> = { docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", doc: "application/msword", xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", xls: "application/vnd.ms-excel", pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation", woff: "font/woff", woff2: "font/woff2", ttf: "font/ttf", otf: "font/otf", csv: "text/csv", zip: "application/zip", mp3: "audio/mpeg", json: "application/json", txt: "text/plain", pdf: "application/pdf" };

const size = (b: number) => (b < 1024 ? `${b} B` : b < 1024 ** 2 ? `${(b / 1024).toFixed(0)} KB` : b < 1024 ** 3 ? `${(b / 1024 ** 2).toFixed(1)} MB` : `${(b / 1024 ** 3).toFixed(2)} GB`);
const ext = (name: string, mime: string) => (name.includes(".") ? name.split(".").pop()! : mime.split("/").pop()!).slice(0, 5).toUpperCase();
const day = (iso: string) => new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" });

async function dims(f: File) {
  if (!f.type.startsWith("image/") || typeof createImageBitmap !== "function") return null;
  try { const b = await createImageBitmap(f); const d = { w: b.width, h: b.height }; b.close(); return d; } catch { return null; }
}

function send(url: string, f: File, type: string, d: { w: number; h: number } | null, onPct: (n: number) => void) {
  return new Promise<void>((resolve, reject) => {
    const x = new XMLHttpRequest();
    x.open("POST", url);
    x.setRequestHeader("Content-Type", type);
    x.setRequestHeader("X-Library", "1");
    x.setRequestHeader("X-File-Name", encodeURIComponent(f.name));
    if (d) { x.setRequestHeader("X-Width", String(d.w)); x.setRequestHeader("X-Height", String(d.h)); }
    x.upload.onprogress = (e) => e.lengthComputable && onPct(Math.round((e.loaded / e.total) * 100));
    x.onload = () => {
      let j: { url?: string; error?: string } = {};
      try { j = JSON.parse(x.responseText); } catch { /* not json */ }
      if (x.status < 300 && j.url) resolve(); else reject(new Error(j.error ?? `Upload failed (${x.status})`));
    };
    x.onerror = () => reject(new Error("No internet. Please try again."));
    x.send(f);
  });
}

export default function Files() {
  const { base, allowed, ready, data } = useLoaderData<typeof loader>();
  const [params, setParams] = useSearchParams();
  const revalidator = useRevalidator();
  const [view, setView] = useState<"grid" | "list">("grid");
  const [sel, setSel] = useState<Set<number>>(new Set());
  const [open, setOpen] = useState<F | null>(null);
  const [ups, setUps] = useState<Up[]>([]);
  const [drag, setDrag] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [confirmIds, setConfirmIds] = useState<number[] | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const del = useFetcher<{ ok: boolean; deleted?: number; error?: string }>();

  useEffect(() => { try { const v = localStorage.getItem("gp_files_view"); if (v === "list" || v === "grid") setView(v); } catch { /* ignore */ } }, []);
  const setViewSaved = (v: "grid" | "list") => { setView(v); try { localStorage.setItem("gp_files_view", v); } catch { /* ignore */ } };
  const flash = useCallback((m: string) => { setToast(m); window.setTimeout(() => setToast(null), 2200); }, []);
  const copy = useCallback(async (text: string, what = "Link copied") => { try { await navigator.clipboard.writeText(text); flash(what); } catch { flash("Couldn't copy"); } }, [flash]);

  useEffect(() => {
    if (del.state !== "idle" || !del.data) return;
    if (del.data.ok) { flash(`${del.data.deleted ?? 0} file${del.data.deleted === 1 ? "" : "s"} deleted`); setSel(new Set()); setOpen(null); }
    else flash(del.data.error ?? "Couldn't delete");
  }, [del.state, del.data, flash]);

  const upload = useCallback(async (list: FileList | File[]) => {
    const files = [...list].slice(0, 50);
    if (!files.length) return;
    const start = Date.now();
    const rows = files.map((f, i) => ({ id: start + i, name: f.name, pct: 0 }));
    setUps((u) => [...rows, ...u].slice(0, 30));
    let ok = 0;
    for (let i = 0; i < files.length; i += 3) {
      await Promise.all(files.slice(i, i + 3).map(async (f, k) => {
        const id = rows[i + k].id;
        const type = EXT_TYPE[f.name.split(".").pop()?.toLowerCase() ?? ""] || f.type || "application/octet-stream"; // Windows calls .csv "ms-excel"
        try {
          await send(`${base}/media`, f, type, await dims(f), (pct) => setUps((u) => u.map((x) => (x.id === id ? { ...x, pct } : x))));
          ok++;
          setUps((u) => u.map((x) => (x.id === id ? { ...x, pct: 100, done: true } : x)));
        } catch (e) {
          setUps((u) => u.map((x) => (x.id === id ? { ...x, error: e instanceof Error ? e.message : "Upload failed" } : x)));
        }
      }));
    }
    if (ok) { revalidator.revalidate(); flash(`${ok} file${ok === 1 ? "" : "s"} uploaded`); }
    window.setTimeout(() => setUps((u) => u.filter((x) => !x.done)), 2500);
  }, [base, revalidator, flash]);

  // Drag & drop anywhere on the page
  useEffect(() => {
    let depth = 0;
    const has = (e: DragEvent) => [...(e.dataTransfer?.types ?? [])].includes("Files");
    const enter = (e: DragEvent) => { if (!has(e)) return; depth++; setDrag(true); };
    const leave = (e: DragEvent) => { if (!has(e)) return; depth = Math.max(0, depth - 1); if (!depth) setDrag(false); };
    const over = (e: DragEvent) => { if (has(e)) e.preventDefault(); };
    const drop = (e: DragEvent) => { if (!has(e)) return; e.preventDefault(); depth = 0; setDrag(false); if (e.dataTransfer?.files.length) void upload(e.dataTransfer.files); };
    window.addEventListener("dragenter", enter); window.addEventListener("dragleave", leave); window.addEventListener("dragover", over); window.addEventListener("drop", drop);
    return () => { window.removeEventListener("dragenter", enter); window.removeEventListener("dragleave", leave); window.removeEventListener("dragover", over); window.removeEventListener("drop", drop); };
  }, [upload]);

  // Search: update the URL a moment after typing stops
  const [q, setQ] = useState(params.get("q") ?? "");
  useEffect(() => {
    const t = window.setTimeout(() => {
      if ((params.get("q") ?? "") === q.trim()) return;
      const p = new URLSearchParams(params); if (q.trim()) p.set("q", q.trim()); else p.delete("q"); p.delete("page");
      setParams(p, { replace: true, preventScrollReset: true });
    }, 350);
    return () => window.clearTimeout(t);
  }, [q]); // eslint-disable-line react-hooks/exhaustive-deps
  const setParam = (k: string, v: string | null) => { const p = new URLSearchParams(params); if (v) p.set(k, v); else p.delete(k); if (k !== "page") p.delete("page"); setParams(p, { preventScrollReset: true }); setSel(new Set()); };

  if (!allowed) return <EmptyState title="Files come with Growpefy Store">Upload photos, videos and documents once your website runs on Growpefy Store.</EmptyState>;
  if (!data) return null;
  const files = data.files;
  const allSel = files.length > 0 && files.every((f) => sel.has(f.id));
  const toggle = (id: number) => setSel((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const tabs: { id: FileKind | null; label: string; n: number }[] = [
    { id: null, label: "All", n: data.counts.all }, { id: "image", label: "Images", n: data.counts.image },
    { id: "video", label: "Videos", n: data.counts.video }, { id: "document", label: "Documents", n: data.counts.document },
  ];

  return (
    <div className="space-y-3">
      <style>{CSS}</style>
      {!ready && <Notice tone="warning">File storage isn't switched on for Growpefy yet, so uploads won't work. Please tell the Growpefy team.</Notice>}

      <section className="panel overflow-hidden p-0">
        {/* toolbar */}
        <div className="flex flex-wrap items-center gap-2 border-b border-rule px-3 py-2.5 sm:px-4">
          <div className="flex items-center gap-0.5 rounded-lg bg-black/[.04] p-0.5">
            {tabs.map((t) => (
              <button key={t.label} type="button" onClick={() => setParam("type", t.id)}
                className={`rounded-md px-2.5 py-1 text-[12.5px] font-medium transition ${data.kind === t.id ? "bg-white text-ink shadow-[0_1px_2px_rgba(0,0,0,.12)]" : "text-ink-soft hover:text-ink"}`}>
                {t.label} <span className="num text-ink-faint">{t.n}</span>
              </button>
            ))}
          </div>
          <label className="relative ml-auto min-w-[160px] flex-1 sm:max-w-[260px]">
            <Icon name="search" className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-faint" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search files" className="input h-8 py-0 pl-8 text-[13px]" aria-label="Search files" />
          </label>
          <select value={data.sort} onChange={(e) => setParam("sort", e.target.value === "newest" ? null : e.target.value)} className="input h-8 w-auto py-0 pr-8 text-[12.5px]" aria-label="Sort">
            <option value="newest">Newest first</option><option value="oldest">Oldest first</option><option value="name">Name A–Z</option><option value="size">Largest first</option>
          </select>
          <div className="flex rounded-lg shadow-[inset_0_0_0_1px_#e3e3e3]">
            {(["grid", "list"] as const).map((v) => (
              <button key={v} type="button" onClick={() => setViewSaved(v)} aria-label={v === "grid" ? "Grid view" : "List view"} aria-pressed={view === v}
                className={`flex h-8 w-8 items-center justify-center first:rounded-l-lg last:rounded-r-lg ${view === v ? "bg-black/[.06] text-ink" : "text-ink-faint hover:text-ink"}`}>
                <Icon name={v === "grid" ? "layers" : "menu"} className="h-3.5 w-3.5" />
              </button>
            ))}
          </div>
          <button type="button" className="btn-primary btn h-8" onClick={() => input.current?.click()} disabled={!ready}><Icon name="plus" className="h-3.5 w-3.5" />Upload files</button>
          <input ref={input} type="file" multiple accept={ACCEPT} hidden onChange={(e) => { if (e.target.files) void upload(e.target.files); e.target.value = ""; }} />
        </div>

        {/* bulk bar */}
        {sel.size > 0 && (
          <div className="fl-in flex items-center gap-3 border-b border-rule bg-[#f6f6f7] px-4 py-2 text-[12.5px]">
            <label className="flex items-center gap-2"><input type="checkbox" checked={allSel} onChange={() => setSel(allSel ? new Set() : new Set(files.map((f) => f.id)))} className="h-4 w-4" />{sel.size} selected</label>
            <button type="button" className="font-medium text-[#005bd3] hover:underline" onClick={() => copy(files.filter((f) => sel.has(f.id)).map((f) => f.url).join("\n"), "Links copied")}>Copy links</button>
            <button type="button" className="font-medium text-bad hover:underline" onClick={() => setConfirmIds([...sel])}>Delete</button>
            <button type="button" className="ml-auto text-ink-soft hover:text-ink" onClick={() => setSel(new Set())}>Clear</button>
          </div>
        )}

        {/* uploads in progress */}
        {ups.length > 0 && (
          <ul className="divide-y divide-rule border-b border-rule">
            {ups.map((u) => (
              <li key={u.id} className="fl-in flex items-center gap-3 px-4 py-2 text-[12.5px]">
                <Icon name={u.error ? "alert" : u.done ? "check" : "download"} className={`h-3.5 w-3.5 shrink-0 ${u.error ? "text-bad" : u.done ? "text-[#1f8f5f]" : "rotate-180 text-ink-faint"}`} />
                <span className="min-w-0 flex-1 truncate">{u.name}</span>
                {u.error ? <span className="truncate text-bad">{u.error}</span> : (
                  <span className="flex w-40 items-center gap-2"><span className="h-1.5 flex-1 overflow-hidden rounded-full bg-black/[.06]"><span className="block h-full rounded-full bg-[#1f8f5f] transition-[width] duration-300" style={{ width: `${u.pct}%` }} /></span><span className="num w-8 text-right text-ink-faint">{u.pct}%</span></span>
                )}
              </li>
            ))}
          </ul>
        )}

        {/* files */}
        {files.length === 0 ? (
          <button type="button" onClick={() => input.current?.click()} disabled={!ready} className="flex w-full flex-col items-center gap-2 px-6 py-14 text-center hover:bg-black/[.015]">
            <span className="flex h-12 w-12 items-center justify-center rounded-full bg-pine-tint text-pine"><Icon name="download" className="h-5 w-5 rotate-180" /></span>
            <span className="text-[14px] font-semibold">{data.q || data.kind ? "No files match" : "Upload your first files"}</span>
            <span className="max-w-sm text-[12.5px] text-ink-faint">{data.q || data.kind ? "Try another search or filter." : "Drag and drop photos, videos or documents here, or click to choose. Photos up to 15 MB, videos up to 150 MB, documents up to 20 MB."}</span>
          </button>
        ) : view === "grid" ? (
          <ul className="grid grid-cols-2 gap-3 p-3 sm:grid-cols-3 sm:p-4 md:grid-cols-4 xl:grid-cols-6">
            {files.map((f) => (
              <li key={f.id} className={`fl-card group relative overflow-hidden rounded-xl border bg-white ${sel.has(f.id) ? "border-[#005bd3] ring-2 ring-[#005bd3]/20" : "border-rule hover:border-black/20"}`}>
                <button type="button" onClick={() => setOpen(f)} className="block w-full text-left">
                  <Thumb f={f} className="aspect-square w-full" />
                  <span className="block px-2.5 pb-2 pt-1.5"><span className="block truncate text-[12.5px] font-medium">{f.name}</span><span className="block text-[11px] text-ink-faint">{ext(f.name, f.mime)} · {size(f.bytes)}</span></span>
                </button>
                <input type="checkbox" checked={sel.has(f.id)} onChange={() => toggle(f.id)} aria-label={`Select ${f.name}`}
                  className={`absolute left-2 top-2 h-4 w-4 cursor-pointer transition ${sel.size ? "opacity-100" : "opacity-0 group-hover:opacity-100 focus:opacity-100"}`} />
                <button type="button" onClick={() => copy(f.url)} title="Copy link" className="absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-lg bg-white/95 text-ink-soft opacity-0 shadow-[0_1px_3px_rgba(0,0,0,.18)] transition hover:text-ink group-hover:opacity-100">
                  <Icon name="external" className="h-3.5 w-3.5" />
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <div className="overflow-x-auto">
            <table className="table min-w-[640px]">
              <thead><tr>
                <th className="w-8"><input type="checkbox" checked={allSel} onChange={() => setSel(allSel ? new Set() : new Set(files.map((f) => f.id)))} className="h-4 w-4" aria-label="Select all" /></th>
                <th>File</th><th>Alt text</th><th>Date added</th><th className="text-right">Size</th><th className="w-24" />
              </tr></thead>
              <tbody>
                {files.map((f) => (
                  <tr key={f.id} className="fl-in cursor-pointer hover:bg-black/[.015]" onClick={() => setOpen(f)}>
                    <td onClick={(e) => e.stopPropagation()}><input type="checkbox" checked={sel.has(f.id)} onChange={() => toggle(f.id)} className="h-4 w-4" aria-label={`Select ${f.name}`} /></td>
                    <td><div className="flex items-center gap-3"><Thumb f={f} className="h-10 w-10 shrink-0 rounded-md border border-rule" small /><div className="min-w-0"><p className="truncate text-[13px] font-medium">{f.name}</p><p className="text-[11.5px] text-ink-faint">{ext(f.name, f.mime)}{f.width && f.height ? ` · ${f.width}×${f.height}` : ""}</p></div></div></td>
                    <td className="max-w-[200px] truncate text-[12.5px] text-ink-soft">{f.alt || <span className="text-ink-faint">—</span>}</td>
                    <td className="text-[12.5px] text-ink-soft">{day(f.createdAt)}</td>
                    <td className="num text-right text-[12.5px] text-ink-soft">{size(f.bytes)}</td>
                    <td className="text-right" onClick={(e) => e.stopPropagation()}><button type="button" onClick={() => copy(f.url)} className="btn-secondary btn h-7 px-2 text-[12px]">Copy link</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* footer */}
        <div className="flex flex-wrap items-center gap-3 border-t border-rule px-4 py-2.5 text-[12px] text-ink-faint">
          <span>{data.counts.all.toLocaleString("en-IN")} file{data.counts.all === 1 ? "" : "s"} · {size(data.storageBytes)} used</span>
          <span className="hidden sm:inline">Tip: drag files anywhere on this page to upload.</span>
          {(data.page > 1 || data.hasMore) && (
            <span className="ml-auto flex items-center gap-1">
              <button type="button" disabled={data.page <= 1} onClick={() => setParam("page", String(data.page - 1))} className="btn-secondary btn h-7 px-2 disabled:opacity-40" aria-label="Previous page"><Icon name="chevron" className="h-3.5 w-3.5 rotate-90" /></button>
              <span className="num px-1">Page {data.page}</span>
              <button type="button" disabled={!data.hasMore} onClick={() => setParam("page", String(data.page + 1))} className="btn-secondary btn h-7 px-2 disabled:opacity-40" aria-label="Next page"><Icon name="chevron" className="h-3.5 w-3.5 -rotate-90" /></button>
            </span>
          )}
        </div>
      </section>

      {open && <Details key={open.id} f={files.find((x) => x.id === open.id) ?? open} onClose={() => setOpen(null)} onCopy={copy} onDelete={() => setConfirmIds([open.id])} />}

      {confirmIds && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/30 p-4" onClick={() => setConfirmIds(null)}>
          <div className="fl-pop w-full max-w-sm rounded-2xl bg-white p-5 shadow-2xl" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
            <h3 className="text-[15px] font-semibold">Delete {confirmIds.length === 1 ? "this file" : `${confirmIds.length} files`}?</h3>
            <p className="mt-1.5 text-[13px] text-ink-soft">If {confirmIds.length === 1 ? "it's" : "they're"} used on your website (products, banners, pages), {confirmIds.length === 1 ? "it" : "they"} will stop showing there. This can't be undone.</p>
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" className="btn-secondary btn" onClick={() => setConfirmIds(null)}>Cancel</button>
              <button type="button" className="btn btn-primary !bg-[#c5280c] hover:!bg-[#a52109]" disabled={del.state !== "idle"}
                onClick={() => { del.submit({ intent: "delete", ids: confirmIds.join(",") }, { method: "post" }); setConfirmIds(null); }}>Delete</button>
            </div>
          </div>
        </div>
      )}

      {drag && (
        <div className="pointer-events-none fixed inset-0 z-[70] flex items-center justify-center bg-[#0b5d4b]/10 p-6 backdrop-blur-[1px]">
          <div className="fl-pop flex flex-col items-center gap-2 rounded-2xl border-2 border-dashed border-pine bg-white/95 px-10 py-8 text-center shadow-xl">
            <Icon name="download" className="h-7 w-7 rotate-180 text-pine" />
            <p className="text-[15px] font-semibold">Drop files to upload</p>
            <p className="text-[12px] text-ink-faint">Photos, videos and documents</p>
          </div>
        </div>
      )}

      {toast && <div className="fl-pop fixed bottom-6 left-1/2 z-[80] -translate-x-1/2 rounded-lg bg-[#1a1a1a] px-3.5 py-2 text-[13px] font-medium text-white shadow-lg" role="status">{toast}</div>}
    </div>
  );
}

function Thumb({ f, className = "", small }: { f: F; className?: string; small?: boolean }) {
  if (f.kind === "image") return <span className={`block overflow-hidden bg-[repeating-conic-gradient(#f1f1f1_0_25%,#fff_0_50%)] bg-[length:16px_16px] ${className}`}><img src={f.url} alt={f.alt || f.name} loading="lazy" decoding="async" className="h-full w-full object-contain" /></span>;
  if (f.kind === "video") return (
    <span className={`relative flex items-center justify-center overflow-hidden bg-[#111] ${className}`}>
      {!small && <video src={`${f.url}#t=0.5`} preload="metadata" muted playsInline className="h-full w-full object-cover opacity-90" />}
      <span className="absolute flex h-7 w-7 items-center justify-center rounded-full bg-white/90 text-[#111] shadow"><svg viewBox="0 0 20 20" className="ml-0.5 h-3 w-3" fill="currentColor"><path d="M6 4l10 6-10 6z" /></svg></span>
    </span>
  );
  return (
    <span className={`flex flex-col items-center justify-center gap-1 bg-[#f6f6f7] text-ink-soft ${className}`}>
      <Icon name="book" className={small ? "h-4 w-4" : "h-7 w-7"} />
      {!small && <span className="rounded bg-white px-1.5 py-px text-[10px] font-semibold tracking-wide shadow-[0_0_0_1px_#e3e3e3]">{ext(f.name, f.mime)}</span>}
    </span>
  );
}

function Details({ f, onClose, onCopy, onDelete }: { f: F; onClose: () => void; onCopy: (t: string, w?: string) => void; onDelete: () => void }) {
  const save = useFetcher<{ ok: boolean; error?: string }>();
  const usage = useFetcher<{ ok: boolean; usage?: { kind: string; title: string }[] }>();
  const [name, setName] = useState(f.name);
  const [alt, setAlt] = useState(f.alt);
  const dirty = name.trim() !== f.name || alt.trim() !== f.alt;
  useEffect(() => { usage.submit({ intent: "usage", id: String(f.id) }, { method: "post" }); }, [f.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); }; window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k); }, [onClose]);
  const used = usage.data?.usage;
  const rows = useMemo(() => [
    ["Type", `${ext(f.name, f.mime)} ${f.kind === "image" ? "image" : f.kind === "video" ? "video" : "file"}`],
    ["Size", size(f.bytes)],
    ...(f.width && f.height ? [["Dimensions", `${f.width} × ${f.height} px`]] : []),
    ["Added", `${day(f.createdAt)}${f.by ? ` by ${f.by}` : ""}`],
  ], [f]);

  return (
    <div className="fixed inset-0 z-[55] flex justify-end bg-black/20" onClick={onClose}>
      <aside className="fl-slide flex h-full w-full max-w-[420px] flex-col overflow-y-auto bg-white shadow-2xl" onClick={(e) => e.stopPropagation()} aria-label="File details">
        <div className="flex items-center gap-2 border-b border-rule px-4 py-3">
          <h2 className="min-w-0 flex-1 truncate text-[14px] font-semibold">{f.name}</h2>
          <button type="button" onClick={onClose} className="flex h-7 w-7 items-center justify-center rounded-lg text-ink-soft hover:bg-black/5" aria-label="Close"><Icon name="close" className="h-4 w-4" /></button>
        </div>
        <div className="border-b border-rule bg-[#f6f6f7] p-4">
          {f.kind === "image" ? <img src={f.url} alt={f.alt || f.name} className="mx-auto max-h-[300px] rounded-lg object-contain" />
            : f.kind === "video" ? <video src={f.url} controls playsInline className="mx-auto max-h-[300px] rounded-lg bg-black" />
            : <Thumb f={f} className="mx-auto h-40 w-40 rounded-xl" />}
        </div>
        <div className="space-y-4 p-4">
          <div>
            <span className="label">Link</span>
            <div className="mt-1 flex gap-2"><input readOnly value={f.url} onFocus={(e) => e.currentTarget.select()} className="input h-8 min-w-0 flex-1 py-0 text-[12px] text-ink-soft" /><button type="button" className="btn-secondary btn h-8 shrink-0" onClick={() => onCopy(f.url)}>Copy</button></div>
          </div>
          <save.Form method="post" className="space-y-3">
            <input type="hidden" name="intent" value="update" /><input type="hidden" name="id" value={f.id} />
            <label className="block"><span className="label">File name</span><input name="name" value={name} onChange={(e) => setName(e.target.value)} className="input mt-1 h-8 py-0 text-[13px]" maxLength={160} /></label>
            {f.kind !== "document" && <label className="block"><span className="label">Alt text</span><textarea name="alt" value={alt} onChange={(e) => setAlt(e.target.value)} rows={2} maxLength={300} placeholder="Describe the photo for Google and screen readers" className="input mt-1 text-[13px]" /></label>}
            <div className="flex items-center justify-end gap-2">
              {save.data?.ok && save.state === "idle" && !dirty && <span className="text-[12px] text-[#1f8f5f]">Saved</span>}
              {save.data?.error && <span className="text-[12px] text-bad">{save.data.error}</span>}
              <button type="submit" className="btn-primary btn h-8" disabled={!dirty || save.state !== "idle"}>{save.state !== "idle" ? "Saving…" : "Save"}</button>
            </div>
          </save.Form>
          <dl className="divide-y divide-rule rounded-xl border border-rule text-[12.5px]">
            {rows.map(([k, v]) => <div key={k} className="flex justify-between gap-3 px-3 py-2"><dt className="text-ink-faint">{k}</dt><dd className="text-right">{v}</dd></div>)}
          </dl>
          <div>
            <span className="label">Used on your store</span>
            {!used ? <p className="mt-1 text-[12.5px] text-ink-faint">Checking…</p>
              : used.length ? <ul className="mt-1.5 space-y-1">{used.map((u, i) => <li key={i} className="flex items-center gap-2 text-[12.5px]"><span className="rounded bg-black/[.05] px-1.5 py-px text-[11px] text-ink-soft">{u.kind}</span><span className="truncate">{u.title}</span></li>)}</ul>
              : <p className="mt-1 text-[12.5px] text-ink-faint">Not used on your website yet.</p>}
          </div>
          <div className="flex items-center gap-2 border-t border-rule pt-4">
            <a href={f.url} target="_blank" rel="noreferrer" className="btn-secondary btn h-8"><Icon name="external" className="h-3.5 w-3.5" />Open</a>
            <button type="button" onClick={onDelete} className="btn h-8 ml-auto text-bad hover:bg-red-50"><Icon name="trash" className="h-3.5 w-3.5" />Delete</button>
          </div>
        </div>
      </aside>
    </div>
  );
}

const CSS = `
@keyframes fl-in { from { opacity: 0; transform: translateY(-4px) } to { opacity: 1; transform: none } }
@keyframes fl-pop { from { opacity: 0; transform: scale(.96) } to { opacity: 1; transform: none } }
@keyframes fl-slide { from { transform: translateX(24px); opacity: .4 } to { transform: none; opacity: 1 } }
@keyframes fl-card { from { opacity: 0; transform: scale(.97) } to { opacity: 1; transform: none } }
.fl-in { animation: fl-in .25s ease-out both }
.fl-pop { animation: fl-pop .18s ease-out both }
.fl-slide { animation: fl-slide .22s cubic-bezier(.2,.7,.2,1) both }
.fl-card { animation: fl-card .25s ease-out both }
@media (prefers-reduced-motion: reduce) { .fl-in, .fl-pop, .fl-slide, .fl-card { animation: none } }
`;
