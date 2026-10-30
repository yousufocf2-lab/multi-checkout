// Welcome WhatsApp + email to Growpefy's own leads (Meta forms, website callbacks) and new signups.
// Messages go into a queue (lead_messages) and a background job sends them, retrying while WhatsApp
// isn't approved yet or a template is still in review.
import { and, desc, eq, gte, inArray, lt, lte, or, sql } from "drizzle-orm";
import { callbackRequests, db, leadMessages, metaLeads, users, type LeadMessage, type WelcomeSettings } from "~/db.server";
import { getMarketing, saveMarketing } from "./marketing.server";
import { messaging } from "./rto.server";
import { syncMetaLeads } from "./leads.server";
import { WELCOME_DEFAULTS, fillName, greetName } from "./welcome";
import { welcomeEmail } from "./welcome-email.server";
import { getPlatform } from "./wallet.server";

/** Message texts from before the designed email (they had their own greeting, steps and sign-off). */
const OLD_BODIES = ["Here's how to go live:", "Our team will call you shortly to understand your store. If you'd like to start right away, create your free account here"];

export async function getWelcome() {
  const w = { ...((await getMarketing()).welcome ?? {}) };
  if (w.leadBody && OLD_BODIES.some((x) => w.leadBody!.includes(x))) delete w.leadBody;
  if (w.signupBody && OLD_BODIES.some((x) => w.signupBody!.includes(x))) delete w.signupBody;
  return { ...WELCOME_DEFAULTS, ...Object.fromEntries(Object.entries(w).filter(([, v]) => v !== undefined && v !== "")) } as typeof WELCOME_DEFAULTS & { autoFrom?: string };
}

export async function saveWelcome(patch: Partial<WelcomeSettings>) {
  const cur = (await getMarketing()).welcome ?? {};
  const next: WelcomeSettings = { ...cur, ...patch };
  // Turning auto-send on starts from now: older leads are only sent when you press "Send to existing leads"
  if (patch.auto && !cur.auto) next.autoFrom = new Date().toISOString();
  await saveMarketing({ welcome: next });
  return next;
}

const emailTestMode = () => process.env.RESEND_API_KEY === "test" || (!process.env.RESEND_API_KEY && process.env.NODE_ENV !== "production");
export const emailReady = () => Boolean(process.env.RESEND_API_KEY);
export async function whatsappReady() {
  const m = await messaging();
  return Boolean(m.waPhoneNumberId && m.waToken);
}

// ---------------- who to send to ----------------

type Person = { msg: "lead" | "signup"; kind: string; refId: string; name: string; phone: string | null; email: string | null; createdAt: Date };
const phone10 = (p: string | null | undefined) => { const d = (p ?? "").replace(/\D/g, "").replace(/^(91|0)(?=\d{10}$)/, ""); return /^[6-9]\d{9}$/.test(d) ? d : null; };
const mail = (e: string | null | undefined) => { const x = (e ?? "").trim().toLowerCase(); return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(x) ? x : null; };

async function people(range: { from?: Date; before?: Date }): Promise<Person[]> {
  const w = (col: typeof metaLeads.createdAt | typeof callbackRequests.createdAt | typeof users.createdAt) =>
    and(range.from ? gte(col, range.from) : undefined, range.before ? lt(col, range.before) : undefined);
  const [m, c, u] = await Promise.all([
    db.select({ id: metaLeads.id, name: metaLeads.name, phone: metaLeads.phone, email: metaLeads.email, at: metaLeads.createdAt }).from(metaLeads).where(w(metaLeads.createdAt)),
    db.select({ id: callbackRequests.id, name: callbackRequests.name, phone: callbackRequests.phone, email: callbackRequests.email, at: callbackRequests.createdAt })
      .from(callbackRequests).where(and(eq(callbackRequests.source, "website"), w(callbackRequests.createdAt))),
    db.select({ id: users.id, name: users.name, kyc: users.kyc, phone: users.phone, email: users.email, at: users.createdAt }).from(users).where(w(users.createdAt)),
  ]);
  return [
    ...m.map((x) => ({ msg: "lead" as const, kind: "meta", refId: x.id, name: x.name ?? "", phone: phone10(x.phone), email: mail(x.email), createdAt: x.at })),
    ...c.map((x) => ({ msg: "lead" as const, kind: "callback", refId: String(x.id), name: x.name, phone: phone10(x.phone), email: mail(x.email), createdAt: x.at })),
    ...u.map((x) => ({ msg: "signup" as const, kind: "signup", refId: String(x.id), name: x.kyc.contactName || x.name, phone: phone10(x.phone ?? x.kyc.phone), email: mail(x.email ?? x.kyc.email), createdAt: x.at })),
  ];
}

function rowsFor(list: Person[], s: Awaited<ReturnType<typeof getWelcome>>) {
  const rows: (typeof leadMessages.$inferInsert)[] = [];
  for (const p of list) {
    if (s.whatsapp && p.phone) rows.push({ msg: p.msg, channel: "whatsapp", target: p.phone, kind: p.kind, refId: p.refId, name: p.name });
    if (s.email && p.email) rows.push({ msg: p.msg, channel: "email", target: p.email, kind: p.kind, refId: p.refId, name: p.name });
  }
  return rows;
}

async function insert(rows: (typeof leadMessages.$inferInsert)[]) {
  let n = 0;
  for (let i = 0; i < rows.length; i += 200) {
    const r = await db.insert(leadMessages).values(rows.slice(i, i + 200)).onConflictDoNothing().returning({ id: leadMessages.id });
    n += r.length;
  }
  return n;
}

/** Queues welcomes for leads and signups that came in after auto-send was switched on. */
export async function queueNew() {
  const s = await getWelcome();
  if (!s.auto || !s.autoFrom) return 0;
  return insert(rowsFor(await people({ from: new Date(s.autoFrom) }), s));
}

/** Leads and signups from before auto-send that haven't had a welcome yet (what "Send to existing" would queue). */
export async function existingNotSent() {
  const s = await getWelcome();
  const before = s.auto && s.autoFrom ? new Date(s.autoFrom) : new Date();
  const rows = rowsFor(await people({ before }), s);
  if (!rows.length) return { rows, whatsapp: 0, email: 0, leads: 0, signups: 0 };
  const done = await db.select({ msg: leadMessages.msg, channel: leadMessages.channel, target: leadMessages.target }).from(leadMessages);
  const seen = new Set(done.map((d) => `${d.msg}|${d.channel}|${d.target}`));
  const fresh: typeof rows = [];
  for (const r of rows) { const k = `${r.msg}|${r.channel}|${r.target}`; if (!seen.has(k)) { seen.add(k); fresh.push(r); } }
  const ppl = new Set(fresh.map((r) => `${r.kind}-${r.refId}`));
  return {
    rows: fresh,
    whatsapp: fresh.filter((r) => r.channel === "whatsapp").length,
    email: fresh.filter((r) => r.channel === "email").length,
    leads: [...ppl].filter((k) => !k.startsWith("signup-")).length,
    signups: [...ppl].filter((k) => k.startsWith("signup-")).length,
  };
}

export async function queueExisting() {
  const { rows } = await existingNotSent();
  return insert(rows);
}

/** Puts failed messages back in the queue (e.g. after the WhatsApp number or a template got approved). */
export async function retryFailed() {
  const r = await db.update(leadMessages).set({ status: "queued", nextAttemptAt: new Date(), attempts: 0, error: null })
    .where(inArray(leadMessages.status, ["failed", "retry"])).returning({ id: leadMessages.id });
  return r.length;
}

// ---------------- sending ----------------

type Result = { ok: true; id: string | null } | { ok: false; retry: boolean; error: string };

async function sendWhatsapp(row: LeadMessage, s: Awaited<ReturnType<typeof getWelcome>>): Promise<Result> {
  const m = await messaging();
  if (!m.waPhoneNumberId || !m.waToken) return { ok: false, retry: true, error: "WhatsApp isn't set up in Messaging settings" };
  const template = row.msg === "lead" ? s.waLeadTemplate : s.waSignupTemplate;
  // A template with an image header must get the image with every message, or WhatsApp rejects it (#132012)
  const img = (row.msg === "lead" ? s.waLeadImage : s.waSignupImage).trim();
  const imageLink = !img || /^none$/i.test(img) ? null
    : img.startsWith("/") ? `${(process.env.APP_URL || "https://growpefy.com").replace(/\/+$/, "")}${img}` : img;
  const components: unknown[] = [{ type: "body", parameters: [{ type: "text", text: greetName(row.name) }] }];
  if (imageLink) components.unshift({ type: "header", parameters: [{ type: "image", image: { link: imageLink } }] });
  const res = await fetch(`https://graph.facebook.com/v21.0/${m.waPhoneNumberId}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${m.waToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      messaging_product: "whatsapp", to: `91${row.target}`, type: "template",
      template: { name: template, language: { code: s.waLang || "en" }, components },
    }),
    signal: AbortSignal.timeout(10_000),
  }).catch((e) => ({ ok: false, status: 0, json: async () => ({ error: { message: e instanceof Error ? e.message : String(e) } }) }) as unknown as Response);
  const body = (await res.json().catch(() => ({}))) as { messages?: { id: string }[]; error?: { message?: string; code?: number } };
  if (res.ok && body.messages?.length) return { ok: true, id: body.messages[0].id };
  const code = body.error?.code;
  const msg = `${code ? `(#${code}) ` : ""}${body.error?.message ?? `WhatsApp error ${res.status}`}`.slice(0, 300);
  // A wrong or non-WhatsApp number won't work later either; anything else (number or template not approved yet,
  // payment, rate limit, network) is worth trying again.
  const permanent = code === 131026 || code === 131021 || code === 100;
  return { ok: false, retry: !permanent, error: msg };
}

/** Subject, HTML and plain text for one welcome email. */
export async function renderWelcome(kind: "lead" | "signup", rawName: string, s?: Awaited<ReturnType<typeof getWelcome>>) {
  s ??= await getWelcome();
  const p = await getPlatform();
  const name = greetName(rawName);
  const subject = fillName(kind === "lead" ? s.leadSubject : s.signupSubject, name).replace(/, there(?=\W*$)/, "");
  const wa = (s.whatsappNumber || p.billing?.phone || "").replace(/\D/g, "");
  const { html, text } = welcomeEmail(kind, rawName, kind === "lead" ? s.leadBody : s.signupBody, {
    baseUrl: (process.env.APP_URL || "https://growpefy.com").replace(/\/+$/, ""),
    fromName: s.fromName || "Growpefy",
    whatsapp: wa ? (wa.length === 10 ? `91${wa}` : wa) : null,
    supportEmail: p.billing?.email || "support@growpefy.com",
    address: p.billing?.address || "",
  });
  return { subject, html, text };
}

async function sendEmail(row: LeadMessage, s: Awaited<ReturnType<typeof getWelcome>>, subjectPrefix = ""): Promise<Result> {
  const { subject: sub, html, text } = await renderWelcome(row.msg, row.name, s);
  const subject = subjectPrefix + sub;
  if (emailTestMode()) { console.log(`[welcome] test mode, email to ${row.target}: ${subject}`); return { ok: true, id: null }; }
  if (!process.env.RESEND_API_KEY) return { ok: false, retry: true, error: "Email isn't set up (RESEND_API_KEY)" };
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: `${(s.fromName || "Growpefy").replace(/[<>"]/g, "")} <${s.fromEmail || "hello@growpefy.com"}>`,
      reply_to: s.replyTo || s.fromEmail || "hello@growpefy.com",
      to: [row.target], subject, text, html,
    }),
    signal: AbortSignal.timeout(10_000),
  }).catch(() => null);
  if (!res) return { ok: false, retry: true, error: "Couldn't reach the email service" };
  const body = (await res.json().catch(() => ({}))) as { id?: string; message?: string };
  if (res.ok) return { ok: true, id: body.id ?? null };
  return { ok: false, retry: res.status >= 500 || res.status === 429, error: `${body.message ?? `Email error ${res.status}`}`.slice(0, 300) };
}

const MAX_ATTEMPTS = 14; // about 3 days of retries with the backoff below
const backoff = (attempts: number) => Math.min(6 * 3600_000, 15 * 60_000 * 2 ** Math.max(0, attempts - 1));

/** Sends what's due. Small batches so a big backlog goes out steadily. */
export async function sendDue(limit = 25) {
  const s = await getWelcome();
  const due = await db.select().from(leadMessages)
    .where(and(inArray(leadMessages.status, ["queued", "retry"]), lte(leadMessages.nextAttemptAt, new Date())))
    .orderBy(leadMessages.nextAttemptAt).limit(limit);
  let sent = 0;
  for (const row of due) {
    // Channel switched off since it was queued
    if ((row.channel === "whatsapp" && !s.whatsapp) || (row.channel === "email" && !s.email)) {
      await db.update(leadMessages).set({ status: "skipped", error: "Channel switched off" }).where(eq(leadMessages.id, row.id));
      continue;
    }
    const r = await (row.channel === "whatsapp" ? sendWhatsapp(row, s) : sendEmail(row, s)).catch((e): Result => ({ ok: false, retry: true, error: e instanceof Error ? e.message : String(e) }));
    const attempts = row.attempts + 1;
    if (r.ok) {
      sent++;
      await db.update(leadMessages).set({ status: "sent", attempts, providerId: r.id, sentAt: new Date(), error: null }).where(eq(leadMessages.id, row.id));
    } else {
      const giveUp = !r.retry || attempts >= MAX_ATTEMPTS;
      await db.update(leadMessages).set({ status: giveUp ? "failed" : "retry", attempts, error: r.error, nextAttemptAt: new Date(Date.now() + backoff(attempts)) }).where(eq(leadMessages.id, row.id));
    }
    if (row.channel === "whatsapp") await new Promise((res) => setTimeout(res, 300)); // gentle on Meta's rate limits
  }
  return { tried: due.length, sent };
}

/** Sends both welcome emails to one address right away (for checking how they look). */
export async function sendTestEmails(to: string) {
  const s = await getWelcome();
  const out: string[] = [];
  for (const msg of ["lead", "signup"] as const) {
    const r = await sendEmail({ id: 0, msg, channel: "email", target: to, kind: "test", refId: "0", name: "Rahul Sharma", status: "queued", attempts: 0, error: null, providerId: null, nextAttemptAt: new Date(), sentAt: null, createdAt: new Date() }, s, "[Test] ");
    out.push(r.ok ? `${msg === "lead" ? "Lead" : "Signup"} email sent` : `${msg === "lead" ? "Lead" : "Signup"} email failed: ${r.error}`);
  }
  return out.join(" · ");
}

// ---------------- background job ----------------

declare global {
  // eslint-disable-next-line no-var
  var __welcomeWatcher: NodeJS.Timeout | undefined;
  // eslint-disable-next-line no-var
  var __welcomeRunning: boolean | undefined;
}

async function tick() {
  if (globalThis.__welcomeRunning) return;
  globalThis.__welcomeRunning = true;
  try {
    const s = await getWelcome();
    if (s.auto) { await syncMetaLeads(); await queueNew(); }
    await sendDue();
  } catch (e) {
    console.error("[welcome] job:", e instanceof Error ? e.message : e);
  } finally {
    globalThis.__welcomeRunning = false;
  }
}

/** Every 2 minutes: pull new Meta leads, queue welcomes, send what's due. */
export function startWelcomeWatcher() {
  if (globalThis.__welcomeWatcher || !process.env.DATABASE_URL) return;
  globalThis.__welcomeWatcher = setInterval(() => void tick(), 2 * 60_000);
  globalThis.__welcomeWatcher.unref?.();
  setTimeout(() => void tick(), 20_000).unref?.();
}

/** Right after a signup or website callback: send its welcome now instead of waiting for the job. */
export function welcomeNow() {
  setTimeout(() => void tick(), 1500);
}

// ---------------- reports ----------------

export async function welcomeStats() {
  const rows = await db.select({ status: leadMessages.status, channel: leadMessages.channel, n: sql<number>`count(*)::int` }).from(leadMessages).groupBy(leadMessages.status, leadMessages.channel);
  const get = (status: string, channel?: string) => rows.filter((r) => r.status === status && (!channel || r.channel === channel)).reduce((a, r) => a + Number(r.n), 0);
  return {
    sent: get("sent"), waiting: get("queued") + get("retry"), failed: get("failed"),
    whatsappSent: get("sent", "whatsapp"), emailSent: get("sent", "email"),
  };
}

export function recentMessages(limit = 40) {
  return db.select().from(leadMessages).orderBy(desc(leadMessages.createdAt)).limit(limit);
}

/** Welcome messages that went to this phone / email. */
export function messagesFor(phone: string | null, email: string | null) {
  const p = phone10(phone), e = mail(email);
  if (!p && !e) return Promise.resolve([] as LeadMessage[]);
  return db.select().from(leadMessages).where(or(p ? eq(leadMessages.target, p) : undefined, e ? eq(leadMessages.target, e) : undefined)).orderBy(desc(leadMessages.createdAt));
}
