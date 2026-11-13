// Storefront → Product reviews: approve or hide customer reviews, and add real reviews you already have (with photos and videos).
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Form, Link, useActionData, useLoaderData, useNavigation, useSearchParams } from "@remix-run/react";
import { useEffect, useRef, useState } from "react";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { db, catalogItems, productReviews } from "~/db.server";
import { Icon } from "~/components/Icons";
import { Dialog } from "~/components/settings-ui";
import { Notice } from "~/components/ui";
import { can, requireStore, requireViewer } from "~/lib/auth.server";
import { catalogAllowed } from "~/lib/catalog.server";
import { cleanMedia, storeReviewSettings, type ReviewMedia } from "~/lib/reviews.server";
import { storePath } from "~/lib/store-code";

const TABS = [["pending", "Waiting"], ["approved", "Live"], ["rejected", "Hidden"], ["all", "All"]] as const;
type Tab = (typeof TABS)[number][0];

export async function loader({ request, params }: LoaderFunctionArgs) {
  const viewer = await requireViewer(request);
  const store = await requireStore(viewer, params.id);
  if (!catalogAllowed(viewer, store)) throw new Response("Not found", { status: 404 });
  const tab = (new URL(request.url).searchParams.get("tab") ?? "pending") as Tab;
  const where = tab === "all" ? eq(productReviews.storeId, store.id) : and(eq(productReviews.storeId, store.id), eq(productReviews.status, tab));
  const [reviews, counts, products, settings] = await Promise.all([
    db.select({ id: productReviews.id, authorName: productReviews.authorName, email: productReviews.email, rating: productReviews.rating, body: productReviews.body, createdAt: productReviews.createdAt, status: productReviews.status, media: productReviews.media, source: productReviews.source, verified: productReviews.verified, productTitle: catalogItems.title, productHandle: catalogItems.handle })
      .from(productReviews).innerJoin(catalogItems, eq(catalogItems.id, productReviews.productId))
      .where(where).orderBy(desc(productReviews.createdAt)).limit(300),
    db.select({ status: productReviews.status, n: sql<number>`count(*)::int` }).from(productReviews).where(eq(productReviews.storeId, store.id)).groupBy(productReviews.status),
    db.select({ id: catalogItems.id, title: catalogItems.title }).from(catalogItems).where(and(eq(catalogItems.storeId, store.id), eq(catalogItems.status, "active"))).orderBy(asc(catalogItems.title)).limit(1000),
    storeReviewSettings(store.id),
  ]);
  const c = Object.fromEntries(counts.map((r) => [r.status, Number(r.n)])) as Record<string, number>;
  return json({ store: { id: store.id }, tab, reviews, products, enabled: settings.enabled, canSettings: can(viewer, "settings"),
    counts: { pending: c.pending ?? 0, approved: c.approved ?? 0, rejected: c.rejected ?? 0, all: (c.pending ?? 0) + (c.approved ?? 0) + (c.rejected ?? 0) } });
}

export async function action({ request, params }: ActionFunctionArgs) {
  const viewer = await requireViewer(request);
  const store = await requireStore(viewer, params.id);
  if (!catalogAllowed(viewer, store)) throw new Response("Not found", { status: 404 });
  const fd = await request.formData();
  const intent = String(fd.get("intent"));
  if (intent === "add") {
    const productId = Number(fd.get("productId"));
    const [p] = await db.select({ id: catalogItems.id }).from(catalogItems).where(and(eq(catalogItems.storeId, store.id), eq(catalogItems.id, productId))).limit(1);
    const name = String(fd.get("name") ?? "").trim().slice(0, 80);
    const body = String(fd.get("body") ?? "").trim().slice(0, 2000);
    const rating = Number(fd.get("rating"));
    const date = String(fd.get("date") ?? "");
    if (!p) return json({ error: "Choose a product.", ok: null }, { status: 400 });
    if (!name || !body || !Number.isInteger(rating) || rating < 1 || rating > 5) return json({ error: "Add the customer’s name, a rating and the review text.", ok: null }, { status: 400 });
    const when = /^\d{4}-\d{2}-\d{2}$/.test(date) ? new Date(`${date}T12:00:00+05:30`) : new Date();
    const media: ReviewMedia[] = cleanMedia(store.id, String(fd.get("media") ?? "[]"), 8, { photos: true, videos: true });
    await db.insert(productReviews).values({ storeId: store.id, productId: p.id, authorName: name, rating, body, media, source: "owner", verified: fd.get("verified") === "on", status: "approved", createdAt: when > new Date() ? new Date() : when });
    return json({ ok: "Review added and live on your website.", error: null });
  }
  const id = Number(fd.get("id"));
  if (!Number.isInteger(id) || id < 1) throw new Response("Invalid review", { status: 400 });
  const own = and(eq(productReviews.storeId, store.id), eq(productReviews.id, id));
  if (intent === "approve" || intent === "reject") await db.update(productReviews).set({ status: intent === "approve" ? "approved" : "rejected" }).where(own);
  else if (intent === "verify") await db.update(productReviews).set({ verified: fd.get("value") === "1" }).where(own);
  else if (intent === "delete") await db.delete(productReviews).where(own);
  else throw new Response("Invalid review action", { status: 400 });
  return json({ ok: null, error: null });
}

const stars = (n: number) => "★".repeat(n) + "☆".repeat(5 - n);

export default function StoreReviews() {
  const d = useLoaderData<typeof loader>();
  const a = useActionData<typeof action>();
  const [, setParams] = useSearchParams();
  const [adding, setAdding] = useState(false);
  const [view, setView] = useState<ReviewMedia | null>(null);
  const nav = useNavigation();
  useEffect(() => { if (a?.ok && nav.state === "idle") setAdding(false); }, [a, nav.state]);
  return (
    <div className="space-y-3">
      {!d.enabled && <Notice tone="warning">Reviews are switched off on your website. {d.canSettings && <Link to={`${storePath(d.store.id)}/widgets`} className="font-medium underline">Turn them on in Settings → Widgets</Link>}</Notice>}
      {a?.ok && <Notice tone="success">{a.ok}</Notice>}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-1 flex-wrap gap-1">
          {TABS.map(([k, label]) => (
            <button key={k} type="button" onClick={() => setParams(k === "pending" ? {} : { tab: k })} className={`h-8 rounded-lg px-3 text-[13px] ${d.tab === k ? "bg-[#303030] font-medium text-white" : "hover:bg-black/5"}`}>
              {label} <span className={d.tab === k ? "text-white/70" : "text-ink-faint"}>{d.counts[k]}</span>
            </button>
          ))}
        </div>
        {d.canSettings && <Link className="btn-secondary h-8" to={`${storePath(d.store.id)}/widgets`}><Icon name="settings" className="h-4 w-4" />Review settings</Link>}
        <button type="button" className="btn-primary h-8" onClick={() => setAdding(true)}><Icon name="plus" className="h-4 w-4" />Add a review</button>
      </div>

      {!d.reviews.length ? (
        <div className="panel p-8 text-center text-[13px] text-ink-soft">{d.tab === "pending" ? "Nothing waiting. New reviews that need your OK show up here." : "No reviews here yet."}</div>
      ) : d.reviews.map((r) => (
        <article key={r.id} className="panel flex flex-wrap items-start gap-4 p-4">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[12.5px]">
              <span className="text-[15px] tracking-[2px] text-[#15803d]">{stars(r.rating)}</span>
              <b>{r.authorName}</b>
              {r.verified && <span className="rounded bg-[#cdfee1] px-1.5 text-[11px] font-semibold text-[#0c5132]">Verified buyer</span>}
              {r.source === "owner" && <span className="rounded bg-[#eef] px-1.5 text-[11px] text-[#3730a3]">Added by you</span>}
              <span className="text-ink-faint">{new Date(r.createdAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}</span>
              <span className={`rounded px-1.5 text-[11px] font-semibold ${r.status === "approved" ? "bg-[#cdfee1] text-[#0c5132]" : r.status === "pending" ? "bg-[#fff1e3] text-[#5e4200]" : "bg-[#f1f1f1] text-ink-soft"}`}>{r.status === "approved" ? "Live" : r.status === "pending" ? "Waiting" : "Hidden"}</span>
            </div>
            <p className="mt-1 text-[12px] text-ink-soft">on <b className="font-medium text-ink">{r.productTitle}</b>{r.email ? ` · ${r.email}` : ""}</p>
            <p className="mt-2 whitespace-pre-wrap text-[13.5px]">{r.body}</p>
            {r.media.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-2">
                {r.media.map((m) => (
                  <button key={m.url} type="button" onClick={() => setView(m)} className="relative h-16 w-16 overflow-hidden rounded-lg bg-paper">
                    {m.type === "video" ? <><video src={m.url} muted className="h-full w-full object-cover" /><span className="absolute inset-0 flex items-center justify-center text-white">▶</span></> : <img src={m.url} alt="" className="h-full w-full object-cover" />}
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            {r.status !== "approved" && <Act id={r.id} intent="approve" label="Approve" primary />}
            {r.status !== "rejected" && <Act id={r.id} intent="reject" label="Hide" />}
            <Act id={r.id} intent="verify" value={r.verified ? "0" : "1"} label={r.verified ? "Remove verified" : "Mark verified"} />
            <Act id={r.id} intent="delete" label="Delete" danger confirmText="Delete this review for good?" />
          </div>
        </article>
      ))}

      <Dialog open={adding} onClose={() => setAdding(false)} title="Add a review" wide
        footer={<><button type="button" className="btn-secondary btn" onClick={() => setAdding(false)}>Cancel</button><button form="gp-add-review" name="intent" value="add" className="btn-primary btn" disabled={nav.state !== "idle"}>{nav.state !== "idle" ? "Saving" : "Add review"}</button></>}>
        <AddReview storeId={d.store.id} products={d.products} error={a?.error ?? null} />
      </Dialog>

      {view && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4" onClick={() => setView(null)}>
          {view.type === "video" ? <video src={view.url} controls autoPlay className="max-h-[86vh] max-w-full rounded-xl" onClick={(e) => e.stopPropagation()} /> : <img src={view.url} alt="" className="max-h-[86vh] max-w-full rounded-xl" />}
        </div>
      )}
    </div>
  );
}

function Act({ id, intent, label, value, primary, danger, confirmText }: { id: number; intent: string; label: string; value?: string; primary?: boolean; danger?: boolean; confirmText?: string }) {
  return (
    <Form method="post" onSubmit={(e) => { if (confirmText && !confirm(confirmText)) e.preventDefault(); }}>
      <input type="hidden" name="id" value={id} /><input type="hidden" name="intent" value={intent} />{value != null && <input type="hidden" name="value" value={value} />}
      <button className={`${primary ? "btn-primary" : "btn-secondary"} h-8 ${danger ? "text-[#8e1f0b]" : ""}`}>{intent === "approve" && <Icon name="check" className="h-4 w-4" />}{label}</button>
    </Form>
  );
}

function AddReview({ storeId, products, error }: { storeId: number; products: { id: number; title: string }[]; error: string | null }) {
  const [rating, setRating] = useState(5);
  const [media, setMedia] = useState<ReviewMedia[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const file = useRef<HTMLInputElement>(null);
  const upload = async (files: FileList) => {
    setBusy(true); setErr(null);
    for (const f of Array.from(files).slice(0, 8 - media.length)) {
      try {
        const r = await fetch(`${storePath(storeId)}/media`, { method: "POST", headers: { "Content-Type": f.type, "X-File-Name": encodeURIComponent(f.name) }, body: f });
        const j = await r.json();
        if (!r.ok || !j.url) throw new Error(j.error ?? "Upload failed");
        setMedia((m) => [...m, { url: j.url, type: j.type === "video" ? "video" : "image" }]);
      } catch (e) { setErr(e instanceof Error ? e.message : "Upload failed"); }
    }
    setBusy(false);
  };
  return (
    <Form method="post" id="gp-add-review" className="space-y-3">
      {error && <Notice tone="error">{error}</Notice>}
      <p className="text-[12.5px] text-ink-soft">Add genuine reviews you already have, for example from WhatsApp, calls or an old store. They go live straight away.</p>
      <label className="block"><span className="label">Product</span>
        <select name="productId" required className="input w-full" defaultValue=""><option value="" disabled>Choose a product</option>{products.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}</select></label>
      <div>
        <span className="label">Rating</span>
        <div className="flex gap-1">{[1, 2, 3, 4, 5].map((n) => (
          <button key={n} type="button" onClick={() => setRating(n)} className={`text-[28px] leading-none ${n <= rating ? "text-[#15803d]" : "text-[#d4d4d4]"}`} aria-label={`${n} stars`}>★</button>
        ))}</div>
        <input type="hidden" name="rating" value={rating} />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block"><span className="label">Customer name</span><input name="name" required maxLength={80} className="input w-full" placeholder="Rahul S." /></label>
        <label className="block"><span className="label">Date</span><input name="date" type="date" className="input w-full" max={new Date().toISOString().slice(0, 10)} /></label>
      </div>
      <label className="block"><span className="label">Review</span><textarea name="body" required rows={4} maxLength={2000} className="input w-full" placeholder="What the customer said" /></label>
      <div>
        <span className="label">Photos and videos (optional)</span>
        <div className="flex flex-wrap gap-2">
          {media.map((m, i) => (
            <div key={m.url} className="relative h-16 w-16 overflow-hidden rounded-lg bg-paper">
              {m.type === "video" ? <video src={m.url} muted className="h-full w-full object-cover" /> : <img src={m.url} alt="" className="h-full w-full object-cover" />}
              <button type="button" onClick={() => setMedia(media.filter((_, j) => j !== i))} className="absolute right-0.5 top-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-black/60 text-[11px] text-white" aria-label="Remove">✕</button>
            </div>
          ))}
          {media.length < 8 && <button type="button" onClick={() => file.current?.click()} disabled={busy} className="flex h-16 w-16 flex-col items-center justify-center rounded-lg border border-dashed border-[#c9c9c9] text-[11px] text-ink-soft"><Icon name="plus" className="h-4 w-4" />{busy ? "…" : "Add"}</button>}
        </div>
        {err && <p className="mt-1 text-[12px] text-[#8e1f0b]">{err}</p>}
        <input ref={file} type="file" accept="image/*,video/mp4,video/webm,video/quicktime" multiple className="sr-only" onChange={(e) => { if (e.target.files?.length) upload(e.target.files); e.target.value = ""; }} />
        <input type="hidden" name="media" value={JSON.stringify(media)} />
      </div>
      <label className="flex items-center gap-2 text-[13px]"><input type="checkbox" name="verified" defaultChecked /> Show as “Verified buyer”</label>
    </Form>
  );
}
