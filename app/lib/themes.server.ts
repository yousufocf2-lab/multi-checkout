// Growpefy Store theme editor: a store's own copy of its theme (draft while editing, live after Publish, last 5 versions).
import { eq, sql } from "drizzle-orm";
import { db, storeThemes, type ThemeData, type ThemeSection, type ThemeTemplate, type ThemeVersion } from "~/db.server";
import { defaultThemeData, themeManifest, TEMPLATES } from "./storefront.server";

export const THEME = "swift";
const MAX_BYTES = 400_000;
const KEEP_VERSIONS = 5;

export async function themeRow(storeId: number) {
  const [row] = await db.select().from(storeThemes).where(eq(storeThemes.storeId, storeId)).limit(1);
  return row ?? null;
}

/** What the editor opens: the draft if there is one, else the live design, else the theme's defaults. */
export async function editorState(storeId: number) {
  const row = await themeRow(storeId);
  const data = row?.draft ?? row?.live ?? defaultThemeData(THEME);
  return {
    data: normalize(data),
    hasDraft: Boolean(row?.draft),
    publishedAt: row?.publishedAt?.toISOString() ?? null,
    updatedAt: row?.updatedAt?.toISOString() ?? null,
    history: (row?.history ?? []).map((v, i) => ({ index: i, at: v.at, by: v.by })),
  };
}

const ID_RE = /^[a-z0-9_-]{1,40}$/i;

/** Keeps only what the theme understands: known section types, valid ids, plain JSON settings; the page's main section always stays. */
export function normalize(input: unknown): ThemeData {
  const m = themeManifest(THEME);
  const kinds = new Map(m.sections.map((s) => [s.type, s]));
  const base = m.defaults;
  const src = (input && typeof input === "object" ? input : {}) as Partial<ThemeData>;
  const plain = (v: unknown) => (v && typeof v === "object" && !Array.isArray(v) ? (JSON.parse(JSON.stringify(v)) as Record<string, unknown>) : {});

  const list = (raw: unknown, fallback: ThemeTemplate, allow: (where: string) => boolean): ThemeTemplate => {
    const t = (raw && typeof raw === "object" ? raw : fallback) as ThemeTemplate;
    const sections: Record<string, ThemeSection> = {};
    const order: string[] = [];
    for (const id of Array.isArray(t.order) ? t.order : []) {
      const s = t.sections?.[id];
      if (typeof id !== "string" || !ID_RE.test(id) || !s || sections[id]) continue;
      const kind = kinds.get(String(s.type));
      if (!kind || !allow(kind.where)) continue;
      sections[id] = { type: kind.type, settings: plain(s.settings), ...(s.disabled && kind.where !== "fixed" ? { disabled: true } : {}) };
      order.push(id);
      if (order.length >= 40) break;
    }
    // A product / category / cart / page template keeps its main section
    for (const id of fallback.order) {
      const f = fallback.sections[id];
      if (f && kinds.get(f.type)?.where === "fixed" && !order.some((o) => sections[o].type === f.type)) { sections[id] = { type: f.type, settings: {} }; order.unshift(id); }
    }
    return { sections, order };
  };

  const templates: Record<string, ThemeTemplate> = {};
  for (const t of TEMPLATES) templates[t] = list(src.templates?.[t], base.templates[t], (w) => w === "template" || w === "fixed");
  return {
    settings: { ...base.settings, ...plain(src.settings) },
    templates,
    groups: {
      header: list(src.groups?.header, base.groups.header, (w) => w === "header" || w === "template"),
      footer: list(src.groups?.footer, base.groups.footer, (w) => w === "footer" || w === "template"),
    },
  };
}

export async function saveDraft(storeId: number, input: unknown) {
  const data = normalize(input);
  if (JSON.stringify(data).length > MAX_BYTES) throw new Error("The design is too large to save. Remove some sections or shorten long text.");
  await db.insert(storeThemes).values({ storeId, theme: THEME, draft: data, updatedAt: new Date() })
    .onConflictDoUpdate({ target: storeThemes.storeId, set: { draft: data, updatedAt: new Date() } });
  return data;
}

/** Draft -> live. The previous live design goes into history (newest first, last 5 kept). */
export async function publishDraft(storeId: number, by: string | null) {
  const row = await themeRow(storeId);
  const data = row?.draft ?? row?.live ?? defaultThemeData(THEME);
  const history: ThemeVersion[] = row?.live ? [{ at: (row.publishedAt ?? row.updatedAt).toISOString(), by, data: row.live }, ...(row.history ?? [])].slice(0, KEEP_VERSIONS) : row?.history ?? [];
  const now = new Date();
  await db.insert(storeThemes).values({ storeId, theme: THEME, live: data, draft: null, history, publishedAt: now, updatedAt: now })
    .onConflictDoUpdate({ target: storeThemes.storeId, set: { live: data, draft: null, history, publishedAt: now, updatedAt: now } });
}

export async function discardDraft(storeId: number) {
  await db.update(storeThemes).set({ draft: null, updatedAt: new Date() }).where(eq(storeThemes.storeId, storeId));
}

/** An older version becomes the draft, so it can be checked in the editor before publishing. */
export async function restoreVersion(storeId: number, index: number) {
  const row = await themeRow(storeId);
  const v = row?.history?.[index];
  if (!v) throw new Error("That version no longer exists.");
  await saveDraft(storeId, v.data);
}

/** Real-shopper speed for the last 30 days (75th percentile, like Google's Core Web Vitals) and page views by device. */
export async function vitalsSummary(storeId: number) {
  const q = (from: string, to: string) => db.execute<{ lcp: number | null; inp: number | null; cls: number | null; mobile: number; desktop: number; visitors: number }>(sql`
    select percentile_cont(0.75) within group (order by lcp) as lcp,
           percentile_cont(0.75) within group (order by inp) as inp,
           percentile_cont(0.75) within group (order by cls) as cls,
           count(*) filter (where device = 'mobile')::int as mobile,
           count(*) filter (where device = 'desktop')::int as desktop,
           count(distinct visitor_id)::int as visitors
    from storefront_vitals where store_id = ${storeId} and created_at >= now() - ${from}::interval and created_at < now() - ${to}::interval`);
  const [now, before] = await Promise.all([q("30 days", "0 days"), q("60 days", "30 days")]);
  const a = (now as unknown as { rows?: unknown[] }).rows?.[0] ?? (now as unknown as unknown[])[0];
  const b = (before as unknown as { rows?: unknown[] }).rows?.[0] ?? (before as unknown as unknown[])[0];
  const pick = (r: unknown) => {
    const x = (r ?? {}) as { lcp: number | null; inp: number | null; cls: number | null; mobile: number; desktop: number; visitors: number };
    return { lcp: x.lcp == null ? null : Math.round(Number(x.lcp)), inp: x.inp == null ? null : Math.round(Number(x.inp)), cls: x.cls == null ? null : Math.round(Number(x.cls) * 100) / 100, mobile: Number(x.mobile ?? 0), desktop: Number(x.desktop ?? 0), visitors: Number(x.visitors ?? 0) };
  };
  return { now: pick(a), before: pick(b) };
}
