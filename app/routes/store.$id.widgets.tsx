// Settings → Widgets: add-ons for the store's website. First one: product reviews (stars, photos/videos, approval rules, colours).
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Form, Link, useActionData, useLoaderData } from "@remix-run/react";
import { useState } from "react";
import { and, eq, sql } from "drizzle-orm";
import { Card } from "~/components/settings-ui";
import { Notice, SubmitButton } from "~/components/ui";
import { db, productReviews, stores } from "~/db.server";
import { can, requireStore, requireViewer } from "~/lib/auth.server";
import { storePath } from "~/lib/store-code";
import { reviewSettings, widgetSettings, REVIEW_DEFAULTS, type ReviewSettings } from "~/lib/widgets";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const viewer = await requireViewer(request);
  const store = await requireStore(viewer, params.id);
  if (!can(viewer, "settings")) throw new Response("Not allowed", { status: 403 });
  const [pending] = await db.select({ n: sql<number>`count(*)::int` }).from(productReviews).where(and(eq(productReviews.storeId, store.id), eq(productReviews.status, "pending")));
  return json({ storeId: store.id, reviews: widgetSettings(store.widgetSettings).reviews, pending: Number(pending?.n ?? 0) });
}

export async function action({ request, params }: ActionFunctionArgs) {
  const viewer = await requireViewer(request);
  const store = await requireStore(viewer, params.id);
  if (!can(viewer, "settings")) throw new Response("Not allowed", { status: 403 });
  const fd = await request.formData();
  const on = (k: string) => fd.get(k) === "on";
  const reviews = reviewSettings({
    enabled: on("enabled"), starLight: String(fd.get("starLight") ?? ""), starDark: String(fd.get("starDark") ?? ""),
    textLight: String(fd.get("textLight") ?? ""), textDark: String(fd.get("textDark") ?? ""),
    allowPhotos: on("allowPhotos"), allowVideos: on("allowVideos"), maxVideoSeconds: Number(fd.get("maxVideoSeconds")), maxMedia: Number(fd.get("maxMedia")),
    moderation: String(fd.get("moderation")) as ReviewSettings["moderation"], lowUpTo: Number(fd.get("lowUpTo")), checkMedia: on("checkMedia"),
    showVerified: on("showVerified"), showDate: on("showDate"), showBreakdown: on("showBreakdown"), sort: String(fd.get("sort")) as ReviewSettings["sort"],
  });
  const current = (store.widgetSettings ?? {}) as Record<string, unknown>;
  await db.update(stores).set({ widgetSettings: { ...current, reviews } }).where(eq(stores.id, store.id));
  return json({ ok: "Saved. Your website uses these settings now.", error: null });
}

export default function Widgets() {
  const d = useLoaderData<typeof loader>();
  const a = useActionData<typeof action>();
  const [s, setS] = useState<ReviewSettings>(d.reviews);
  const set = <K extends keyof ReviewSettings>(k: K, v: ReviewSettings[K]) => setS((x) => ({ ...x, [k]: v }));
  const rule = s.moderation === "none" ? "Every review goes live straight away." : s.moderation === "low" ? `Reviews with ${s.lowUpTo === 1 ? "1 star" : `1 to ${s.lowUpTo} stars`} wait for you; higher ratings go live straight away.` : "Every review waits until you approve it.";

  return (
    <Form method="post" className="mx-auto max-w-[820px] space-y-4">
      {a?.ok && <Notice tone="success">{a.ok}</Notice>}

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
