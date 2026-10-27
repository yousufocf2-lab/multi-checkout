// One-click Shopify connect (see lib/connect.ts): connect requests from owners, the install link Growpefy's
// team saves, and the WhatsApp + email that tell each side what to do next.
import { and, desc, eq, isNotNull, sql } from "drizzle-orm";
import { db, stores, users } from "~/db.server";
import { CONNECT_WA_TEMPLATES, slugify } from "./connect";
import { env } from "./env.server";
import { messaging } from "./rto.server";
import { getPlatform } from "./wallet.server";
import { getWelcome } from "./welcome.server";
import { greetName } from "./welcome";

const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const phone10 = (p: string | null | undefined) => { const d = (p ?? "").replace(/\D/g, "").replace(/^(91|0)(?=\d{10}$)/, ""); return /^[6-9]\d{9}$/.test(d) ? d : null; };
const mail = (e: string | null | undefined) => { const x = (e ?? "").trim().toLowerCase(); return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(x) ? x : null; };
const base = () => env.appUrl.replace(/\/+$/, "");

// ---------------- request ----------------

/** True unless Shopify clearly says there's no store at this address (network problems don't block). */
export async function shopExists(shop: string) {
  const res = await fetch(`https://${shop}/`, { method: "GET", redirect: "manual", signal: AbortSignal.timeout(6000) }).catch(() => null);
  return !(res && res.status === 404);
}

async function uniqueSlug(wanted: string) {
  const root = slugify(wanted) || "store";
  for (let i = 1; i < 200; i++) {
    const slug = i === 1 ? root : `${root.slice(0, 36)}-${i}`;
    const [hit] = await db.select({ id: stores.id }).from(stores).where(eq(stores.slug, slug)).limit(1);
    if (!hit) return slug;
  }
  return `${root.slice(0, 30)}-${Date.now().toString(36)}`;
}

const host = (x: string) => x.replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/[/?#].*$/, "").toLowerCase();

/**
 * Creates the store (waiting for credentials) and tells Growpefy's team.
 * Name and Store ID come from the brand given at signup, else from the website or the Shopify address.
 */
export async function requestConnect(input: { ownerId: number | null; shop: string; website?: string | null }) {
  const [dupe] = await db.select({ id: stores.id, ownerId: stores.ownerId }).from(stores).where(eq(stores.shopDomain, input.shop)).limit(1);
  if (dupe) {
    if (input.ownerId == null || dupe.ownerId === input.ownerId) return { storeId: dupe.id, existed: true as const };
    return { error: "This Shopify store is already connected to another Growpefy account. Message our support team and we'll sort it out." };
  }

  const [owner] = input.ownerId
    ? await db.select({ name: users.name, signup: users.signup }).from(users).where(eq(users.id, input.ownerId)).limit(1)
    : [];
  const mine = input.ownerId ? await db.select({ url: stores.storefrontUrl }).from(stores).where(eq(stores.ownerId, input.ownerId)) : [];
  const used = new Set(mine.map((m) => host(m.url)));
  const site = (input.website?.trim() || owner?.signup?.websites?.find((w) => w.platform === "shopify" && !used.has(host(w.url)))?.url || "").replace(/\/+$/, "");
  const storefrontUrl = site ? (/^https?:\/\//.test(site) ? site : `https://${site}`) : `https://${input.shop}`;

  const prefix = input.shop.replace(/\.myshopify\.com$/, "");
  const siteName = site ? host(site).split(".")[0] : "";
  // First store: the brand. More stores: the website's name, so two stores of one brand don't look the same.
  const name = (!mine.length && owner?.name?.trim()) || (siteName ? siteName.charAt(0).toUpperCase() + siteName.slice(1) : prefix);
  const slug = await uniqueSlug(!mine.length && owner?.name ? owner.name : siteName || prefix);

  const [created] = await db.insert(stores).values({
    ownerId: input.ownerId, name, slug, platform: "shopify", shopDomain: input.shop, storefrontUrl, active: true,
    connectStatus: "requested", connectRequestedAt: new Date(),
  }).returning({ id: stores.id });

  notifyAdmin(created.id).catch((e) => console.error("[connect] admin notice failed:", e));
  return { storeId: created.id, existed: false as const };
}

// ---------------- team saves the app ----------------

export function cleanInstallUrl(v: string) {
  const s = v.trim();
  try {
    const u = new URL(s);
    const h = u.hostname.toLowerCase();
    return u.protocol === "https:" && (h === "shopify.com" || h.endsWith(".shopify.com") || h.endsWith(".myshopify.com")) ? u.toString() : null;
  } catch { return null; }
}

/** Saves the app's Client ID, secret and install link, marks the store ready and tells the owner. */
export async function saveConnectCredentials(storeId: number, input: { clientId: string; clientSecret: string; installUrl: string }, notify = true) {
  const [s] = await db.select().from(stores).where(eq(stores.id, storeId)).limit(1);
  if (!s) return { errors: { form: "Store not found" } };
  const errors: Record<string, string> = {};
  const clientId = input.clientId.trim();
  const clientSecret = input.clientSecret.trim() || s.clientSecret || "";
  const installUrl = cleanInstallUrl(input.installUrl);
  if (!/^[A-Za-z0-9_-]{16,}$/.test(clientId)) errors.clientId = "Paste the app's Client ID (from Settings in the Dev Dashboard)";
  if (!clientSecret) errors.clientSecret = "Paste the app's Client secret";
  if (!installUrl) errors.installUrl = "Paste the install link Shopify gave after choosing Custom distribution (starts with https://)";
  if (Object.keys(errors).length) return { errors };

  const changedApp = s.clientId !== clientId;
  await db.update(stores).set({
    clientId, clientSecret, installUrl,
    // A different app means the old token belongs to the old app
    ...(changedApp && s.adminToken ? { adminToken: null } : {}),
    connectStatus: s.adminToken && !changedApp ? null : "ready", connectReadyAt: new Date(),
  }).where(eq(stores.id, storeId));

  const sent = notify && (!s.adminToken || changedApp) ? await notifyOwner(storeId) : null;
  return { errors: null, sent };
}

// ---------------- sending ----------------

type Sent = { email: string; whatsapp: string };

async function sendTemplate(to10: string, template: string, params: string[]) {
  const m = await messaging();
  if (!m.waPhoneNumberId || !m.waToken) return "WhatsApp isn't set up";
  const s = await getWelcome();
  const res = await fetch(`https://graph.facebook.com/v21.0/${m.waPhoneNumberId}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${m.waToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      messaging_product: "whatsapp", to: `91${to10}`, type: "template",
      template: { name: template, language: { code: s.waLang || "en" }, components: [{ type: "body", parameters: params.map((text) => ({ type: "text", text: text.slice(0, 60) })) }] },
    }),
    signal: AbortSignal.timeout(10_000),
  }).catch(() => null);
  if (!res) return "Couldn't reach WhatsApp";
  const body = (await res.json().catch(() => ({}))) as { messages?: unknown[]; error?: { message?: string; code?: number } };
  if (res.ok && body.messages?.length) return "sent";
  return `${body.error?.code ? `(#${body.error.code}) ` : ""}${body.error?.message ?? `error ${res.status}`}`.slice(0, 200);
}

async function sendMail(to: string, subject: string, html: string, text: string) {
  const key = process.env.RESEND_API_KEY;
  if (key === "test" || (!key && process.env.NODE_ENV !== "production")) { console.log(`[connect] test mode, email to ${to}: ${subject}`); return "sent"; }
  if (!key) return "Email isn't set up (RESEND_API_KEY)";
  const s = await getWelcome();
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: `${(s.fromName || "Growpefy").replace(/[<>"]/g, "")} <${s.fromEmail || "hello@growpefy.com"}>`,
      reply_to: s.replyTo || s.fromEmail || "hello@growpefy.com",
      to: [to], subject, html, text,
    }),
    signal: AbortSignal.timeout(10_000),
  }).catch(() => null);
  if (!res) return "Couldn't reach the email service";
  if (res.ok) return "sent";
  const body = (await res.json().catch(() => ({}))) as { message?: string };
  return (body.message ?? `error ${res.status}`).slice(0, 200);
}

/** Short branded email: logo, heading, paragraphs, one button. */
function noticeEmail(o: { heading: string; lines: string[]; button?: { href: string; label: string }; foot?: string }) {
  const F = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
  const p = (t: string) => `<p style="margin:0 0 14px;font-family:${F};font-size:15px;line-height:1.65;color:#4A5753">${t}</p>`;
  const btn = o.button ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 18px"><tr><td bgcolor="#0B5D4B" style="border-radius:10px">
<a href="${esc(o.button.href)}" target="_blank" style="display:inline-block;padding:14px 26px;font-family:${F};font-size:15px;font-weight:700;color:#fff;text-decoration:none;border-radius:10px">${esc(o.button.label)}</a></td></tr></table>` : "";
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;background:#F2F5F3"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#F2F5F3"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;background:#fff;border:1px solid #E3E8E5;border-radius:16px">
<tr><td style="padding:24px 32px 8px"><img src="${base()}/brand/email/logo.png" height="32" alt="Growpefy" style="display:block;border:0;height:32px;width:auto"></td></tr>
<tr><td style="padding:12px 32px 16px"><h1 style="margin:0 0 14px;font-family:${F};font-size:22px;line-height:1.3;color:#0B1513">${o.heading}</h1>${o.lines.map(p).join("")}${btn}${o.foot ? `<p style="margin:0;font-family:${F};font-size:13px;line-height:1.55;color:#7C8884">${o.foot}</p>` : ""}</td></tr>
</table></td></tr></table></body></html>`;
  const text = [o.heading.replace(/<[^>]+>/g, ""), ...o.lines.map((l) => l.replace(/<[^>]+>/g, "")), o.button ? `${o.button.label}: ${o.button.href}` : "", o.foot?.replace(/<[^>]+>/g, "") ?? ""].filter(Boolean).join("\n\n");
  return { html, text };
}

/** Growpefy's own email + WhatsApp number for these alerts. */
async function teamContacts() {
  const [p, s] = await Promise.all([getPlatform(), getWelcome()]);
  return {
    email: mail(process.env.ADMIN_NOTIFY_EMAIL) ?? mail(p.billing?.email) ?? "support@growpefy.com",
    phone: phone10(process.env.ADMIN_NOTIFY_PHONE) ?? phone10(s.whatsappNumber) ?? phone10(p.billing?.phone),
  };
}

async function notifyAdmin(storeId: number): Promise<Sent> {
  const [row] = await db.select({ s: stores, owner: { name: users.name, email: users.email, phone: users.phone } })
    .from(stores).leftJoin(users, eq(users.id, stores.ownerId)).where(eq(stores.id, storeId)).limit(1);
  if (!row) return { email: "store missing", whatsapp: "store missing" };
  const to = await teamContacts();
  const brand = row.owner?.name || row.s.name;
  const link = `${base()}/dashboard/connect-requests#store-${storeId}`;
  const { html, text } = noticeEmail({
    heading: "New store connect request",
    lines: [
      `<b>${esc(brand)}</b> wants to connect <b>${esc(row.s.shopDomain)}</b>.`,
      `Create a custom-distribution app for this store in the Shopify Dev Dashboard, then paste its Client ID, Client secret and install link in Growpefy. The owner gets WhatsApp and email as soon as you save.`,
      [row.owner?.phone && `Phone: ${esc(row.owner.phone)}`, row.owner?.email && `Email: ${esc(row.owner.email)}`].filter(Boolean).join(" · "),
    ].filter(Boolean),
    button: { href: link, label: "Open connect request" },
  });
  const [email, whatsapp] = await Promise.all([
    sendMail(to.email, `Connect request: ${brand} (${row.s.shopDomain})`, html, text),
    to.phone ? sendTemplate(to.phone, CONNECT_WA_TEMPLATES.request.name, [brand, row.s.shopDomain]) : Promise.resolve("No WhatsApp number for Growpefy"),
  ]);
  if (email !== "sent" || whatsapp !== "sent") console.warn(`[connect] admin notice for store ${storeId}: email=${email} whatsapp=${whatsapp}`);
  return { email, whatsapp };
}

/** Tells the owner their connection is ready (WhatsApp + email). */
export async function notifyOwner(storeId: number): Promise<Sent> {
  const [row] = await db.select({ s: stores, u: users }).from(stores).leftJoin(users, eq(users.id, stores.ownerId)).where(eq(stores.id, storeId)).limit(1);
  if (!row?.u) return { email: "No owner on this store", whatsapp: "No owner on this store" };
  const name = greetName(row.u.kyc?.contactName || row.u.name);
  const phone = phone10(row.u.phone ?? row.u.kyc?.phone);
  const email = mail(row.u.email ?? row.u.kyc?.email);
  const link = `${base()}/dashboard/stores/${storeId}/install`;
  const { html, text } = noticeEmail({
    heading: `Your Shopify connection is ready${name === "there" ? "" : `, ${esc(name)}`} ✅`,
    lines: [
      `We've set up the Growpefy app for <b>${esc(row.s.name)}</b> (${esc(row.s.shopDomain)}).`,
      `Click the button below and then <b>Connect store</b>. Shopify opens, you click <b>Install</b>, and you come back to your dashboard connected. It takes under a minute.`,
      `After that, add the checkout script to your theme. Your dashboard shows you exactly where.`,
    ],
    button: { href: link, label: "Connect my store" },
    foot: "Need help? Just reply to this email and our team will do it with you.",
  });
  const [e, w] = await Promise.all([
    email ? sendMail(email, `Your Shopify connection for ${row.s.name} is ready`, html, text) : Promise.resolve("No email on this account"),
    phone ? sendTemplate(phone, CONNECT_WA_TEMPLATES.ready.name, [name, row.s.name]) : Promise.resolve("No phone on this account"),
  ]);
  return { email: e, whatsapp: w };
}

// ---------------- admin list ----------------

export async function pendingConnectCount() {
  const [r] = await db.select({ n: sql<number>`count(*)::int` }).from(stores).where(eq(stores.connectStatus, "requested"));
  return Number(r?.n ?? 0);
}

/** Stores waiting for an app (requested) or for the owner to install it (ready). */
export async function connectRequests() {
  const rows = await db.select({ s: stores, owner: { id: users.id, name: users.name, email: users.email, phone: users.phone } })
    .from(stores).leftJoin(users, eq(users.id, stores.ownerId))
    .where(and(isNotNull(stores.connectStatus), eq(stores.platform, "shopify")))
    .orderBy(desc(stores.connectRequestedAt));
  return rows.map(({ s, owner }) => ({
    id: s.id, name: s.name, slug: s.slug, shop: s.shopDomain, website: s.storefrontUrl,
    status: s.connectStatus as "requested" | "ready",
    requestedAt: s.connectRequestedAt?.toISOString() ?? null, readyAt: s.connectReadyAt?.toISOString() ?? null,
    clientId: s.clientId ?? "", hasSecret: Boolean(s.clientSecret), installUrl: s.installUrl ?? "",
    owner: owner?.id ? { name: owner.name, email: owner.email, phone: owner.phone } : null,
  }));
}

/** Shared action for the team's connect form (Connect requests page and a store's Setup page). */
export async function connectFormAction(fd: FormData) {
  const storeId = Number(fd.get("storeId"));
  const intent = String(fd.get("intent") ?? "");
  if (!storeId) return { ok: false, errors: { form: "Store missing" } };
  if (intent === "resendReady") {
    const sent = await notifyOwner(storeId);
    return { ok: true, errors: null, sent, message: "Sent again." };
  }
  if (intent === "saveConnect") {
    const r = await saveConnectCredentials(storeId, {
      clientId: String(fd.get("clientId") ?? ""), clientSecret: String(fd.get("clientSecret") ?? ""), installUrl: String(fd.get("installUrl") ?? ""),
    });
    if (r.errors) return { ok: false, errors: r.errors };
    return { ok: true, errors: null, sent: r.sent, message: r.sent ? "Saved. The owner can connect now." : "Saved." };
  }
  return { ok: false, errors: { form: "Unknown action" } };
}
