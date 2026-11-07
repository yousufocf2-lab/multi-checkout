// Shopper account pages on a store's website: log in / create account, profile, orders and order tracking.
import { Form, Link, useActionData, useLoaderData, useNavigation, useSearchParams } from "@remix-run/react";
import { useEffect, useState } from "react";
import { OtpStep } from "./OtpAuth";
import { formatINR } from "~/lib/pricing";
import type { AccountSettings, TrackStep } from "~/lib/customer-accounts";
import type { AccountActionData } from "~/lib/account-pages.server";
import type { WidgetConfig } from "./msg91-widget";

type StoreInfo = { name: string; logo: string | null; color: string; home: string; account: string; support: string | null };

const rgb = (hex: string) => {
  const m = hex.replace("#", "").match(/^([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  return m ? `${parseInt(m[1], 16)} ${parseInt(m[2], 16)} ${parseInt(m[3], 16)}` : "17 24 39";
};
const when = (iso: string) => new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });

export function AccountShell({ store, children, wide }: { store: StoreInfo; children: React.ReactNode; wide?: boolean }) {
  return (
    <div style={{ ["--brand" as string]: rgb(store.color), ["--btn" as string]: rgb(store.color) }} className="min-h-screen bg-[#f6f6f4] text-ink">
      <header className="border-b border-black/[.07] bg-white">
        <div className={`mx-auto flex h-16 items-center justify-between gap-4 px-4 ${wide ? "max-w-4xl" : "max-w-xl"}`}>
          <a href={store.home} className="flex min-w-0 items-center" aria-label={`${store.name} home`}>
            {store.logo ? <img src={store.logo} alt={store.name} className="h-9 max-h-9 w-auto max-w-[150px] object-contain" /> : <span className="truncate text-[17px] font-semibold">{store.name}</span>}
          </a>
          <a href={store.home} className="shrink-0 text-[13px] font-medium text-ink-soft hover:text-ink">Continue shopping →</a>
        </div>
      </header>
      <main className={`mx-auto px-4 py-8 sm:py-10 ${wide ? "max-w-4xl" : "max-w-xl"}`}>{children}</main>
      {store.support && <p className="pb-8 text-center text-[12px] text-ink-faint">Need help? Call <a href={`tel:${store.support}`} className="underline">{store.support}</a></p>}
    </div>
  );
}

const Card = ({ children, className = "" }: { children: React.ReactNode; className?: string }) => (
  <section className={`rounded-2xl bg-white p-6 shadow-[0_1px_2px_rgba(0,0,0,.05)] ring-1 ring-black/[.06] sm:p-7 ${className}`}>{children}</section>
);
const Err = ({ children }: { children?: React.ReactNode }) => (children ? <p className="rounded-lg bg-red-50 px-3 py-2 text-[13px] text-bad" role="alert">{children}</p> : null);
const Ok = ({ children }: { children?: React.ReactNode }) => (children ? <p className="rounded-lg bg-emerald-50 px-3 py-2 text-[13px] text-good" role="status">{children}</p> : null);

type Ch = { channel: "phone" | "email"; otp: boolean; ready: boolean };
type LoaderData = {
  store: StoreInfo; settings: AccountSettings; states: { code: string; name: string }[];
  customer: null | { firstName: string; lastName: string; phone: string | null; email: string | null; phoneVerified: boolean; emailVerified: boolean; address: { address1: string; address2: string; landmark: string; city: string; state: string; pincode: string } | null; hasPassword: boolean };
  missing: string[];
  orders: { id: string; name: string; at: string; total: number; items: { title: string; variant: string | null; image: string | null; qty: number }[]; headline: string; tone: string; url: string }[];
  channels: Ch[]; widget: WidgetConfig | null;
};

export function AccountPage() {
  const d = useLoaderData<LoaderData>();
  return (
    <AccountShell store={d.store} wide={Boolean(d.customer)}>
      {d.customer ? <AccountHome d={d} /> : <LoginFlow d={d} />}
    </AccountShell>
  );
}

// ---------------- log in / create account ----------------

function LoginFlow({ d }: { d: LoaderData }) {
  const a = useActionData<AccountActionData>();
  const [params] = useSearchParams();
  const creating = params.get("create") === "1";
  const [stage, setStage] = useState(a?.stage ?? "start");
  useEffect(() => { if (a?.stage) setStage(a.stage); }, [a]);
  const usable = d.channels.filter((c) => c.ready);
  const [channel, setChannel] = useState<"phone" | "email">(a?.channel ?? usable[0]?.channel ?? "phone");
  const ch = usable.find((c) => c.channel === channel) ?? usable[0];

  if (!usable.length) {
    return <Card><h1 className="text-[22px] font-semibold">Accounts are taking a break</h1><p className="mt-2 text-[14px] text-ink-soft">Logging in isn't available right now. Please try again later.</p></Card>;
  }
  const hidden = { channel: a?.channel ?? channel, target: a?.target ?? "" };

  return (
    <Card>
      {stage === "start" && (
        <>
          <h1 className="text-[24px] font-semibold tracking-tight">{creating ? "Create your account" : "Log in"}</h1>
          <p className="mt-1 text-[14px] text-ink-soft">{creating ? `Track your orders and check out faster at ${d.store.name}.` : `See your orders and where they are.`}</p>
          {usable.length > 1 && (
            <div className="mt-5 inline-flex rounded-xl bg-[#efefed] p-1" role="tablist">
              {usable.map((c) => (
                <button key={c.channel} type="button" role="tab" aria-selected={channel === c.channel} onClick={() => setChannel(c.channel)}
                  className={`h-8 rounded-lg px-4 text-[13px] font-medium ${channel === c.channel ? "bg-white shadow-sm" : "text-ink-soft"}`}>{c.channel === "phone" ? "Mobile" : "Email"}</button>
              ))}
            </div>
          )}
          <Form method="post" className="mt-5 space-y-4" noValidate>
            <input type="hidden" name="intent" value="start" />
            <input type="hidden" name="channel" value={ch.channel} />
            <Err>{a?.stage === "start" ? a.error : null}</Err>
            {ch.channel === "phone" ? (
              <label className="block text-[13px] font-medium">Mobile number
                <div className="mt-1.5 flex rounded-xl ring-1 ring-black/15 focus-within:ring-2 focus-within:ring-[rgb(var(--brand))]">
                  <span className="flex items-center pl-3.5 pr-2 text-[15px] text-ink-soft">+91</span>
                  <input name="target" inputMode="numeric" autoComplete="tel-national" maxLength={14} required autoFocus defaultValue={a?.channel === "phone" ? a.target : ""} placeholder="10-digit mobile number" className="h-12 min-w-0 flex-1 rounded-r-xl border-0 bg-transparent text-[15px] outline-none" />
                </div>
              </label>
            ) : (
              <label className="block text-[13px] font-medium">Email
                <input name="target" type="email" inputMode="email" autoComplete="email" required autoFocus defaultValue={a?.channel === "email" ? a.target : ""} placeholder="you@example.com" className="mt-1.5 h-12 w-full rounded-xl border-0 px-3.5 text-[15px] ring-1 ring-black/15 outline-none focus:ring-2 focus:ring-[rgb(var(--brand))]" />
              </label>
            )}
            <Submit>{ch.otp ? "Send code" : "Continue"}</Submit>
            {ch.otp && <p className="text-center text-[12px] text-ink-faint">We'll send a one-time code {ch.channel === "phone" ? "by SMS" : "to your email"}. New here? Your account is created when you verify.</p>}
          </Form>
          <p className="mt-6 border-t border-black/[.06] pt-5 text-center text-[13px] text-ink-soft">
            {creating ? <>Already have an account? <Link to="?" className="font-semibold text-ink underline-offset-2 hover:underline">Log in</Link></> : <>New to {d.store.name}? <Link to="?create=1" className="font-semibold text-ink underline-offset-2 hover:underline">Create account</Link></>}
          </p>
        </>
      )}

      {stage === "code" && (
        <>
          <h1 className="text-[24px] font-semibold tracking-tight">Enter your code</h1>
          <p className="mb-5 mt-1 text-[14px] text-ink-soft">We sent a code to {a?.shown}.</p>
          <OtpStep hidden={hidden} error={a?.codeError} resendIn={a?.resendIn} onChange={() => setStage("start")} submitLabel="Continue" widget={a?.channel === "phone" ? d.widget : null} phone={a?.channel === "phone" ? a.target : undefined} />
        </>
      )}

      {stage === "password" && (
        <>
          <h1 className="text-[24px] font-semibold tracking-tight">Welcome back</h1>
          <p className="mt-1 text-[14px] text-ink-soft">{a?.shown}</p>
          <Form method="post" className="mt-5 space-y-4">
            <input type="hidden" name="intent" value="password" />
            {Object.entries(hidden).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
            <Err>{a?.error}</Err>
            <Field label="Password" name="password" type="password" autoComplete="current-password" required autoFocus />
            <Submit>Log in</Submit>
            <button type="button" onClick={() => setStage("start")} className="w-full text-center text-[13px] text-ink-soft hover:text-ink">← Use another {a?.channel === "email" ? "email" : "number"}</button>
          </Form>
        </>
      )}

      {stage === "signup" && (
        <>
          <h1 className="text-[24px] font-semibold tracking-tight">Create your account</h1>
          <p className="mt-1 text-[14px] text-ink-soft">For {a?.shown}</p>
          <Form method="post" className="mt-5 space-y-4">
            <input type="hidden" name="intent" value="signup" />
            {Object.entries(hidden).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
            <Err>{a?.error}</Err>
            <NameFields s={d.settings} />
            <Field label="Choose a password" name="password" type="password" autoComplete="new-password" minLength={6} required hint="At least 6 characters" />
            <Submit>Create account</Submit>
            <button type="button" onClick={() => setStage("start")} className="w-full text-center text-[13px] text-ink-soft hover:text-ink">← Back</button>
          </Form>
        </>
      )}
    </Card>
  );
}

// ---------------- logged in ----------------

function AccountHome({ d }: { d: LoaderData }) {
  const c = d.customer!;
  const a = useActionData<AccountActionData>();
  const [edit, setEdit] = useState(d.missing.length > 0);
  const nav = useNavigation();
  useEffect(() => { if (nav.state === "idle" && a?.ok === "Saved.") setEdit(false); }, [nav.state, a]);
  const name = [c.firstName, c.lastName].filter(Boolean).join(" ");
  const verifyChannel: "phone" | "email" | null = c.phone && !c.phoneVerified ? "phone" : c.email && !c.emailVerified ? "email" : null;
  const noVerified = !c.phoneVerified && !c.emailVerified;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[13px] text-ink-soft">My account</p>
          <h1 className="text-[26px] font-semibold tracking-tight">{name ? `Hi, ${c.firstName}` : "Welcome"}</h1>
        </div>
        <Form method="post"><input type="hidden" name="intent" value="logout" /><button className="h-9 rounded-lg px-3 text-[13px] font-medium text-ink-soft ring-1 ring-black/10 hover:bg-white hover:text-ink">Log out</button></Form>
      </div>

      {d.missing.length > 0 && <div className="rounded-xl bg-amber-50 px-4 py-3 text-[13px] text-amber-900 ring-1 ring-amber-200">Please complete your details to finish setting up your account.</div>}
      {a?.stage === "verifyField" ? (
        <Card>
          <h2 className="text-[18px] font-semibold">Verify {a.channel === "phone" ? "your mobile" : "your email"}</h2>
          <p className="mb-4 mt-1 text-[13px] text-ink-soft">We sent a code to {a.shown}.</p>
          <OtpStep hidden={{ channel: a.channel ?? "phone", intent2: "field" }} error={a.codeError} resendIn={a.resendIn} onChange={() => window.location.reload()} submitLabel="Verify" widget={a.channel === "phone" ? d.widget : null} phone={a.channel === "phone" ? a.target : undefined} />
        </Card>
      ) : verifyChannel && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-white px-4 py-3 text-[13px] ring-1 ring-black/[.06]">
          <span>{noVerified ? "Verify your " : "Please verify your "}{verifyChannel === "phone" ? `mobile +91 ${c.phone}` : c.email}{noVerified ? " to see your orders here." : "."}</span>
          <Form method="post"><input type="hidden" name="intent" value="fieldSend" /><input type="hidden" name="channel" value={verifyChannel} /><button className="btn-primary h-8 px-3 text-[12.5px]">Send code</button></Form>
        </div>
      )}
      <Ok>{a?.ok}</Ok>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
        <Card className="!p-0">
          <div className="flex items-center justify-between px-6 pb-3 pt-5"><h2 className="text-[17px] font-semibold">My orders</h2><span className="text-[12.5px] text-ink-faint">{d.orders.length} order{d.orders.length === 1 ? "" : "s"}</span></div>
          {d.orders.length === 0 ? (
            <div className="px-6 pb-8 pt-2 text-center">
              <p className="text-[14px] text-ink-soft">{noVerified ? "Verify your mobile or email to see orders placed with it." : "No orders yet."}</p>
              <a href={d.store.home} className="btn-primary mt-4 inline-flex h-10 px-5 text-[13px]">Start shopping</a>
            </div>
          ) : (
            <ul className="divide-y divide-black/[.06] border-t border-black/[.06]">
              {d.orders.map((o) => (
                <li key={o.id}>
                  <Link to={o.url} className="flex items-center gap-4 px-6 py-4 transition hover:bg-[#fafaf9]">
                    <div className="flex -space-x-3">
                      {o.items.slice(0, 3).map((l, i) => <span key={i} className="h-12 w-12 overflow-hidden rounded-lg bg-[#f1f1ef] ring-2 ring-white">{l.image && <img src={l.image} alt="" className="h-full w-full object-cover" />}</span>)}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-[14px] font-semibold">{o.name} <span className="font-normal text-ink-faint">· {when(o.at)}</span></p>
                      <p className="truncate text-[13px] text-ink-soft">{o.items.map((l) => `${l.title}${l.qty > 1 ? ` ×${l.qty}` : ""}`).join(", ")}</p>
                      <StatusChip text={o.headline} tone={o.tone} />
                    </div>
                    <p className="num shrink-0 text-[14px] font-semibold">{formatINR(o.total)}</p>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          {edit ? <ProfileForm d={d} onCancel={d.missing.length ? undefined : () => setEdit(false)} /> : (
            <>
              <div className="flex items-center justify-between"><h2 className="text-[17px] font-semibold">Profile</h2><button type="button" onClick={() => setEdit(true)} className="text-[13px] font-medium underline-offset-2 hover:underline">Edit</button></div>
              <dl className="mt-4 space-y-3 text-[13.5px]">
                {d.settings.name !== "none" && <Row k="Name" v={name || "—"} />}
                {d.settings.phone !== "hidden" && <Row k="Mobile" v={c.phone ? <>+91 {c.phone} {c.phoneVerified && <Verified />}</> : "—"} />}
                {d.settings.email !== "hidden" && <Row k="Email" v={c.email ? <>{c.email} {c.emailVerified && <Verified />}</> : "—"} />}
                {d.settings.address !== "hidden" && <Row k="Address" v={c.address ? <span className="whitespace-pre-line">{`${c.address.address1}${c.address.address2 ? ", " + c.address.address2 : ""}${c.address.landmark ? "\nNear " + c.address.landmark : ""}\n${c.address.city}, ${c.address.state} ${c.address.pincode}`}</span> : "—"} />}
              </dl>
            </>
          )}
        </Card>
      </div>
    </div>
  );
}

function ProfileForm({ d, onCancel }: { d: LoaderData; onCancel?: () => void }) {
  const c = d.customer!;
  const s = d.settings;
  const a = useActionData<AccountActionData>();
  const req = (r: string) => r === "required";
  return (
    <Form method="post" className="space-y-3.5">
      <input type="hidden" name="intent" value="profile" />
      <h2 className="text-[17px] font-semibold">Your details</h2>
      <Err>{a?.error}</Err>
      <NameFields s={s} first={c.firstName} last={c.lastName} />
      {s.phone !== "hidden" && <Field label={`Mobile number${req(s.phone) ? "" : " (optional)"}`} name="phone" inputMode="numeric" defaultValue={c.phone ?? ""} required={req(s.phone)} hint={s.phoneVerify ? "A new number needs a code to verify it." : undefined} />}
      {s.email !== "hidden" && <Field label={`Email${req(s.email) ? "" : " (optional)"}`} name="email" type="email" defaultValue={c.email ?? ""} required={req(s.email)} hint={s.emailVerify ? "A new email needs a code to verify it." : undefined} />}
      {s.address !== "hidden" && (
        <fieldset className="space-y-3 pt-1">
          <legend className="mb-2 text-[13px] font-semibold">Address{req(s.address) ? "" : " (optional)"}</legend>
          <Field label="House no., street, area" name="address1" defaultValue={c.address?.address1 ?? ""} required={req(s.address)} />
          {s.addressLine2 && <Field label="Apartment, floor (optional)" name="address2" defaultValue={c.address?.address2 ?? ""} />}
          {s.landmark && <Field label="Landmark (optional)" name="landmark" defaultValue={c.address?.landmark ?? ""} />}
          <div className="grid grid-cols-2 gap-3">
            <Field label="City" name="city" defaultValue={c.address?.city ?? ""} required={req(s.address)} />
            <Field label="Pincode" name="pincode" inputMode="numeric" maxLength={6} defaultValue={c.address?.pincode ?? ""} required={req(s.address)} />
          </div>
          <label className="block text-[13px] font-medium">State
            <select name="state" defaultValue={c.address?.state ?? ""} className="mt-1.5 h-11 w-full rounded-xl border-0 px-3 text-[14px] ring-1 ring-black/15 outline-none focus:ring-2 focus:ring-[rgb(var(--brand))]">
              <option value="">Select state</option>{d.states.map((st) => <option key={st.code} value={st.code}>{st.name}</option>)}
            </select>
          </label>
        </fieldset>
      )}
      <div className="flex gap-2 pt-1"><Submit>Save</Submit>{onCancel && <button type="button" onClick={onCancel} className="h-11 rounded-xl px-4 text-[13px] font-medium text-ink-soft ring-1 ring-black/10">Cancel</button>}</div>
    </Form>
  );
}

// ---------------- one order ----------------

type OrderData = {
  store: StoreInfo;
  order: { name: string; at: string; total: number; items: { title: string; variant: string | null; image: string | null; qty: number; price: number; free: boolean }[]; headline: string; tone: string; steps: TrackStep[];
    method: string; toCollect: number; shipping: number; subtotal: number; address: string; courier: string | null; awb: string | null; track: string | null; live: string | null; note: string | null };
};

export function AccountOrderPage() {
  const { store, order: o } = useLoaderData<OrderData>();
  const cancelled = o.tone === "bad";
  const doneCount = o.steps.filter((s) => s.done).length;
  return (
    <AccountShell store={store}>
      <Link to={store.account} className="text-[13px] font-medium text-ink-soft hover:text-ink">← My orders</Link>
      <div className="mt-3 flex flex-wrap items-end justify-between gap-2">
        <div><h1 className="text-[26px] font-semibold tracking-tight">Order {o.name}</h1><p className="text-[13px] text-ink-soft">Placed on {when(o.at)}</p></div>
        <StatusChip text={o.headline} tone={o.tone} big />
      </div>

      <Card className="mt-5">
        <ol className="relative">
          {o.steps.map((s, i) => (
            <li key={s.key} className="relative flex gap-4 pb-6 last:pb-0">
              {i < o.steps.length - 1 && <span className={`absolute left-[11px] top-6 h-[calc(100%-12px)] w-0.5 ${i < doneCount - 1 ? (cancelled ? "bg-bad" : "bg-[rgb(var(--brand))]") : "bg-black/10"}`} />}
              <span className={`relative z-10 flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${s.done ? (cancelled && i === o.steps.length - 1 ? "bg-bad text-white" : "bg-[rgb(var(--brand))] text-white") : "bg-white ring-2 ring-black/10"}`}>
                {s.done && <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12.5 10 17 19 7" /></svg>}
              </span>
              <div className="-mt-0.5"><p className={`text-[14px] ${s.done ? "font-semibold" : "text-ink-faint"}`}>{s.label}</p>{s.at && <p className="text-[12px] text-ink-faint">{when(s.at)}</p>}</div>
            </li>
          ))}
        </ol>
        {(o.awb || o.live) && (
          <div className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-xl bg-[#f6f6f4] px-4 py-3 text-[13px]">
            <div>{o.courier && <p className="font-medium">{o.courier}{o.awb ? ` · AWB ${o.awb}` : ""}</p>}{o.live && <p className="text-ink-soft">Latest: {o.live}</p>}</div>
            {o.track && <a href={o.track} target="_blank" rel="noreferrer" className="btn-primary h-9 px-4 text-[13px]">Track on {o.courier ?? "courier"} ↗</a>}
          </div>
        )}
      </Card>

      {o.note && (
        <div className="mt-4 rounded-2xl bg-[rgb(var(--brand)/.06)] p-5 ring-1 ring-[rgb(var(--brand)/.2)]">
          <p className="text-[12px] font-semibold uppercase tracking-wide text-ink-soft">Note from {store.name}</p>
          <p className="mt-1 whitespace-pre-line text-[14px]">{o.note}</p>
        </div>
      )}

      <Card className="mt-4">
        <ul className="space-y-3">
          {o.items.map((l, i) => (
            <li key={i} className="flex items-center gap-3">
              <span className="h-14 w-14 shrink-0 overflow-hidden rounded-lg bg-[#f1f1ef]">{l.image && <img src={l.image} alt="" className="h-full w-full object-cover" />}</span>
              <div className="min-w-0 flex-1"><p className="line-clamp-2 text-[14px] font-medium">{l.title}</p>{l.variant && <p className="text-[12px] text-ink-faint">{l.variant}</p>}</div>
              <p className="num text-[13.5px]">{l.free ? <b className="text-good">FREE</b> : `${formatINR(l.price)} × ${l.qty}`}</p>
            </li>
          ))}
        </ul>
        <dl className="num mt-5 space-y-1.5 border-t border-black/[.06] pt-4 text-[13.5px]">
          <div className="flex justify-between"><dt className="text-ink-soft">Items</dt><dd>{formatINR(o.subtotal)}</dd></div>
          <div className="flex justify-between"><dt className="text-ink-soft">Delivery</dt><dd>{o.shipping ? formatINR(o.shipping) : "Free"}</dd></div>
          <div className="flex justify-between text-[15px] font-semibold"><dt>Total</dt><dd>{formatINR(o.total)}</dd></div>
          {o.toCollect > 0 && <div className="flex justify-between text-ink-soft"><dt>To pay on delivery</dt><dd>{formatINR(o.toCollect)}</dd></div>}
        </dl>
      </Card>

      <Card className="mt-4"><p className="text-[12px] font-semibold uppercase tracking-wide text-ink-soft">Delivery address</p><p className="mt-1.5 whitespace-pre-line text-[14px]">{o.address}</p></Card>
    </AccountShell>
  );
}

// ---------------- bits ----------------

function NameFields({ s, first = "", last = "" }: { s: AccountSettings; first?: string; last?: string }) {
  if (s.name === "none") return null;
  const opt = s.nameRequired ? "" : " (optional)";
  if (s.name === "first") return <Field label={`Name${opt}`} name="firstName" autoComplete="name" defaultValue={first} required={s.nameRequired} />;
  return (
    <div className="grid grid-cols-2 gap-3">
      <Field label={`First name${opt}`} name="firstName" autoComplete="given-name" defaultValue={first} required={s.nameRequired} />
      <Field label={`Last name${opt}`} name="lastName" autoComplete="family-name" defaultValue={last} required={s.nameRequired} />
    </div>
  );
}

function Field({ label, hint, ...rest }: { label: string; hint?: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="block text-[13px] font-medium">{label}
      <input {...rest} className="mt-1.5 h-11 w-full rounded-xl border-0 px-3.5 text-[14px] ring-1 ring-black/15 outline-none focus:ring-2 focus:ring-[rgb(var(--brand))]" />
      {hint && <span className="mt-1 block text-[11.5px] font-normal text-ink-faint">{hint}</span>}
    </label>
  );
}

function Submit({ children }: { children: React.ReactNode }) {
  const nav = useNavigation();
  return <button className="btn-primary h-11 w-full text-[14px]" disabled={nav.state !== "idle"}>{nav.state !== "idle" ? "Please wait…" : children}</button>;
}

const Row = ({ k, v }: { k: string; v: React.ReactNode }) => <div><dt className="text-[12px] text-ink-faint">{k}</dt><dd className="mt-0.5 break-words">{v}</dd></div>;
const Verified = () => <span className="ml-1 rounded bg-emerald-50 px-1.5 py-px text-[10.5px] font-semibold text-good">Verified</span>;

function StatusChip({ text, tone, big }: { text: string; tone: string; big?: boolean }) {
  const cls = tone === "good" ? "bg-emerald-50 text-good" : tone === "bad" ? "bg-red-50 text-bad" : "bg-[rgb(var(--brand)/.08)] text-[rgb(var(--brand))]";
  return <span className={`mt-1 inline-flex items-center gap-1.5 rounded-full font-semibold ${big ? "px-3 py-1 text-[13px]" : "px-2 py-0.5 text-[11.5px]"} ${cls}`}><span className="h-1.5 w-1.5 rounded-full bg-current" />{text}</span>;
}
