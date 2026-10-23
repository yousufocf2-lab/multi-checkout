// Super admin: check stores before they can send WhatsApp from Growpefy's number.
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Form, Link, useActionData, useLoaderData, useSearchParams } from "@remix-run/react";
import { asc, eq } from "drizzle-orm";
import { Notice, PageHeader } from "~/components/ui";
import { db, storeDocuments, stores, users, type WaVerifyStatus } from "~/db.server";
import { requireAdmin } from "~/lib/auth.server";
import { VERIFY_LABEL, verifyStatus } from "~/lib/whatsapp-gate";

const ORDER: Record<string, number> = { submitted: 0, requested: 1, none: 2, rejected: 3, approved: 4 };

export async function loader({ request }: LoaderFunctionArgs) {
  await requireAdmin(request);
  const [list, docs, owners] = await Promise.all([
    db.select({ id: stores.id, name: stores.name, logoUrl: stores.logoUrl, url: stores.storefrontUrl, ownerId: stores.ownerId, waVerify: stores.waVerify, createdAt: stores.createdAt }).from(stores).orderBy(asc(stores.name)),
    db.select({ id: storeDocuments.id, storeId: storeDocuments.storeId, filename: storeDocuments.filename, size: storeDocuments.size, mime: storeDocuments.mime }).from(storeDocuments).where(eq(storeDocuments.purpose, "wa_verify")),
    db.select({ id: users.id, name: users.name, email: users.email, phone: users.phone, kycStatus: users.kycStatus }).from(users),
  ]);
  return json({
    stores: list.map((s) => {
      const o = owners.find((u) => u.id === s.ownerId);
      return {
        id: s.id, name: s.name, logoUrl: s.logoUrl, url: s.url, createdAt: s.createdAt.toISOString(),
        status: verifyStatus(s.waVerify), v: s.waVerify ?? {},
        owner: o ? { name: o.name, email: o.email, phone: o.phone, kyc: o.kycStatus } : null,
        docs: docs.filter((d) => d.storeId === s.id),
      };
    }).sort((a, b) => ORDER[a.status] - ORDER[b.status] || a.name.localeCompare(b.name)),
  });
}

export async function action({ request }: ActionFunctionArgs) {
  const admin = await requireAdmin(request);
  const fd = await request.formData();
  const id = Number(fd.get("storeId"));
  const decision = String(fd.get("decision") ?? "");
  const note = String(fd.get("adminNote") ?? "").trim().slice(0, 1000);
  const [store] = await db.select().from(stores).where(eq(stores.id, id)).limit(1);
  if (!store) return json({ ok: null, error: "Store not found" }, { status: 404 });
  const next: Record<string, WaVerifyStatus> = { approve: "approved", request: "requested", reject: "rejected", revoke: "requested" };
  const status = next[decision];
  if (!status) return json({ ok: null, error: "Unknown action" }, { status: 400 });
  if ((decision === "request" || decision === "reject") && note.length < 5) {
    return json({ ok: null, error: "Write a short note so the store knows what to send or why" }, { status: 400 });
  }
  await db.update(stores).set({
    waVerify: { ...store.waVerify, status, adminNote: decision === "approve" ? "" : note || "Please send your stock video and documents again.", decidedAt: new Date().toISOString(), decidedBy: admin.email || "admin" },
  }).where(eq(stores.id, id));
  const said = { approve: "approved. WhatsApp messages are on", request: "asked for more details", reject: "not approved", revoke: "WhatsApp turned off. The store has been asked to verify again" }[decision as "approve"];
  return json({ ok: `${store.name}: ${said}.`, error: null });
}

const CHIP: Record<string, string> = {
  none: "bg-paper-sunk text-ink-soft", submitted: "bg-amber-50 text-amber-800", requested: "bg-orange-50 text-orange-800",
  approved: "bg-emerald-50 text-good", rejected: "bg-red-50 text-bad",
};

export default function WaVerify() {
  const d = useLoaderData<typeof loader>();
  const res = useActionData<typeof action>();
  const [sp, setSp] = useSearchParams();
  const filter = sp.get("show") ?? "todo";
  const shown = d.stores.filter((s) => filter === "all" || (filter === "todo" ? s.status === "submitted" || s.status === "requested" : s.status === filter));
  const pending = d.stores.filter((s) => s.status === "submitted").length;
  return (
    <>
      <PageHeader title="WhatsApp approvals" description="Stores send WhatsApp from Growpefy's number only after you approve them. Check the stock video and documents first." />
      <div className="space-y-4">
        {res?.ok && <Notice tone="success">{res.ok}</Notice>}
        {res?.error && <Notice tone="error">{res.error}</Notice>}
        <div className="inline-flex flex-wrap rounded-lg border border-rule-strong bg-surface p-0.5" role="tablist">
          {[["todo", `To review${pending ? ` (${pending})` : ""}`], ["approved", "Approved"], ["none", "Not started"], ["rejected", "Not approved"], ["all", "All"]].map(([k, l]) => (
            <button key={k} type="button" role="tab" aria-selected={filter === k} onClick={() => setSp({ show: k })}
              className={`rounded-md px-3 py-1.5 text-sm ${filter === k ? "bg-ink font-medium text-white" : "text-ink-soft hover:text-ink"}`}>{l}</button>
          ))}
        </div>
        {shown.length === 0 && <p className="panel px-5 py-10 text-center text-sm text-ink-faint">Nothing here.</p>}
        {shown.map((s) => (
          <section key={s.id} className="panel">
            <div className="flex flex-wrap items-center gap-3 border-b border-rule px-5 py-3.5">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-rule bg-surface text-xs font-semibold">{s.logoUrl ? <img src={s.logoUrl} alt="" className="h-full w-full object-contain p-0.5" /> : s.name.slice(0, 1)}</span>
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-2 font-medium">{s.name}<span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${CHIP[s.status]}`}>{VERIFY_LABEL[s.status]}</span></p>
                <p className="truncate text-xs text-ink-faint"><a href={s.url} target="_blank" rel="noreferrer" className="hover:underline">{s.url.replace(/^https?:\/\//, "")}</a>
                  {s.owner && <> · {s.owner.name} · {s.owner.phone || s.owner.email} · KYC {s.owner.kyc}</>}</p>
              </div>
              <Link to={`/dashboard/stores/${s.id}/whatsapp`} className="btn-quiet text-xs">Store page</Link>
            </div>
            <div className="grid gap-4 p-5 md:grid-cols-[1.2fr_1fr]">
              <div className="space-y-3 text-sm">
                <div>
                  <p className="text-xs font-medium text-ink-soft">Stock video</p>
                  {s.v.videoUrl ? <a href={s.v.videoUrl} target="_blank" rel="noreferrer noopener" className="break-all text-brand underline">{s.v.videoUrl}</a> : <p className="text-ink-faint">Not sent yet</p>}
                </div>
                <div>
                  <p className="text-xs font-medium text-ink-soft">About the business</p>
                  <p className="whitespace-pre-line">{s.v.storeNote || <span className="text-ink-faint">—</span>}</p>
                </div>
                <div>
                  <p className="text-xs font-medium text-ink-soft">Documents ({s.docs.length})</p>
                  {s.docs.length ? (
                    <ul className="mt-1 flex flex-wrap gap-2">
                      {s.docs.map((doc) => <li key={doc.id}><a href={`/dashboard/store-doc/${doc.id}`} target="_blank" rel="noreferrer" className="inline-flex max-w-[220px] items-center gap-1 truncate rounded-md border border-rule px-2 py-1 text-xs hover:bg-paper">{doc.mime === "application/pdf" ? "📄" : "🖼️"} {doc.filename}</a></li>)}
                    </ul>
                  ) : <p className="text-ink-faint">None</p>}
                </div>
                {s.v.submittedAt && <p className="text-xs text-ink-faint">Sent {new Date(s.v.submittedAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" })}</p>}
                {s.v.decidedBy && <p className="text-xs text-ink-faint">Last decision by {s.v.decidedBy}{s.v.decidedAt ? `, ${new Date(s.v.decidedAt).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium" })}` : ""}</p>}
              </div>
              <Form method="post" className="space-y-3">
                <input type="hidden" name="storeId" value={s.id} />
                <label className="block">
                  <span className="label">Note to the store</span>
                  <textarea name="adminNote" rows={3} className="input text-sm" defaultValue={s.status === "approved" ? "" : s.v.adminNote ?? ""} placeholder="e.g. Please send a clearer video showing the stock with today's date" />
                  <span className="hint">Shown to the store when you ask for more or don't approve.</span>
                </label>
                <div className="flex flex-wrap gap-2">
                  {s.status !== "approved" ? (
                    <>
                      <button name="decision" value="approve" className="btn-primary text-sm">Approve</button>
                      <button name="decision" value="request" className="btn-secondary text-sm">Ask for more</button>
                      <button name="decision" value="reject" className="btn-quiet text-sm text-bad">Don't approve</button>
                    </>
                  ) : (
                    <button name="decision" value="revoke" className="btn-secondary text-sm text-bad"
                      onClick={(e) => { if (!confirm(`Turn off WhatsApp for ${s.name}? Order confirmations, inbox and abandoned cart messages stop until you approve again.`)) e.preventDefault(); }}>Turn off WhatsApp</button>
                  )}
                </div>
              </Form>
            </div>
          </section>
        ))}
      </div>
    </>
  );
}
