// Super admin → Store PINs: put a 4- or 6-digit PIN on any store. The admin panel opens as usual; a store with a PIN
// asks for it before any of its pages open. Owners and their team never see it.
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Form, Link, useActionData, useLoaderData, useNavigation } from "@remix-run/react";
import { asc, eq } from "drizzle-orm";
import { useEffect, useMemo, useState } from "react";
import { Notice, PageHeader } from "~/components/ui";
import { db, stores, users } from "~/db.server";
import { adminEmail, requireSuperAdmin } from "~/lib/auth.server";
import { parseContact } from "~/lib/owner-otp.server";
import { storeCode } from "~/lib/store-code";
import { PIN_LENGTHS } from "~/lib/store-pin";
import { checkPin, lockedFor, maskContact, removePin, rightTry, savePin, validPin, weakPin, wrongTry } from "~/lib/store-pin.server";

export async function loader({ request }: LoaderFunctionArgs) {
  await requireSuperAdmin(request);
  const rows = await db.select({
    id: stores.id, name: stores.name, active: stores.active, len: stores.adminPinLen, hash: stores.adminPinHash, contact: stores.adminPinContact, at: stores.adminPinSetAt,
    owner: users.name,
  }).from(stores).leftJoin(users, eq(users.id, stores.ownerId)).orderBy(asc(stores.name));
  const me = adminEmail();
  return json({
    stores: rows.map((r) => ({ id: r.id, code: storeCode(r.id), name: r.name, owner: r.owner ?? "", active: r.active, on: Boolean(r.hash), len: r.len ?? null, recovery: maskContact(r.contact), at: r.at?.toISOString() ?? null })),
    defaultContact: me.includes("@") ? me : "",
  });
}

type Result = { ok: true; id: number; msg: string } | { ok: false; id: number; error: string };

export async function action({ request }: ActionFunctionArgs) {
  await requireSuperAdmin(request);
  const fd = await request.formData();
  const id = Number(fd.get("id"));
  const intent = String(fd.get("intent") ?? "");
  const [s] = Number.isInteger(id) ? await db.select().from(stores).where(eq(stores.id, id)).limit(1) : [];
  if (!s) return json<Result>({ ok: false, id, error: "Store not found." }, { status: 404 });
  const fail = (error: string, status = 400) => json<Result>({ ok: false, id, error }, { status });

  // Changing or removing an existing PIN needs the current one
  if (s.adminPinHash && (intent === "set" || intent === "remove")) {
    const wait = lockedFor(s.id);
    if (wait) return fail(`Too many wrong tries. Try again in ${wait} min, or reset it with Forgot PIN.`, 429);
    if (!checkPin(String(fd.get("current") ?? ""), s.adminPinHash)) {
      const left = wrongTry(s.id);
      return fail(left ? `Current PIN is wrong. ${left} ${left === 1 ? "try" : "tries"} left.` : "Too many wrong tries. Try again in 15 min.");
    }
    rightTry(s.id);
  }

  if (intent === "remove") {
    await removePin(s.id);
    return json<Result>({ ok: true, id, msg: `PIN removed. ${s.name} opens without a PIN now.` });
  }
  if (intent === "set") {
    const len = Number(fd.get("len"));
    if (!PIN_LENGTHS.includes(len as 4 | 6)) return fail("Choose 4 or 6 digits.");
    const pin = String(fd.get("pin") ?? "");
    if (!validPin(pin, len)) return fail(`Enter exactly ${len} digits.`);
    if (weakPin(pin)) return fail("Too easy to guess. Avoid 1234, 0000 and similar.");
    if (pin !== String(fd.get("confirm") ?? "")) return fail("The two PINs don't match.");
    const raw = String(fd.get("contact") ?? "").trim();
    const c = parseContact(raw);
    if (!c) return fail("Enter a 10-digit mobile number or an email for Forgot PIN codes.");
    await savePin(s.id, pin, len, c.target);
    return json<Result>({ ok: true, id, msg: `${s.name} now asks for its ${len}-digit PIN.` });
  }
  return fail("Unknown action.");
}

type Row = ReturnType<typeof useLoaderData<typeof loader>>["stores"][number];

function PinForm({ row, defaultContact, onDone }: { row: Row; defaultContact: string; onDone: () => void }) {
  const nav = useNavigation();
  const r = useActionData<typeof action>() as Result | undefined;
  const mine = r && r.id === row.id ? r : undefined;
  const [len, setLen] = useState<4 | 6>((row.len as 4 | 6) ?? 4);
  const busy = nav.state !== "idle" && Number(nav.formData?.get("id")) === row.id;
  useEffect(() => { if (mine?.ok) onDone(); }, [mine, onDone]);
  const digits = { inputMode: "numeric" as const, pattern: "\\d*", type: "password", autoComplete: "off", className: "input num tracking-[.4em]" };
  return (
    <div className="mt-3 space-y-4 rounded-xl border border-line bg-surface-2/50 p-4">
      {mine && !mine.ok && <Notice tone="error">{mine.error}</Notice>}
      <Form method="post" className="space-y-3">
        <input type="hidden" name="id" value={row.id} />
        <input type="hidden" name="len" value={len} />
        {row.on && (
          <label className="block">
            <span className="mb-1 block text-[12.5px] font-medium text-ink-muted">Current PIN</span>
            <input name="current" maxLength={6} required {...digits} />
          </label>
        )}
        <div>
          <span className="mb-1 block text-[12.5px] font-medium text-ink-muted">PIN length</span>
          <div className="inline-flex rounded-lg border border-line bg-white p-0.5">
            {PIN_LENGTHS.map((n) => (
              <button key={n} type="button" onClick={() => setLen(n)} className={`rounded-md px-3.5 py-1.5 text-[13px] font-medium ${len === n ? "bg-ink text-white" : "text-ink-muted"}`}>{n} digits</button>
            ))}
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1 block text-[12.5px] font-medium text-ink-muted">{row.on ? "New PIN" : "PIN"}</span>
            <input key={`p${len}`} name="pin" maxLength={len} minLength={len} required {...digits} />
          </label>
          <label className="block">
            <span className="mb-1 block text-[12.5px] font-medium text-ink-muted">Enter it again</span>
            <input key={`c${len}`} name="confirm" maxLength={len} minLength={len} required {...digits} />
          </label>
        </div>
        <label className="block">
          <span className="mb-1 block text-[12.5px] font-medium text-ink-muted">Forgot PIN code goes to</span>
          <input name="contact" defaultValue={defaultContact} placeholder="Mobile number or email" required className="input" />
          <span className="mt-1 block text-[12px] text-ink-faint">If the PIN is forgotten, a code is sent here to set a new one.</span>
        </label>
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <button type="submit" name="intent" value="set" disabled={busy} className="btn-primary">{busy && nav.formData?.get("intent") === "set" ? "Saving…" : row.on ? "Change PIN" : "Turn on PIN"}</button>
          {row.on && <button type="submit" name="intent" value="remove" formNoValidate disabled={busy} className="btn-secondary text-[#b42318]">{busy && nav.formData?.get("intent") === "remove" ? "Removing…" : "Remove PIN"}</button>}
          {row.on && <Link to={`/unlock/${row.code}`} className="ml-auto text-[12.5px] font-medium text-brand">Forgot PIN?</Link>}
        </div>
        {row.on && <p className="text-[12px] text-ink-faint">Removing needs only the current PIN.</p>}
      </Form>
    </div>
  );
}

export default function StorePins() {
  const d = useLoaderData<typeof loader>();
  const r = useActionData<typeof action>() as Result | undefined;
  const [open, setOpen] = useState<number | null>(null);
  const [q, setQ] = useState("");
  const list = useMemo(() => {
    const t = q.trim().toLowerCase();
    return d.stores.filter((s) => !t || s.name.toLowerCase().includes(t) || s.owner.toLowerCase().includes(t));
  }, [d.stores, q]);
  const on = d.stores.filter((s) => s.on).length;

  return (
    <div className="space-y-5">
      <PageHeader title="Store PINs" icon="lock" description="Put a PIN on any store. The admin panel opens as usual; a store with a PIN asks for it before any of its pages open. Store owners and their team are never asked." />
      {r?.ok && <Notice tone="success">{r.msg}</Notice>}
      <div className="card overflow-hidden">
        <div className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-3 sm:px-5">
          <p className="text-[13.5px] text-ink-muted"><b className="font-semibold text-ink">{on}</b> of {d.stores.length} stores have a PIN</p>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search stores" className="input ml-auto h-9 w-full sm:w-64" />
        </div>
        <ul className="divide-y divide-line">
          {list.map((s) => (
            <li key={s.id} className="px-4 py-3.5 sm:px-5">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg ${s.on ? "bg-[#06261f] text-white" : "bg-surface-2 text-ink-faint"}`}>
                  <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth="1.9">{s.on ? <><rect x="4" y="10" width="16" height="11" rx="2.5" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /></> : <><rect x="4" y="10" width="16" height="11" rx="2.5" /><path d="M8 10V7a4 4 0 0 1 7.5-2" /></>}</svg>
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[14px] font-semibold text-ink">{s.name}{!s.active && <span className="ml-2 text-[11.5px] font-medium text-ink-faint">Off</span>}</p>
                  <p className="truncate text-[12.5px] text-ink-muted">
                    {s.owner || "No owner"}
                    {s.on && <> · {s.len}-digit PIN{s.recovery ? ` · codes to ${s.recovery}` : ""}{s.at ? ` · set ${new Date(s.at).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}` : ""}</>}
                  </p>
                </div>
                <span className={`rounded-full px-2.5 py-1 text-[12px] font-semibold ${s.on ? "bg-[#e3f4ec] text-[#0c6b47]" : "bg-surface-2 text-ink-muted"}`}>{s.on ? "PIN on" : "No PIN"}</span>
                <button type="button" onClick={() => setOpen(open === s.id ? null : s.id)} className="btn-secondary h-9 px-3 text-[13px]">
                  {open === s.id ? "Close" : s.on ? "Change" : "Set PIN"}
                </button>
              </div>
              {open === s.id && <PinForm row={s} defaultContact={d.defaultContact} onDone={() => setOpen(null)} />}
            </li>
          ))}
          {!list.length && <li className="px-5 py-10 text-center text-[13.5px] text-ink-muted">No store matches “{q}”.</li>}
        </ul>
      </div>
      <p className="px-1 text-[12.5px] text-ink-faint">An opened store stays open in this browser for 12 hours, until you log out, or until its PIN changes. After 5 wrong tries the PIN screen waits 15 minutes.</p>
    </div>
  );
}
