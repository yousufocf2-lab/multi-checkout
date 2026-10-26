// Growpefy's own sales leads (Super admin → Leads): Meta Instant Form leads + website callbacks + signups,
// with follow-up status, notes and demo bookings.
import { and, desc, eq, gte, inArray, isNotNull, lte, ne, or, sql } from "drizzle-orm";
import { callbackRequests, db, leadCrm, metaLeads, stores, users, type LeadNote } from "~/db.server";
import { sourceGroup, touchSummary, type Attribution } from "./attribution";
import { getMarketing, saveMarketing } from "./marketing.server";
import { scrubToken } from "./meta.server";
import { reasonLabel } from "./support";
import { profileFacts } from "./clients";
import { DEMO_MINUTES, demoLabel, isLeadStatus, slotsClash, type LeadKind, type SourceTag } from "./leads";

const META_VERSION = () => process.env.META_API_VERSION || "v23.0";
const phone10 = (v: string | null | undefined) => {
  const d = String(v ?? "").replace(/\D/g, "");
  const t = d.length === 12 && d.startsWith("91") ? d.slice(2) : d.length === 11 && d.startsWith("0") ? d.slice(1) : d;
  return /^\d{10}$/.test(t) ? t : d || null;
};

// ---------------- Meta lead forms ----------------

type Json = Record<string, unknown>;
async function graph<T = Json>(path: string, token: string, params: Record<string, string> = {}): Promise<T> {
  const qs = new URLSearchParams({ ...params, access_token: token });
  let res: Response;
  try { res = await fetch(`https://graph.facebook.com/${META_VERSION()}/${path}?${qs}`, { signal: AbortSignal.timeout(15_000) }); }
  catch { throw new Error("Couldn't reach Meta. Try again in a moment."); }
  const body = (await res.json().catch(() => ({}))) as Json & { error?: { message?: string; code?: number } };
  if (!res.ok || body.error) {
    const code = body.error?.code;
    if (code === 190) throw new Error("The Meta token has expired. Paste a new one in Growpefy marketing.");
    if (code === 200 || code === 10 || code === 100) throw new Error(`Meta: ${scrubToken(body.error?.message ?? "permission missing")}. The token needs leads_retrieval and pages_manage_ads / pages_read_engagement, and the system user needs the Page assigned.`);
    throw new Error(scrubToken(body.error?.message ?? `Meta API ${res.status}`));
  }
  return body as T;
}

async function graphAll<T = Json>(path: string, token: string, params: Record<string, string>, maxPages = 10) {
  const out: T[] = [];
  let page = await graph<{ data?: T[]; paging?: { next?: string } }>(path, token, params);
  out.push(...(page.data ?? []));
  for (let i = 1; i < maxPages && page.paging?.next; i++) {
    const res = await fetch(page.paging.next, { signal: AbortSignal.timeout(15_000) }).catch(() => null);
    if (!res?.ok) break;
    page = (await res.json()) as typeof page;
    out.push(...(page.data ?? []));
  }
  return out;
}

const NAME_KEYS = ["full_name", "name", "first_name"];
const PHONE_KEYS = ["phone_number", "phone", "mobile_number"];
const EMAIL_KEYS = ["email", "work_email"];

let lastSync = 0;
let lastSyncError: string | null = null;

/** Pulls new Instant Form leads from Growpefy's Page. Runs at most every 2 minutes unless forced. */
export async function syncMetaLeads(force = false): Promise<{ added: number; error: string | null; page: string | null }> {
  const m = await getMarketing();
  if (!m.metaAccessToken) return { added: 0, error: null, page: null };
  if (!force && Date.now() - lastSync < 2 * 60_000) return { added: 0, error: lastSyncError, page: m.metaPageName ?? null };
  lastSync = Date.now();
  try {
    const pages = await graphAll<{ id: string; name: string; access_token?: string }>("me/accounts", m.metaAccessToken, { fields: "id,name,access_token", limit: "50" }, 2);
    const page = pages.find((p) => p.id === m.metaPageId) ?? pages.find((p) => /growpefy/i.test(p.name)) ?? pages[0];
    if (!page) throw new Error("No Facebook Page is assigned to the Meta system user. Assign the Growpefy Page to it in Business settings.");
    if (page.id !== m.metaPageId) await saveMarketing({ metaPageId: page.id, metaPageName: page.name });
    const token = page.access_token || m.metaAccessToken;
    const forms = await graphAll<{ id: string; name: string; questions?: { key: string; label?: string }[] }>(`${page.id}/leadgen_forms`, token, { fields: "id,name,questions{key,label}", limit: "50" }, 3);
    const [latest] = await db.select({ at: sql<Date | null>`max(${metaLeads.createdAt})` }).from(metaLeads);
    const since = latest?.at ? Math.floor(new Date(latest.at).getTime() / 1000) - 3600 : 0;
    let added = 0;
    for (const f of forms) {
      const label = new Map((f.questions ?? []).map((q) => [q.key, q.label ?? q.key]));
      const params: Record<string, string> = { fields: "id,created_time,field_data,ad_name,campaign_name,platform", limit: "100" };
      if (since) params.filtering = JSON.stringify([{ field: "time_created", operator: "GREATER_THAN", value: since }]);
      const leads = await graphAll<{ id: string; created_time: string; ad_name?: string; campaign_name?: string; platform?: string; field_data?: { name: string; values?: string[] }[] }>(`${f.id}/leads`, token, params, 10);
      if (!leads.length) continue;
      const rows = leads.map((l) => {
        const fd = l.field_data ?? [];
        const pick = (keys: string[]) => fd.find((x) => keys.includes(x.name))?.values?.[0] ?? null;
        const answers = fd.filter((x) => ![...NAME_KEYS, ...PHONE_KEYS, ...EMAIL_KEYS].includes(x.name))
          .map((x) => ({ q: label.get(x.name) ?? x.name.replace(/_/g, " "), a: (x.values ?? []).join(", ") }));
        return {
          id: l.id, formId: f.id, formName: f.name, adName: l.ad_name ?? null, campaignName: l.campaign_name ?? null, platform: l.platform ?? null,
          name: pick(NAME_KEYS), phone: phone10(pick(PHONE_KEYS)), email: pick(EMAIL_KEYS), answers, createdAt: new Date(l.created_time),
        };
      });
      const ins = await db.insert(metaLeads).values(rows).onConflictDoNothing().returning({ id: metaLeads.id });
      added += ins.length;
    }
    lastSyncError = null;
    return { added, error: null, page: page.name };
  } catch (e) {
    lastSyncError = e instanceof Error ? e.message : String(e);
    return { added: 0, error: lastSyncError, page: m.metaPageName ?? null };
  }
}

// ---------------- unified list ----------------

export type LeadItem = {
  key: string; kind: LeadKind; id: string;
  name: string; phone: string | null; email: string | null;
  source: SourceTag; via: string; detail: string;
  createdAt: string;
  status: string; demoAt: string | null; notesCount: number; lastNote: string | null;
  lastBy: string | null; lastAt: string | null; // who last worked on it, and when
  stores: number | null; signedUp: boolean;
};

export const tagOf = (a: Attribution | null | undefined): SourceTag => {
  const g = sourceGroup(a?.channel);
  return g === "google" ? "google" : g === "meta" ? "meta" : g === "organic" ? "organic" : g === "other" || g === "other_ads" ? "other" : "direct";
};

/** Store counts for owners, matched by user id or phone. */
async function ownerStores() {
  const rows = await db.select({ id: users.id, phone: users.phone, n: sql<number>`(select count(*)::int from ${stores} where ${stores.ownerId} = ${users.id})` }).from(users);
  return { byId: new Map(rows.map((r) => [r.id, Number(r.n)])), byPhone: new Map(rows.filter((r) => r.phone).map((r) => [r.phone!, { id: r.id, n: Number(r.n) }])) };
}

export async function listLeads(limit = 400): Promise<LeadItem[]> {
  const [meta, cbs, sus, crm, owners] = await Promise.all([
    db.select().from(metaLeads).orderBy(desc(metaLeads.createdAt)).limit(limit),
    db.select().from(callbackRequests).where(eq(callbackRequests.source, "website")).orderBy(desc(callbackRequests.createdAt)).limit(limit),
    db.select({ id: users.id, name: users.name, phone: users.phone, email: users.email, kycStatus: users.kycStatus, attribution: users.attribution, createdAt: users.createdAt }).from(users).orderBy(desc(users.createdAt)).limit(limit),
    db.select().from(leadCrm),
    ownerStores(),
  ]);
  const crmBy = new Map(crm.map((c) => [`${c.kind}-${c.refId}`, c]));
  const withCrm = (base: Omit<LeadItem, "status" | "demoAt" | "notesCount" | "lastNote" | "lastBy" | "lastAt" | "stores" | "signedUp">, userId?: number | null): LeadItem => {
    const c = crmBy.get(base.key);
    const owner = userId ? { n: owners.byId.get(userId) ?? 0 } : base.phone ? owners.byPhone.get(base.phone) : undefined;
    return {
      ...base,
      status: c?.status ?? "new", demoAt: c?.demoAt?.toISOString() ?? null,
      notesCount: c?.notes.length ?? 0, lastNote: [...(c?.notes ?? [])].reverse().find((x) => x.text)?.text ?? null,
      lastBy: c?.notes.at(-1)?.by ?? null, lastAt: c?.notes.at(-1)?.at ?? null,
      stores: owner ? owner.n : c?.storesCount ?? null, signedUp: Boolean(owner),
    };
  };
  const items: LeadItem[] = [
    ...meta.map((l) => withCrm({
      key: `meta-${l.id}`, kind: "meta", id: l.id, name: l.name ?? "Meta lead", phone: l.phone, email: l.email,
      source: "meta", via: [l.campaignName, l.adName].filter(Boolean).join(" · ") || "Instant form", detail: l.formName ?? "Lead form",
      createdAt: l.createdAt.toISOString(),
    })),
    ...cbs.map((c) => withCrm({
      key: `callback-${c.id}`, kind: "callback", id: String(c.id), name: c.name, phone: c.phone, email: c.email,
      source: tagOf(c.attribution), via: touchSummary(c.attribution?.last ?? c.attribution?.first) || "Website", detail: reasonLabel(c.reason),
      createdAt: c.createdAt.toISOString(),
    })),
    ...sus.map((u) => withCrm({
      key: `signup-${u.id}`, kind: "signup", id: String(u.id), name: u.name, phone: u.phone, email: u.email,
      source: tagOf(u.attribution), via: touchSummary(u.attribution?.last ?? u.attribution?.first) || "Website", detail: u.kycStatus === "pending" ? "Signed up · KYC pending" : `Signed up · KYC ${u.kycStatus}`,
      createdAt: u.createdAt.toISOString(),
    }, u.id)),
  ];
  return items.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

// ---------------- one lead ----------------

export async function getLead(kind: LeadKind, id: string) {
  const [c] = await db.select().from(leadCrm).where(and(eq(leadCrm.kind, kind), eq(leadCrm.refId, id))).limit(1);
  const owners = await ownerStores();
  if (kind === "meta") {
    const [l] = await db.select().from(metaLeads).where(eq(metaLeads.id, id)).limit(1);
    if (!l) return null;
    const owner = l.phone ? owners.byPhone.get(l.phone) : undefined;
    return {
      kind, id, name: l.name ?? "Meta lead", phone: l.phone, email: l.email, source: "meta" as SourceTag,
      createdAt: l.createdAt.toISOString(),
      facts: [["Form", l.formName], ["Campaign", l.campaignName], ["Ad", l.adName], ["Platform", l.platform === "ig" ? "Instagram" : l.platform === "fb" ? "Facebook" : l.platform]].filter((x) => x[1]) as [string, string][],
      answers: l.answers, crm: c ?? null, owner: owner ?? null,
    };
  }
  if (kind === "callback") {
    const n = Number(id);
    if (!Number.isInteger(n)) return null;
    const [r] = await db.select().from(callbackRequests).where(eq(callbackRequests.id, n)).limit(1);
    if (!r) return null;
    const owner = owners.byPhone.get(r.phone);
    const t = r.attribution?.last ?? r.attribution?.first;
    return {
      kind, id, name: r.name, phone: r.phone, email: r.email, source: tagOf(r.attribution), createdAt: r.createdAt.toISOString(),
      facts: [["Reason", reasonLabel(r.reason)], ["Best time", r.preferredTime], ["Came from", touchSummary(t) || "Direct"], ["Landed on", t?.lp ?? null], ["Number", r.phoneVerified ? "Verified with OTP" : "Not verified"]].filter((x) => x[1]) as [string, string][],
      answers: r.message ? [{ q: "Message", a: r.message }] : [], crm: c ?? null, owner: owner ?? null,
    };
  }
  const n = Number(id);
  if (!Number.isInteger(n)) return null;
  const [u] = await db.select().from(users).where(eq(users.id, n)).limit(1);
  if (!u) return null;
  const t = u.attribution?.last ?? u.attribution?.first;
  return {
    kind, id, name: u.name, phone: u.phone, email: u.email, source: tagOf(u.attribution), createdAt: u.createdAt.toISOString(),
    facts: [["Contact person", u.kyc.contactName ?? null], ["KYC", u.kycStatus], ["Came from", touchSummary(t) || "Direct"], ["Landed on", t?.lp ?? null]].filter((x) => x[1]) as [string, string][],
    answers: profileFacts(u.signup).map(([q, a]) => ({ q, a })), crm: c ?? null, owner: { id: u.id, n: owners.byId.get(u.id) ?? 0 },
  };
}

// ---------------- follow-up ----------------

export type LeadUpdate = { status: string; note: string; demoAt: string | null; storesCount: number | null };

/** Saves status / note / demo time. Demo slots must be more than 30 minutes apart. */
export async function updateLead(kind: LeadKind, id: string, u: LeadUpdate, by?: string): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!isLeadStatus(u.status)) return { ok: false, error: "Pick a status" };
  let demoAt: Date | null = null;
  if (u.status === "demo_scheduled") {
    if (!u.demoAt) return { ok: false, error: "Pick the demo date and time" };
    demoAt = new Date(u.demoAt);
    if (Number.isNaN(demoAt.getTime())) return { ok: false, error: "Pick a valid demo date and time" };
    if (demoAt.getTime() < Date.now() - 5 * 60_000) return { ok: false, error: "The demo time is in the past" };
    const others = await db.select({ kind: leadCrm.kind, refId: leadCrm.refId, demoAt: leadCrm.demoAt }).from(leadCrm)
      .where(and(eq(leadCrm.status, "demo_scheduled"), isNotNull(leadCrm.demoAt),
        gte(leadCrm.demoAt, new Date(demoAt.getTime() - DEMO_MINUTES * 60_000)), lte(leadCrm.demoAt, new Date(demoAt.getTime() + DEMO_MINUTES * 60_000)),
        or(ne(leadCrm.kind, kind), ne(leadCrm.refId, id))));
    const clash = others.find((o) => o.demoAt && slotsClash(o.demoAt, demoAt!));
    if (clash) {
      const who = await getLead(clash.kind as LeadKind, clash.refId);
      return { ok: false, error: `Another demo is booked at ${demoLabel(clash.demoAt!.toISOString())}${who ? ` with ${who.name}` : ""}. Each demo takes ${DEMO_MINUTES} minutes; pick a time more than ${DEMO_MINUTES} minutes away.` };
    }
  }
  const [cur] = await db.select().from(leadCrm).where(and(eq(leadCrm.kind, kind), eq(leadCrm.refId, id))).limit(1);
  const note = u.note.trim().slice(0, 1000);
  const changed = !cur || cur.status !== u.status || (demoAt?.getTime() ?? null) !== (cur.demoAt?.getTime() ?? null);
  const notes: LeadNote[] = [...(cur?.notes ?? [])];
  if (note || changed) notes.push({ at: new Date().toISOString(), text: note, status: u.status, demoAt: demoAt?.toISOString() ?? null, ...(by ? { by } : {}) });
  const values = {
    status: u.status, demoAt: u.status === "demo_scheduled" ? demoAt : null,
    storesCount: u.storesCount != null && u.storesCount >= 0 ? Math.min(999, Math.floor(u.storesCount)) : cur?.storesCount ?? null,
    notes: notes.slice(-100), updatedAt: new Date(),
  };
  if (cur) await db.update(leadCrm).set(values).where(eq(leadCrm.id, cur.id));
  else await db.insert(leadCrm).values({ kind, refId: id, ...values });
  // keep the support inbox in step for website callbacks
  if (kind === "callback" && u.status !== "new") {
    const closed = ["customer", "not_interested", "wrong_number"].includes(u.status);
    await db.update(callbackRequests).set({ status: closed ? "closed" : "contacted", handledAt: new Date() }).where(eq(callbackRequests.id, Number(id)));
  }
  return { ok: true };
}

/** Booked demos from now on (and one that is running), soonest first. */
export async function upcomingDemos(limit = 5) {
  const rows = await db.select().from(leadCrm)
    .where(and(eq(leadCrm.status, "demo_scheduled"), gte(leadCrm.demoAt, new Date(Date.now() - DEMO_MINUTES * 60_000))))
    .orderBy(leadCrm.demoAt).limit(limit);
  const out: { key: string; name: string; phone: string | null; demoAt: string }[] = [];
  for (const r of rows) {
    const l = await getLead(r.kind as LeadKind, r.refId);
    out.push({ key: `${r.kind}-${r.refId}`, name: l?.name ?? "Lead", phone: l?.phone ?? null, demoAt: r.demoAt!.toISOString() });
  }
  return out;
}

/** Booked demo times (for the picker to grey out clashing slots). */
export async function bookedSlots(exceptKey?: string) {
  const rows = await db.select({ kind: leadCrm.kind, refId: leadCrm.refId, demoAt: leadCrm.demoAt }).from(leadCrm)
    .where(and(eq(leadCrm.status, "demo_scheduled"), gte(leadCrm.demoAt, new Date(Date.now() - 86_400_000))));
  return rows.filter((r) => r.demoAt && `${r.kind}-${r.refId}` !== exceptKey).map((r) => r.demoAt!.toISOString());
}

export const leadCounts = async () => {
  const [r] = await db.select({ n: sql<number>`count(*)::int` }).from(leadCrm).where(inArray(leadCrm.status, ["demo_scheduled"]));
  return Number(r?.n ?? 0);
};
