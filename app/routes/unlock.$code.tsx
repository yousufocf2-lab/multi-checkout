// PIN screen for a store protected with a super admin PIN. Only the Growpefy admin (and platform staff) see it.
import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { Form, useActionData, useLoaderData, useNavigation } from "@remix-run/react";
import { eq } from "drizzle-orm";
import { useEffect, useRef, useState } from "react";
import { OtpStep } from "~/components/OtpAuth";
import { Notice } from "~/components/ui";
import { db, stores, type Store } from "~/db.server";
import { requireAdmin } from "~/lib/auth.server";
import { clientIp } from "~/lib/orders.server";
import { ownerWidget, parseContact, sendOwnerOtp, showContact, verifyOwnerOtp } from "~/lib/owner-otp.server";
import { selectCookie } from "~/lib/selection.server";
import { storeIdFromCode, storePath } from "~/lib/store-code";
import { checkPin, isUnlocked, readUnlocks, lockedFor, maskContact, resetTicket, rightTry, savePin, ticketOk, unlockHeader, validPin, weakPin, wrongTry } from "~/lib/store-pin.server";

export const meta: MetaFunction = () => [{ title: "Enter store PIN · Growpefy" }, { name: "robots", content: "noindex" }];

async function load(request: Request, code: string | undefined) {
  await requireAdmin(request);
  const id = storeIdFromCode(code);
  const [s] = id ? await db.select().from(stores).where(eq(stores.id, id)).limit(1) : [];
  if (!s) throw new Response("Store not found", { status: 404 });
  const raw = new URL(request.url).searchParams.get("next") ?? "";
  const next = raw.startsWith("/") && !raw.startsWith("//") ? raw : storePath(s.id);
  return { s, next };
}

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { s, next } = await load(request, params.code);
  if (!s.adminPinHash || isUnlocked(await readUnlocks(request), s)) throw redirect(next);
  return json({ name: s.name, logo: s.logoUrl, len: s.adminPinLen ?? 4, recovery: maskContact(s.adminPinContact), locked: lockedFor(s.id) });
}

type Data =
  | { stage: "pin"; error?: string }
  | { stage: "otp"; shown: string; resendIn?: number; codeError?: string; widget?: { widgetId: string; tokenAuth: string } | null; phone?: string }
  | { stage: "new"; ticket: string; error?: string };

const recovery = (s: Store) => (s.adminPinContact ? parseContact(s.adminPinContact) : null);

export async function action({ request, params }: ActionFunctionArgs) {
  const { s, next } = await load(request, params.code);
  const fd = await request.formData();
  const intent = String(fd.get("intent") ?? "");

  if (intent === "leave") return redirect("/dashboard", { headers: { "Set-Cookie": await selectCookie(null) } });

  if (intent === "pin") {
    const wait = lockedFor(s.id);
    if (wait) return json<Data>({ stage: "pin", error: `Too many wrong tries. Try again in ${wait} min, or use Forgot PIN.` }, { status: 429 });
    const pin = String(fd.get("pin") ?? "");
    if (!checkPin(pin, s.adminPinHash)) {
      const left = wrongTry(s.id);
      return json<Data>({ stage: "pin", error: left ? `Wrong PIN. ${left} ${left === 1 ? "try" : "tries"} left.` : "Too many wrong tries. Try again in 15 min, or use Forgot PIN." }, { status: 400 });
    }
    rightTry(s.id);
    return redirect(next, { headers: { "Set-Cookie": await unlockHeader(request, s) } });
  }

  // Forgot PIN: OTP to the recovery contact saved with the PIN
  const c = recovery(s);
  if (intent === "forgot" || intent === "send" || intent === "verify") {
    if (!c) return json<Data>({ stage: "pin", error: "No recovery mobile or email was saved with this PIN. Remove the PIN from Settings → Store PINs." }, { status: 400 });
    const widget = await ownerWidget(c);
    const phone = c.channel === "phone" ? c.target : undefined;
    if (intent !== "verify") {
      const r = await sendOwnerOtp(c, "reset", clientIp(request));
      if (!r.ok && !r.resendIn) return json<Data>({ stage: "pin", error: r.error }, { status: 400 });
      return json<Data>({ stage: "otp", shown: showContact(c), resendIn: r.resendIn, codeError: r.ok ? undefined : r.error, widget, phone });
    }
    const v = await verifyOwnerOtp(c, "reset", String(fd.get("code") ?? ""), String(fd.get("token") ?? "") || undefined);
    if (!v.ok) return json<Data>({ stage: "otp", shown: showContact(c), codeError: v.error, widget, phone }, { status: 400 });
    return json<Data>({ stage: "new", ticket: resetTicket(s) });
  }

  if (intent === "new") {
    const ticket = String(fd.get("ticket") ?? "");
    if (!ticketOk(ticket, s)) return json<Data>({ stage: "pin", error: "That took too long. Start again with Forgot PIN." }, { status: 400 });
    const len = s.adminPinLen ?? 4;
    const pin = String(fd.get("pin") ?? "");
    const again = String(fd.get("confirm") ?? "");
    if (!validPin(pin, len)) return json<Data>({ stage: "new", ticket, error: `Enter ${len} digits.` }, { status: 400 });
    if (weakPin(pin)) return json<Data>({ stage: "new", ticket, error: "Too easy to guess. Avoid 1234 or repeated digits." }, { status: 400 });
    if (pin !== again) return json<Data>({ stage: "new", ticket, error: "The two PINs don't match." }, { status: 400 });
    await savePin(s.id, pin, len, s.adminPinContact);
    const [fresh] = await db.select().from(stores).where(eq(stores.id, s.id)).limit(1);
    return redirect(next, { headers: { "Set-Cookie": await unlockHeader(request, fresh) } });
  }
  return json<Data>({ stage: "pin" });
}

function PinBoxes({ len, name, autoFocus, submitOnFull }: { len: number; name: string; autoFocus?: boolean; submitOnFull?: boolean }) {
  const [v, setV] = useState("");
  const ref = useRef<HTMLInputElement>(null);
  return (
    <label className="relative block cursor-text" onClick={() => ref.current?.focus()}>
      <input ref={ref} name={name} value={v} autoFocus={autoFocus} inputMode="numeric" autoComplete="off" type="password" maxLength={len} aria-label={`${len}-digit PIN`}
        onChange={(e) => {
          const d = e.target.value.replace(/\D/g, "").slice(0, len);
          setV(d);
          if (submitOnFull && d.length === len) setTimeout(() => e.target.form?.requestSubmit(), 60);
        }}
        className="absolute inset-0 h-full w-full opacity-0" />
      <span className="flex justify-center gap-2">
        {Array.from({ length: len }, (_, i) => (
          <span key={i} className={`grid h-14 min-w-0 max-w-[3rem] flex-1 place-items-center rounded-xl border-2 bg-white text-2xl ${i === v.length ? "border-ink" : "border-line"}`}>
            {i < v.length ? "•" : ""}
          </span>
        ))}
      </span>
    </label>
  );
}

export default function Unlock() {
  const d = useLoaderData<typeof loader>();
  const a = useActionData<typeof action>() as Data | undefined;
  const nav = useNavigation();
  const [stage, setStage] = useState<Data["stage"]>(a?.stage ?? "pin");
  useEffect(() => { if (a?.stage) setStage(a.stage); }, [a]);
  const busy = nav.state !== "idle";
  const err = a && "error" in a ? a.error : undefined;

  return (
    <main className="grid min-h-screen place-items-center bg-[#f6f6f4] px-4 py-10">
      <div className="w-full max-w-[400px] rounded-2xl border border-line bg-white p-6 shadow-[0_20px_50px_-30px_rgba(0,0,0,.35)] sm:p-8">
        <div className="flex flex-col items-center text-center">
          <span className="grid h-14 w-14 place-items-center overflow-hidden rounded-2xl bg-[#06261f] text-white">
            {d.logo ? <img src={d.logo} alt="" className="h-full w-full bg-white object-contain" /> : <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="4" y="10" width="16" height="11" rx="2.5" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /></svg>}
          </span>
          <h1 className="mt-4 text-[20px] font-semibold text-ink">{stage === "new" ? "Set a new PIN" : stage === "otp" ? "Enter the code" : "Enter store PIN"}</h1>
          <p className="mt-1 text-[13.5px] text-ink-muted">
            {stage === "otp" && a?.stage === "otp" ? `We sent a code to ${a.shown}.`
              : stage === "new" ? `Choose a new ${d.len}-digit PIN for ${d.name}.`
              : <><b className="font-semibold text-ink">{d.name}</b> is protected. Enter its {d.len}-digit PIN to open it.</>}
          </p>
        </div>

        <div className="mt-6">
          {stage === "pin" && (
            <>
              <Form method="post" className="space-y-4">
                <input type="hidden" name="intent" value="pin" />
                {err && <Notice tone="error">{err}</Notice>}
                {!err && d.locked > 0 && <Notice tone="warning">Too many wrong tries. Try again in {d.locked} min, or use Forgot PIN.</Notice>}
                <PinBoxes len={d.len} name="pin" autoFocus submitOnFull />
                <button type="submit" disabled={busy} className="btn-primary w-full py-3">{busy && nav.formData?.get("intent") === "pin" ? "Checking…" : "Open store"}</button>
              </Form>
              <Form method="post" className="mt-4 text-center">
                <input type="hidden" name="intent" value="forgot" />
                <button type="submit" disabled={busy || !d.recovery} className="text-[13.5px] font-medium text-brand disabled:text-ink-faint">
                  {busy && nav.formData?.get("intent") === "forgot" ? "Sending code…" : d.recovery ? `Forgot PIN? Get a code on ${d.recovery}` : "Forgot PIN? No recovery contact saved"}
                </button>
              </Form>
            </>
          )}
          {stage === "otp" && a?.stage === "otp" && (
            <OtpStep hidden={{}} error={a.codeError} resendIn={a.resendIn} onChange={() => setStage("pin")} submitLabel="Verify code" widget={a.widget} phone={a.phone} />
          )}
          {stage === "new" && a?.stage === "new" && (
            <Form method="post" className="space-y-4">
              <input type="hidden" name="intent" value="new" />
              <input type="hidden" name="ticket" value={a.ticket} />
              {err && <Notice tone="error">{err}</Notice>}
              <p className="text-[12.5px] font-medium text-ink-muted">New PIN</p>
              <PinBoxes len={d.len} name="pin" autoFocus />
              <p className="text-[12.5px] font-medium text-ink-muted">Enter it again</p>
              <PinBoxes len={d.len} name="confirm" />
              <button type="submit" disabled={busy} className="btn-primary w-full py-3">{busy ? "Saving…" : "Save PIN and open store"}</button>
            </Form>
          )}
        </div>

        <Form method="post" className="mt-6 border-t border-line pt-4 text-center">
          <input type="hidden" name="intent" value="leave" />
          <button type="submit" className="text-[13px] text-ink-muted hover:text-ink">← Back to the admin panel</button>
        </Form>
        <Form method="post" action="/logout" className="mt-2 text-center"><button type="submit" className="text-[12px] text-ink-faint hover:text-ink-muted">Log out</button></Form>
      </div>
    </main>
  );
}
