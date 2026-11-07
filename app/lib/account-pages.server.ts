// Loaders and actions for the shopper account pages (/account, /account/orders/<id>) on growpefy.com/s/<store> and own domains.
import { json, redirect } from "@remix-run/node";
import { eq } from "drizzle-orm";
import { db, storeCustomers, type Order, type Store, type StoreCustomer } from "~/db.server";
import {
  channelReady, checkCode, checkPw, createCustomer, currentCustomer, customerOrder, customerOrders, findCustomer, hashPw, loginCookie, logoutCookie,
  markVerified, missingFields, parseTarget, phoneWidget, sendCode, showTarget,
} from "./customer-account.server";
import { accountSettings, loginChannels, normPhone, orderSteps, trackingUrl, validEmail, validPhone, type Channel } from "./customer-accounts";
import { clientIp } from "./orders.server";
import { orderValuePaise, toCollectPaise } from "./payment-methods";
import { INDIAN_STATES } from "./states";
import { courierById } from "./courier-catalog";
import { storeIcon } from "./store-icon";
import type { ShopContext } from "./storefront.server";

const str = (fd: FormData, k: string, max = 120) => String(fd.get(k) ?? "").replace(/\s+/g, " ").trim().slice(0, max);

function storeInfo(ctx: ShopContext) {
  const s = ctx.store;
  const settings = (ctx.look?.data?.settings ?? null) as Record<string, unknown> | null;
  const logo = (typeof settings?.logo === "string" && settings.logo) || s.logoUrl;
  return { name: s.name, logo, color: s.primaryColor || "#111827", home: ctx.root || "/", account: `${ctx.root}/account`, support: s.supportPhone, favicon: storeIcon(s, settings) };
}

function enabledSettings(store: Store) {
  const s = accountSettings(store.accountSettings);
  if (!s.enabled) throw new Response("Not found", { status: 404 });
  return s;
}

const publicCustomer = (c: StoreCustomer) => ({
  firstName: c.firstName, lastName: c.lastName, phone: c.phone, email: c.email,
  phoneVerified: Boolean(c.phoneVerifiedAt), emailVerified: Boolean(c.emailVerifiedAt), address: c.address, hasPassword: Boolean(c.passwordHash),
});

function orderSummary(o: Order, root: string) {
  const t = orderSteps({ status: o.status, createdAt: o.createdAt.toISOString(), confirmStatus: o.confirmStatus, awb: o.awb, courierRef: o.courierRef, shipStatus: o.shipStatus, shipStatusRaw: o.shipStatusRaw });
  return {
    id: o.id, name: o.shopifyOrderName ?? `#${o.id.slice(-6).toUpperCase()}`, at: o.createdAt.toISOString(), total: orderValuePaise(o),
    items: o.items.map((l) => ({ title: l.title, variant: l.variantTitle, image: l.image, qty: l.quantity, price: l.pricePaise, free: Boolean(l.free) })),
    headline: t.headline, tone: t.tone, url: `${root}/account/orders/${o.id}`,
  };
}

/** Login ways for this store; a code channel that can't send right now falls back to a password. */
async function channelsFor(settings: ReturnType<typeof accountSettings>) {
  return Promise.all(loginChannels(settings).map(async (ch) => ({ channel: ch.channel, otp: ch.otp && (await channelReady(ch.channel)), ready: true })));
}

export async function accountLoader(ctx: ShopContext, request: Request) {
  const s = enabledSettings(ctx.store);
  const c = await currentCustomer(request, ctx.store);
  const base = { store: storeInfo(ctx), settings: s, states: INDIAN_STATES };
  if (!c) {
    return json({ ...base, customer: null, missing: [] as string[], orders: [] as ReturnType<typeof orderSummary>[], channels: await channelsFor(s), widget: await phoneWidget() });
  }
  const list = await customerOrders(ctx.store, c);
  return json({ ...base, customer: publicCustomer(c), missing: missingFields(ctx.store, c), orders: list.map((o) => orderSummary(o, ctx.root)), channels: [], widget: await phoneWidget() });
}

type Stage = "start" | "code" | "password" | "signup" | "verifyField";
export type AccountActionData = { stage?: Stage; channel?: Channel; target?: string; shown?: string; resendIn?: number; error?: string; codeError?: string; ok?: string };

export async function accountAction(ctx: ShopContext, request: Request) {
  const store = ctx.store;
  const s = enabledSettings(store);
  const fd = await request.formData();
  const field = str(fd, "intent2", 10) === "field"; // the code box posts verify / send; for a logged-in shopper it's their phone or email
  const raw0 = str(fd, "intent", 20);
  const intent = field ? (raw0 === "verify" ? "fieldVerify" : raw0 === "send" ? "fieldSend" : raw0) : raw0;
  const home = `${ctx.root}/account`;
  const done = async (customerId: number) => redirect(home, { headers: { "Set-Cookie": await loginCookie(store, customerId) } });

  if (intent === "logout") return redirect(ctx.root || "/", { headers: { "Set-Cookie": await logoutCookie(store) } });

  const me = await currentCustomer(request, store);

  // ----- logged in: profile and verifying a phone / email -----
  if (me && (intent === "profile" || intent === "fieldSend" || intent === "fieldVerify")) {
    if (intent === "profile") {
      const first = str(fd, "firstName", 60), last = str(fd, "lastName", 60);
      const phone = normPhone(str(fd, "phone", 20)), email = str(fd, "email", 120).toLowerCase();
      if (s.name !== "none" && s.nameRequired && !first) return json<AccountActionData>({ error: "Enter your name." }, { status: 400 });
      if (s.name === "full" && s.nameRequired && !last) return json<AccountActionData>({ error: "Enter your last name." }, { status: 400 });
      if (s.phone !== "hidden" && (phone || s.phone === "required") && !validPhone(phone)) return json<AccountActionData>({ error: "Enter a valid 10-digit mobile number." }, { status: 400 });
      if (s.email !== "hidden" && (email || s.email === "required") && !validEmail(email)) return json<AccountActionData>({ error: "Enter a valid email address." }, { status: 400 });
      let address = me.address;
      if (s.address !== "hidden") {
        const a = { address1: str(fd, "address1", 200), address2: str(fd, "address2", 200), landmark: str(fd, "landmark", 120), city: str(fd, "city", 60), state: str(fd, "state", 10), pincode: str(fd, "pincode", 6).replace(/\D/g, "") };
        const any = a.address1 || a.city || a.pincode;
        if (any || s.address === "required") {
          if (!a.address1 || !a.city || !a.state || !/^\d{6}$/.test(a.pincode)) return json<AccountActionData>({ error: "Fill in the address, city, state and a 6-digit pincode." }, { status: 400 });
          address = a;
        } else address = null;
      }
      // A changed phone / email has to be proved again (when the store asks for it)
      const newPhone = s.phone === "hidden" ? me.phone : phone || null;
      const newEmail = s.email === "hidden" ? me.email : email || null;
      if (newPhone && newPhone !== me.phone && (await findCustomer(store.id, "phone", newPhone))) return json<AccountActionData>({ error: "This mobile number is already used by another account." }, { status: 400 });
      if (newEmail && newEmail !== me.email && (await findCustomer(store.id, "email", newEmail))) return json<AccountActionData>({ error: "This email is already used by another account." }, { status: 400 });
      await db.update(storeCustomers).set({
        firstName: s.name === "none" ? me.firstName : first, lastName: s.name === "full" ? last : me.lastName,
        phone: newPhone, email: newEmail, address,
        ...(newPhone !== me.phone ? { phoneVerifiedAt: null } : {}), ...(newEmail !== me.email ? { emailVerifiedAt: null } : {}),
      }).where(eq(storeCustomers.id, me.id));
      return json<AccountActionData>({ ok: "Saved." });
    }
    const channel: Channel = str(fd, "channel", 10) === "email" ? "email" : "phone";
    const target = channel === "phone" ? me.phone : me.email;
    if (!target) return json<AccountActionData>({ error: "Add it to your profile first." }, { status: 400 });
    if (intent === "fieldSend") {
      const r = await sendCode(store, channel, target, clientIp(request));
      return json<AccountActionData>({ stage: "verifyField", channel, target, shown: showTarget(channel, target), resendIn: r.ok ? r.resendIn : r.resendIn, codeError: r.ok ? undefined : r.error });
    }
    const v = await checkCode(store, channel, target, str(fd, "code", 10), str(fd, "token", 2000) || undefined);
    if (!v.ok) return json<AccountActionData>({ stage: "verifyField", channel, target, shown: showTarget(channel, target), codeError: v.error }, { status: 400 });
    await markVerified(me, channel);
    return json<AccountActionData>({ ok: channel === "phone" ? "Mobile number verified." : "Email verified." });
  }

  // ----- logging in / creating an account -----
  const channel: Channel = str(fd, "channel", 10) === "email" ? "email" : "phone";
  const allowed = (await channelsFor(s)).find((c) => c.channel === channel);
  if (!allowed) return json<AccountActionData>({ stage: "start", error: "Choose how to log in." }, { status: 400 });
  const raw = str(fd, "target", 120);
  const target = parseTarget(channel, raw);
  if (!target) return json<AccountActionData>({ stage: "start", channel, target: raw, error: channel === "phone" ? "Enter a valid 10-digit mobile number." : "Enter a valid email address." }, { status: 400 });
  const shown = showTarget(channel, target);

  if (allowed.otp) {
    if (intent === "start" || intent === "send") {
      const r = await sendCode(store, channel, target, clientIp(request));
      if (!r.ok && !r.resendIn) return json<AccountActionData>({ stage: "start", channel, target: raw, error: r.error }, { status: 400 });
      return json<AccountActionData>({ stage: "code", channel, target, shown, resendIn: r.resendIn, codeError: r.ok ? undefined : r.error });
    }
    if (intent === "verify") {
      const v = await checkCode(store, channel, target, str(fd, "code", 10), str(fd, "token", 2000) || undefined);
      if (!v.ok) return json<AccountActionData>({ stage: "code", channel, target, shown, codeError: v.error }, { status: 400 });
      let c = await findCustomer(store.id, channel, target);
      if (c) { if (!(channel === "phone" ? c.phoneVerifiedAt : c.emailVerifiedAt)) await markVerified(c, channel); }
      else c = await createCustomer(store.id, channel, target, true);
      if (!c) return json<AccountActionData>({ stage: "start", error: "Couldn't open your account. Please try again." }, { status: 500 });
      return done(c.id);
    }
  } else {
    const existing = await findCustomer(store.id, channel, target);
    if (intent === "start") return json<AccountActionData>({ stage: existing?.passwordHash ? "password" : "signup", channel, target, shown });
    if (intent === "password") {
      if (!existing || !(await checkPw(str(fd, "password", 200), existing.passwordHash))) return json<AccountActionData>({ stage: "password", channel, target, shown, error: "That password isn't right." }, { status: 401 });
      return done(existing.id);
    }
    if (intent === "signup") {
      if (existing?.passwordHash) return json<AccountActionData>({ stage: "password", channel, target, shown, error: "You already have an account. Enter your password." });
      const pw = String(fd.get("password") ?? "");
      if (pw.length < 6) return json<AccountActionData>({ stage: "signup", channel, target, shown, error: "Use at least 6 characters for the password." }, { status: 400 });
      const first = str(fd, "firstName", 60), last = str(fd, "lastName", 60);
      if (s.name !== "none" && s.nameRequired && !first) return json<AccountActionData>({ stage: "signup", channel, target, shown, error: "Enter your name." }, { status: 400 });
      const passwordHash = await hashPw(pw);
      let c = existing;
      if (c) await db.update(storeCustomers).set({ passwordHash, firstName: first || c.firstName, lastName: last || c.lastName }).where(eq(storeCustomers.id, c.id));
      else c = await createCustomer(store.id, channel, target, false, { passwordHash, firstName: first, lastName: last });
      if (!c) return json<AccountActionData>({ stage: "start", error: "Couldn't create your account. Please try again." }, { status: 500 });
      return done(c.id);
    }
  }
  return json<AccountActionData>({ stage: "start", error: "Something went wrong. Please try again." }, { status: 400 });
}

export async function accountOrderLoader(ctx: ShopContext, request: Request, orderId: string) {
  enabledSettings(ctx.store);
  const c = await currentCustomer(request, ctx.store);
  if (!c) throw redirect(`${ctx.root}/account?next=orders/${encodeURIComponent(orderId)}`);
  const o = await customerOrder(ctx.store, c, orderId);
  if (!o) throw new Response("Order not found", { status: 404 });
  const t = orderSteps({ status: o.status, createdAt: o.createdAt.toISOString(), confirmStatus: o.confirmStatus, awb: o.awb, courierRef: o.courierRef, shipStatus: o.shipStatus, shipStatusRaw: o.shipStatusRaw });
  const a = o.customer;
  return json({
    store: storeInfo(ctx),
    order: {
      ...orderSummary(o, ctx.root), steps: t.steps,
      method: o.paymentMethod, toCollect: toCollectPaise(o), shipping: o.shipping, subtotal: o.subtotal,
      address: `${a.firstName} ${a.lastName}`.trim() + `\n${a.address1}${a.address2 ? ", " + a.address2 : ""}\n${a.city}, ${a.state} ${a.pincode}\n+91 ${a.phone}`,
      courier: o.courier ? courierById(o.courier)?.name ?? null : null, awb: o.awb, track: trackingUrl(o.courier, o.awb),
      live: o.shipStatusRaw, note: o.customerNote,
    },
  });
}
