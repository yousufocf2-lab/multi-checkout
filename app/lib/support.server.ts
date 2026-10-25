import { and, desc, eq, gt, inArray, sql } from "drizzle-orm";
import { callbackRequests, db, stores, supportMessages, supportTickets, users } from "~/db.server";
import { readAttribution } from "./attribution";
import type { Viewer } from "./auth.server";
import { clientIp } from "./orders.server";
import { CALL_TIMES, CALLBACK_REASONS, CALLBACK_STATUS, WEBSITE_REASONS, TICKET_CATEGORIES, TICKET_STATUS, type TicketStatus } from "./support";

const clean = (v: FormDataEntryValue | null, max: number) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);
const cleanBody = (v: FormDataEntryValue | null, max: number) => String(v ?? "").replace(/\r/g, "").replace(/\n{3,}/g, "\n\n").trim().slice(0, max);
const phone10 = (v: string) => { const d = v.replace(/\D/g, ""); const t = d.length === 12 && d.startsWith("91") ? d.slice(2) : d.length === 11 && d.startsWith("0") ? d.slice(1) : d; return /^[6-9]\d{9}$/.test(t) ? t : null; };
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export type FormResult = { ok: true; message: string; id?: number } | { ok: false; errors: Record<string, string> };

/** "Call me back" from the website or dashboard. Website requests are limited per IP. */
export async function createCallback(request: Request, form: FormData, from: { source: "website" | "dashboard"; viewer?: Viewer | null }): Promise<FormResult> {
  // bots fill hidden fields
  if (clean(form.get("company_site"), 50)) return { ok: true, message: "Thanks! We'll call you back soon." };
  const errors: Record<string, string> = {};
  const name = clean(form.get("name"), 80);
  const ph = phone10(clean(form.get("phone"), 20));
  const email = clean(form.get("email"), 120).toLowerCase();
  const reason = clean(form.get("reason"), 30);
  const time = clean(form.get("time"), 20);
  const message = cleanBody(form.get("message"), 1000);
  if (name.length < 2) errors.name = "Enter your name";
  if (!ph) errors.phone = "Enter a valid 10-digit mobile number";
  if (email && !EMAIL.test(email)) errors.email = "Enter a valid email or leave it empty";
  const allowed: readonly { id: string }[] = from.source === "website" ? WEBSITE_REASONS : CALLBACK_REASONS;
  if (!allowed.some((r) => r.id === reason)) errors.reason = "Choose what you need help with";
  if (Object.keys(errors).length) return { ok: false, errors };

  const ip = clientIp(request);
  if (from.source === "website" && ip) {
    const [r] = await db.select({ n: sql<number>`count(*)::int` }).from(callbackRequests)
      .where(and(eq(callbackRequests.ip, ip), gt(callbackRequests.createdAt, new Date(Date.now() - 3600_000))));
    if (Number(r?.n ?? 0) >= 5) return { ok: false, errors: { form: "You've sent a few requests already. We'll call you soon, or write to us by email." } };
  }
  // one open request per number is enough: update it instead of adding duplicates
  const [open] = await db.select({ id: callbackRequests.id }).from(callbackRequests)
    .where(and(eq(callbackRequests.phone, ph!), eq(callbackRequests.status, "new"), gt(callbackRequests.createdAt, new Date(Date.now() - 24 * 3600_000)))).limit(1);

  let storeId: number | null = null;
  const v = from.viewer;
  if (v && from.source === "dashboard") {
    const sid = Number(form.get("storeId"));
    if (Number.isInteger(sid) && sid > 0) {
      const [s] = await db.select({ id: stores.id }).from(stores).where(v.role === "admin" ? eq(stores.id, sid) : and(eq(stores.id, sid), eq(stores.ownerId, v.userId))).limit(1);
      storeId = s?.id ?? null;
    }
  }
  const values = {
    source: from.source, name, phone: ph!, email: email || null, reason, message: message || null,
    preferredTime: CALL_TIMES.some((t) => t.id === time) ? time : "anytime",
    storeId, userId: v?.role === "owner" ? v.userId : null, ip,
    attribution: from.source === "website" ? readAttribution(request) : null,
  };
  if (open) {
    // keep details from the first request when the new one leaves them blank
    const { email: em, message: msg, storeId: sid, userId: uid, attribution: at, ...rest } = values;
    await db.update(callbackRequests).set({
      ...rest, createdAt: new Date(),
      ...(em ? { email: em } : {}), ...(msg ? { message: msg } : {}), ...(sid ? { storeId: sid } : {}), ...(uid ? { userId: uid } : {}), ...(at ? { attribution: at } : {}),
    }).where(eq(callbackRequests.id, open.id));
    return { ok: true, id: open.id, message: "We already have your request and updated it. Our team will call you soon." };
  }
  const [row] = await db.insert(callbackRequests).values(values).returning({ id: callbackRequests.id });
  return { ok: true, id: row.id, message: "Request received. Our team will call you back within one working day." };
}

export async function listCallbacks(opts: { status?: string; userId?: number; limit?: number }) {
  const where = and(
    opts.status && opts.status !== "all" ? eq(callbackRequests.status, opts.status) : undefined,
    opts.userId ? eq(callbackRequests.userId, opts.userId) : undefined,
  );
  return db.select({
    id: callbackRequests.id, source: callbackRequests.source, name: callbackRequests.name, phone: callbackRequests.phone, email: callbackRequests.email,
    reason: callbackRequests.reason, message: callbackRequests.message, preferredTime: callbackRequests.preferredTime, status: callbackRequests.status,
    adminNote: callbackRequests.adminNote, channel: sql<string | null>`${callbackRequests.attribution}->>'channel'`, createdAt: callbackRequests.createdAt, handledAt: callbackRequests.handledAt, storeName: stores.name,
  }).from(callbackRequests).leftJoin(stores, eq(stores.id, callbackRequests.storeId)).where(where)
    .orderBy(sql`case ${callbackRequests.status} when 'new' then 0 when 'contacted' then 1 else 2 end`, desc(callbackRequests.createdAt)).limit(opts.limit ?? 100);
}

export async function updateCallback(id: number, status: string, note: string) {
  if (!(status in CALLBACK_STATUS)) return;
  await db.update(callbackRequests).set({ status, adminNote: note.slice(0, 500) || null, handledAt: status === "new" ? null : new Date() }).where(eq(callbackRequests.id, id));
}

// ---------- tickets ----------

const ticketCols = {
  id: supportTickets.id, category: supportTickets.category, subject: supportTickets.subject, status: supportTickets.status, lastBy: supportTickets.lastBy,
  ownerSeenAt: supportTickets.ownerSeenAt, adminSeenAt: supportTickets.adminSeenAt, createdAt: supportTickets.createdAt, updatedAt: supportTickets.updatedAt,
  storeId: supportTickets.storeId, storeName: stores.name, userId: supportTickets.userId, ownerName: users.name, ownerPhone: users.phone, ownerEmail: users.email,
};

export async function createTicket(v: Extract<Viewer, { role: "owner" }>, form: FormData): Promise<FormResult> {
  const errors: Record<string, string> = {};
  const category = clean(form.get("category"), 30);
  const subject = clean(form.get("subject"), 120);
  const body = cleanBody(form.get("body"), 4000);
  if (!TICKET_CATEGORIES.some((c) => c.id === category)) errors.category = "Choose a category";
  if (subject.length < 4) errors.subject = "Add a short subject";
  if (body.length < 10) errors.body = "Tell us a little more about the problem";
  const sid = Number(form.get("storeId"));
  let storeId: number | null = null;
  if (Number.isInteger(sid) && sid > 0) {
    const [s] = await db.select({ id: stores.id }).from(stores).where(and(eq(stores.id, sid), eq(stores.ownerId, v.userId))).limit(1);
    storeId = s?.id ?? null;
  }
  if (Object.keys(errors).length) return { ok: false, errors };
  const [recent] = await db.select({ n: sql<number>`count(*)::int` }).from(supportTickets)
    .where(and(eq(supportTickets.userId, v.userId), gt(supportTickets.createdAt, new Date(Date.now() - 3600_000))));
  if (Number(recent?.n ?? 0) >= 10) return { ok: false, errors: { form: "Too many complaints in the last hour. Add details to an open one instead." } };
  const now = new Date();
  const id = await db.transaction(async (tx) => {
    const [t] = await tx.insert(supportTickets).values({ userId: v.userId, storeId, category, subject, lastBy: "owner", ownerSeenAt: now, updatedAt: now }).returning({ id: supportTickets.id });
    await tx.insert(supportMessages).values({ ticketId: t.id, by: "owner", authorName: v.name, body });
    return t.id;
  });
  return { ok: true, id, message: `Complaint #${id} raised. We'll reply here, usually within a few working hours.` };
}

/** Tickets the viewer may see: admin sees all, an owner only their own. */
export async function listTickets(v: Viewer, opts: { status?: string } = {}) {
  const st = opts.status === "active" ? inArray(supportTickets.status, ["open", "in_progress"]) : opts.status && opts.status !== "all" ? eq(supportTickets.status, opts.status) : undefined;
  return db.select(ticketCols).from(supportTickets)
    .leftJoin(stores, eq(stores.id, supportTickets.storeId)).leftJoin(users, eq(users.id, supportTickets.userId))
    .where(and(v.role === "owner" ? eq(supportTickets.userId, v.userId) : undefined, st))
    .orderBy(sql`case when ${supportTickets.status} in ('open','in_progress') then 0 else 1 end`, desc(supportTickets.updatedAt)).limit(200);
}

export async function getTicket(v: Viewer, id: number) {
  const [t] = await db.select(ticketCols).from(supportTickets)
    .leftJoin(stores, eq(stores.id, supportTickets.storeId)).leftJoin(users, eq(users.id, supportTickets.userId))
    .where(and(eq(supportTickets.id, id), v.role === "owner" ? eq(supportTickets.userId, v.userId) : undefined)).limit(1);
  if (!t) return null;
  const messages = await db.select().from(supportMessages).where(eq(supportMessages.ticketId, id)).orderBy(supportMessages.createdAt);
  await db.update(supportTickets).set(v.role === "admin" ? { adminSeenAt: new Date() } : { ownerSeenAt: new Date() }).where(eq(supportTickets.id, id));
  return { ticket: t, messages };
}

export async function replyTicket(v: Viewer, id: number, form: FormData): Promise<FormResult> {
  const body = cleanBody(form.get("body"), 4000);
  const want = clean(form.get("status"), 20) as TicketStatus | "";
  const found = await db.select({ id: supportTickets.id, status: supportTickets.status }).from(supportTickets)
    .where(and(eq(supportTickets.id, id), v.role === "owner" ? eq(supportTickets.userId, v.userId) : undefined)).limit(1);
  const t = found[0];
  if (!t) return { ok: false, errors: { form: "Complaint not found" } };
  const isAdmin = v.role === "admin";
  let status = t.status as TicketStatus;
  if (isAdmin && want && want in TICKET_STATUS) status = want;
  // owner writes again on a resolved/closed complaint → it reopens
  if (!isAdmin && body && (status === "resolved" || status === "closed")) status = "open";
  if (!isAdmin && want === "closed") status = "closed";
  if (!body && status === t.status) return { ok: false, errors: { body: "Write a message" } };
  const now = new Date();
  await db.transaction(async (tx) => {
    if (body) await tx.insert(supportMessages).values({ ticketId: id, by: isAdmin ? "admin" : "owner", authorName: isAdmin ? "Growpefy support" : v.name, body });
    await tx.update(supportTickets).set({
      status, updatedAt: now,
      ...(body ? { lastBy: isAdmin ? "admin" : "owner" } : {}),
      ...(isAdmin ? { adminSeenAt: now } : { ownerSeenAt: now }),
    }).where(eq(supportTickets.id, id));
  });
  return { ok: true, message: body ? "Reply sent" : `Marked ${TICKET_STATUS[status].toLowerCase()}` };
}

/** Badge counts in the sidebar. */
export async function supportBadge(v: Viewer) {
  if (v.role === "admin") {
    const [[c], [t]] = await Promise.all([
      db.select({ n: sql<number>`count(*)::int` }).from(callbackRequests).where(eq(callbackRequests.status, "new")),
      db.select({ n: sql<number>`count(*)::int` }).from(supportTickets).where(and(inArray(supportTickets.status, ["open", "in_progress"]), eq(supportTickets.lastBy, "owner"))),
    ]);
    return Number(c?.n ?? 0) + Number(t?.n ?? 0);
  }
  const [r] = await db.select({ n: sql<number>`count(*)::int` }).from(supportTickets)
    .where(and(eq(supportTickets.userId, v.userId), eq(supportTickets.lastBy, "admin"),
      sql`(${supportTickets.ownerSeenAt} is null or ${supportTickets.ownerSeenAt} < ${supportTickets.updatedAt})`));
  return Number(r?.n ?? 0);
}

export async function ownerContactFor(userId: number) {
  const [u] = await db.select({ name: users.name, phone: users.phone, email: users.email }).from(users).where(eq(users.id, userId)).limit(1);
  return u ?? null;
}
