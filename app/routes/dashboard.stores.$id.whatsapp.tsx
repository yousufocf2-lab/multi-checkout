// Store's WhatsApp page: verification for Growpefy's WhatsApp number + abandoned cart messages.
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Form, Link, useActionData, useLoaderData, useNavigation } from "@remix-run/react";
import { and, asc, count, eq } from "drizzle-orm";
import { useRef, useState } from "react";
import { Notice, SubmitButton } from "~/components/ui";
import { db, storeDocuments, stores } from "~/db.server";
import { requireStore, requireViewer } from "~/lib/auth.server";
import { recoveryStats } from "~/lib/recovery.server";
import { messaging } from "~/lib/rto.server";
import { rupees } from "~/lib/wallet";
import { getWallet, ratesFor } from "~/lib/wallet.server";
import {
  RECOVERY_DEFAULT, VERIFY_DOC_LIMIT, VERIFY_DOC_MAX, VERIFY_DOC_TYPES, VERIFY_LABEL,
  cleanVideoUrl, fmtDelay, recoveryError, resolveRecovery, verifyStatus,
} from "~/lib/whatsapp-gate";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const viewer = await requireViewer(request);
  const store = await requireStore(viewer, params.id);
  const ist = new Date(Date.now() + 5.5 * 3600_000);
  const monthStart = new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), 1) - 5.5 * 3600_000);
  const [docs, m, rates, stats] = await Promise.all([
    db.select({ id: storeDocuments.id, filename: storeDocuments.filename, size: storeDocuments.size, createdAt: storeDocuments.createdAt })
      .from(storeDocuments).where(and(eq(storeDocuments.storeId, store.id), eq(storeDocuments.purpose, "wa_verify"))).orderBy(asc(storeDocuments.createdAt)),
    messaging(), getWallet(store.id).then(ratesFor), recoveryStats(store.id, monthStart),
  ]);
  const v = store.waVerify ?? {};
  return json({
    storeId: store.id, isAdmin: viewer.role === "admin",
    verify: { status: verifyStatus(v), videoUrl: v.videoUrl ?? "", storeNote: v.storeNote ?? "", adminNote: v.adminNote ?? "", submittedAt: v.submittedAt ?? null },
    docs: docs.map((d) => ({ ...d, createdAt: d.createdAt.toISOString() })),
    recovery: resolveRecovery(store.recovery),
    recoveryReady: Boolean(m.waPhoneNumberId && m.waToken && m.waRecoveryTemplate),
    price: rates.waRecovery ?? 250,
    stats,
  });
}

function sniff(buf: Buffer): string | null {
  if (buf.subarray(0, 4).toString("latin1") === "%PDF") return "application/pdf";
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (buf.subarray(0, 4).toString("latin1") === "RIFF" && buf.subarray(8, 12).toString("latin1") === "WEBP") return "image/webp";
  return null;
}

type Result = { ok: string | null; error: string | null; form: string };

export async function action({ request, params }: ActionFunctionArgs) {
  const viewer = await requireViewer(request);
  const store = await requireStore(viewer, params.id);
  const fd = await request.formData();
  const intent = String(fd.get("intent") ?? "");
  const res = (ok: string | null, error: string | null = null) => json<Result>({ ok, error, form: intent }, { status: error ? 400 : 200 });

  if (intent === "verify") {
    if (store.waVerify?.status === "approved") return res("Your store is already verified");
    const videoUrl = cleanVideoUrl(String(fd.get("videoUrl") ?? ""));
    if (!videoUrl) return res(null, "Paste the full link to your stock video (https://…). Google Drive, YouTube (unlisted) or Dropbox all work.");
    const storeNote = String(fd.get("storeNote") ?? "").trim().slice(0, 1500);
    if (storeNote.length < 20) return res(null, "Tell us a little about your business: what you sell, where you keep stock, and your monthly orders");
    const files = fd.getAll("docs").filter((f): f is File => f instanceof File && f.size > 0);
    const [{ n }] = await db.select({ n: count() }).from(storeDocuments).where(and(eq(storeDocuments.storeId, store.id), eq(storeDocuments.purpose, "wa_verify")));
    if (Number(n) + files.length > VERIFY_DOC_LIMIT) return res(null, `You can add up to ${VERIFY_DOC_LIMIT} documents`);
    for (const f of files) {
      if (f.size > VERIFY_DOC_MAX) return res(null, `${f.name} is over 5 MB. Upload a smaller photo or PDF.`);
      const buf = Buffer.from(await f.arrayBuffer());
      const mime = sniff(buf);
      if (!mime || !VERIFY_DOC_TYPES.includes(mime)) return res(null, `${f.name}: upload a PDF, JPG, PNG or WEBP file`);
      await db.insert(storeDocuments).values({ storeId: store.id, purpose: "wa_verify", filename: f.name.slice(0, 120) || "document", mime, size: buf.length, data: buf });
    }
    const docs = Number(n) + files.length;
    if (!docs) return res(null, "Add at least one document: GST certificate, purchase invoice, or a photo of your stock or warehouse");
    await db.update(stores).set({ waVerify: { ...store.waVerify, status: "submitted", videoUrl, storeNote, submittedAt: new Date().toISOString() } }).where(eq(stores.id, store.id));
    return res("Sent for review. We usually check within 1 working day.");
  }

  if (intent === "removeDoc") {
    if (store.waVerify?.status === "approved") return res(null, "Your store is verified, documents can't be changed");
    await db.delete(storeDocuments).where(and(eq(storeDocuments.id, Number(fd.get("docId"))), eq(storeDocuments.storeId, store.id)));
    return res("Document removed");
  }

  if (intent === "recovery") {
    const on = fd.get("on") === "on";
    const count = fd.get("count") === "2" ? 2 : 1;
    const delays = [1, 2].slice(0, count).map((i) => {
      const v = Number(fd.get(`d${i}`));
      const unit = String(fd.get(`u${i}`));
      return Math.round(v * (unit === "days" ? 1440 : unit === "hours" ? 60 : 1));
    });
    const err = recoveryError(delays);
    if (err) return res(null, err);
    await db.update(stores).set({ recovery: { on, delays } }).where(eq(stores.id, store.id));
    return res(on ? "Abandoned cart messages are on" : "Abandoned cart messages are off");
  }
  return res(null, "Unknown action");
}

type D = ReturnType<typeof useLoaderData<typeof loader>>;

const CHIP: Record<string, string> = {
  none: "bg-paper-sunk text-ink-soft", submitted: "bg-amber-50 text-amber-800", requested: "bg-orange-50 text-orange-800",
  approved: "bg-emerald-50 text-good", rejected: "bg-red-50 text-bad",
};

export default function WhatsappPage() {
  const d = useLoaderData<typeof loader>();
  const r = useActionData<typeof action>();
  const msg = (form: string) => (r?.form === form ? (r.ok ? <Notice tone="success">{r.ok}</Notice> : r.error ? <Notice tone="error">{r.error}</Notice> : null) : null);
  return (
    <div className="max-w-3xl space-y-5">
      <Verification d={d} msg={msg} />
      <Recovery d={d} msg={msg} />
    </div>
  );
}

function Verification({ d, msg }: { d: D; msg: (f: string) => React.ReactNode }) {
  const v = d.verify;
  const approved = v.status === "approved";
  const fileRef = useRef<HTMLInputElement>(null);
  const [picked, setPicked] = useState<File[]>([]);
  const [localErr, setLocalErr] = useState<string | null>(null);
  const nav = useNavigation();
  const sending = nav.state !== "idle" && nav.formData?.get("intent") === "verify";
  const pick = (list: FileList | null) => {
    const files = [...(list ?? [])];
    const bad = files.find((f) => f.size > VERIFY_DOC_MAX || !VERIFY_DOC_TYPES.includes(f.type));
    setLocalErr(bad ? `${bad.name}: use a PDF, JPG, PNG or WEBP under 5 MB` : null);
    setPicked(files);
  };
  return (
    <section className="panel overflow-hidden">
      <div className="flex flex-wrap items-start gap-3 border-b border-rule px-5 py-4">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-pine-tint text-xl" aria-hidden>🛡️</span>
        <div className="min-w-0 flex-1">
          <h2 className="flex flex-wrap items-center gap-2 text-[15px] font-semibold">WhatsApp verification
            <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${CHIP[v.status]}`}>{approved ? "✓ " : ""}{VERIFY_LABEL[v.status]}</span></h2>
          <p className="mt-0.5 text-xs leading-relaxed text-ink-soft">Order confirmations, inbox replies and abandoned cart messages go out from Growpefy's WhatsApp number. To keep that number safe for every store, we check each store once before turning messages on.</p>
        </div>
      </div>

      {approved ? (
        <p className="px-5 py-4 text-sm text-good">Your store is verified. WhatsApp messages are on.</p>
      ) : (
        <Form method="post" encType="multipart/form-data" className="space-y-4 p-5">
          <input type="hidden" name="intent" value="verify" />
          {v.adminNote && (v.status === "requested" || v.status === "rejected") && (
            <Notice tone={v.status === "rejected" ? "error" : "warning"}><b>Message from Growpefy:</b> {v.adminNote}</Notice>
          )}
          {v.status === "submitted" && <Notice tone="info">We've got your details and are checking them. You can still add more below.</Notice>}
          <label className="block">
            <span className="label">Stock video link</span>
            <input name="videoUrl" type="url" inputMode="url" className="input" defaultValue={v.videoUrl} placeholder="https://drive.google.com/…" required />
            <span className="hint">A 1–2 minute video of your stock or warehouse, with today's date written on a paper in the video. Upload to Google Drive (anyone with the link can view) or YouTube (unlisted) and paste the link.</span>
          </label>
          <label className="block">
            <span className="label">About your business</span>
            <textarea name="storeNote" rows={3} className="input" defaultValue={v.storeNote} placeholder="What you sell, where you keep stock, how many orders a month, since when" required />
          </label>
          <div>
            <span className="label">Documents</span>
            {d.docs.length > 0 && (
              <ul className="mb-2 divide-y divide-rule rounded-lg border border-rule">
                {d.docs.map((doc) => (
                  <li key={doc.id} className="flex items-center gap-2 px-3 py-2 text-sm">
                    <a href={`/dashboard/store-doc/${doc.id}`} target="_blank" rel="noreferrer" className="min-w-0 flex-1 truncate underline-offset-2 hover:underline">📄 {doc.filename}</a>
                    <span className="num text-xs text-ink-faint">{Math.ceil(doc.size / 1024)} KB</span>
                    <button form={`rm-${doc.id}`} className="btn-quiet text-xs text-bad">Remove</button>
                  </li>
                ))}
              </ul>
            )}
            <input ref={fileRef} type="file" name="docs" multiple accept=".pdf,.jpg,.jpeg,.png,.webp,application/pdf,image/jpeg,image/png,image/webp" className="sr-only" id="wa-docs" onChange={(e) => pick(e.target.files)} />
            <label htmlFor="wa-docs" className="flex cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed border-rule-strong px-4 py-5 text-center transition hover:border-brand hover:bg-pine-tint/30">
              <span className="text-sm font-medium">{picked.length ? `${picked.length} file${picked.length === 1 ? "" : "s"} selected` : "Choose files"}</span>
              <span className="text-xs text-ink-faint">GST certificate, purchase invoices, brand or trademark papers, stock photos · PDF / JPG / PNG, up to 5 MB each</span>
            </label>
            {picked.length > 0 && <p className="mt-1 truncate text-xs text-ink-soft">{picked.map((f) => f.name).join(", ")}</p>}
            {localErr && <p className="mt-1 text-xs text-bad">{localErr}</p>}
          </div>
          {msg("verify")}
          {msg("removeDoc")}
          <div className="flex justify-end">
            <button className="btn-primary" disabled={sending || Boolean(localErr)}>{sending ? "Sending…" : v.status === "none" ? "Send for verification" : "Send again"}</button>
          </div>
        </Form>
      )}
      {d.docs.map((doc) => (
        <Form key={doc.id} method="post" id={`rm-${doc.id}`} className="hidden"><input type="hidden" name="intent" value="removeDoc" /><input type="hidden" name="docId" value={doc.id} /></Form>
      ))}
    </section>
  );
}

const split = (min: number) => (min % 1440 === 0 ? { v: min / 1440, u: "days" } : min % 60 === 0 ? { v: min / 60, u: "hours" } : { v: min, u: "minutes" });

function Recovery({ d, msg }: { d: D; msg: (f: string) => React.ReactNode }) {
  const [on, setOn] = useState(d.recovery.on);
  const [count, setCount] = useState(d.recovery.delays.length === 2 ? 2 : 1);
  const delays = [...d.recovery.delays, ...(d.recovery.delays.length < 2 ? [24 * 60] : [])];
  const verified = d.verify.status === "approved";
  return (
    <Form method="post" className="panel space-y-4 p-5">
      <input type="hidden" name="intent" value="recovery" />
      <div className="flex items-center gap-4">
        <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl text-xl ${on ? "bg-pine-tint" : "bg-paper-sunk grayscale"}`} aria-hidden>🛒</span>
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-2 font-semibold">Abandoned cart messages
            <span className="rounded-full bg-pine-tint px-2 py-0.5 text-[10px] font-semibold text-pine">{rupees(d.price)}/msg · from wallet</span></p>
          <p className="text-xs text-ink-soft">A WhatsApp reminder with a link back to their cart, when a customer leaves checkout after entering their number.</p>
        </div>
        <label className="relative inline-flex shrink-0 cursor-pointer items-center" aria-label="Abandoned cart messages">
          <input type="checkbox" name="on" checked={on} onChange={(e) => setOn(e.target.checked)} className="peer sr-only" />
          <span aria-hidden className={`h-6 w-10 rounded-full transition peer-focus-visible:ring-2 peer-focus-visible:ring-brand ${on ? "bg-brand" : "bg-rule-strong"}`} />
          <span aria-hidden className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${on ? "left-[18px]" : "left-0.5"}`} />
        </label>
      </div>

      {!verified && <Notice tone="warning">Messages start once your store is verified above. You can set this up now.</Notice>}
      {verified && !d.recoveryReady && <Notice tone="info">{d.isAdmin ? <>Add the abandoned cart template in <Link className="underline" to="/dashboard/wallets">All wallets → Settings → Messaging</Link>.</> : "Abandoned cart messages are being set up by Growpefy. Your settings are saved."}</Notice>}

      <div className={`space-y-3 ${on ? "" : "pointer-events-none opacity-60"}`}>
        <div className="inline-flex rounded-lg border border-rule-strong bg-surface p-0.5" role="radiogroup" aria-label="Number of messages">
          {[1, 2].map((n) => (
            <label key={n} className={`cursor-pointer rounded-md px-3 py-1.5 text-sm ${count === n ? "bg-ink font-medium text-white" : "text-ink-soft"}`}>
              <input type="radio" name="count" value={n} checked={count === n} onChange={() => setCount(n)} className="sr-only" />{n === 1 ? "1 message" : "2 messages"}
            </label>
          ))}
        </div>
        {[1, 2].slice(0, count).map((i) => {
          const s = split(delays[i - 1] ?? RECOVERY_DEFAULT[0]);
          return (
            <div key={i} className="flex flex-wrap items-center gap-2 rounded-xl border border-rule px-4 py-3 text-sm">
              <span className="w-24 font-medium">Message {i}</span>
              <span className="text-ink-soft">send</span>
              <input name={`d${i}`} type="number" min={1} step={1} defaultValue={s.v} className="input h-9 w-20 text-center" aria-label={`Message ${i} delay`} />
              <select name={`u${i}`} defaultValue={s.u} className="input h-9 w-auto py-0 pr-8" aria-label={`Message ${i} unit`}>
                <option value="minutes">minutes</option><option value="hours">hours</option><option value="days">days</option>
              </select>
              <span className="text-ink-soft">after the customer leaves</span>
            </div>
          );
        })}
        <p className="text-xs text-ink-faint">First message: 15 minutes to 24 hours. Second: at least 1 hour after the first, within 3 days. Customers who order in between get nothing more.</p>
      </div>

      <div className="grid grid-cols-2 gap-3 rounded-xl bg-paper px-4 py-3 text-sm">
        <div><p className="text-xs text-ink-soft">Customers messaged this month</p><p className="num text-lg font-semibold">{d.stats.messaged}</p></div>
        <div><p className="text-xs text-ink-soft">Came back and ordered</p><p className="num text-lg font-semibold text-good">{d.stats.recovered}</p></div>
      </div>

      <div className="flex flex-wrap items-center justify-end gap-3 border-t border-rule pt-4">
        <div className="mr-auto min-w-0 text-sm">{msg("recovery")}</div>
        <SubmitButton intent="recovery" className="btn-primary h-9 px-4 text-sm" busyText="Saving">Save</SubmitButton>
      </div>
      <p className="sr-only">{d.recovery.delays.map(fmtDelay).join(", ")}</p>
    </Form>
  );
}
