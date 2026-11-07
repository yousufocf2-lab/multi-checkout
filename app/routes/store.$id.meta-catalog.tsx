// Facebook & Instagram catalog: one-click setup, then only changed products are sent to Meta.
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Form, Link, useActionData, useLoaderData, useNavigation } from "@remix-run/react";
import { useState } from "react";
import { Card } from "~/components/settings-ui";
import { Icon } from "~/components/Icons";
import { Notice, SubmitButton } from "~/components/ui";
import { requireStore, requireViewer } from "~/lib/auth.server";
import { catalogAllowed } from "~/lib/catalog.server";
import { CatalogError, connectCatalog, disconnectCatalog, syncCatalog } from "~/lib/meta-catalog.server";
import { storePath } from "~/lib/store-code";
import { db, stores } from "~/db.server";
import { eq } from "drizzle-orm";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const viewer = await requireViewer(request);
  const store = await requireStore(viewer, params.id);
  if (!catalogAllowed(viewer, store)) throw new Response("Not found", { status: 404 });
  return json({
    storeId: store.id,
    hasToken: Boolean(store.metaAccessToken), adAccount: store.metaAdAccountId ?? "", pixel: store.metaPixelId ?? "",
    on: store.metaCatalogOn, catalogId: store.metaCatalogId ?? "", count: store.metaCatalogCount,
    syncedAt: store.metaCatalogSyncedAt?.toISOString() ?? null, error: store.metaCatalogError,
  });
}

export async function action({ request, params }: ActionFunctionArgs) {
  const viewer = await requireViewer(request);
  const store = await requireStore(viewer, params.id);
  if (!catalogAllowed(viewer, store)) throw new Response("Not found", { status: 404 });
  const fd = await request.formData();
  const intent = String(fd.get("intent") ?? "");
  try {
    if (intent === "connect") {
      const r = await connectCatalog(store, { catalogId: String(fd.get("catalogId") ?? "") });
      return json({ ok: `Connected. ${r.total} product${r.total === 1 ? "" : "s"} sent to your catalog.${r.pixelNote ? " " + r.pixelNote : ""}`, error: null });
    }
    if (intent === "sync") {
      const [fresh] = await db.select().from(stores).where(eq(stores.id, store.id)).limit(1);
      const r = await syncCatalog(fresh, { full: fd.get("full") === "1" });
      return json({ ok: r.sent || r.removed ? `Done: ${r.sent} updated, ${r.removed} removed.` : "Everything is already up to date.", error: null });
    }
    if (intent === "disconnect") {
      await disconnectCatalog(store.id);
      return json({ ok: "Paused. Products stay in your Meta catalog but won't be updated.", error: null });
    }
  } catch (e) {
    return json({ ok: null, error: e instanceof CatalogError ? e.message : "Something went wrong. Please try again." }, { status: 400 });
  }
  return json({ ok: null, error: "Unknown action" }, { status: 400 });
}

const ago = (iso: string | null) => {
  if (!iso) return "never";
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} hr ago`;
  return new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
};

export default function MetaCatalog() {
  const d = useLoaderData<typeof loader>();
  const a = useActionData<typeof action>();
  const nav = useNavigation();
  const [own, setOwn] = useState(false);
  const busy = nav.state !== "idle";
  const settings = `${storePath(d.storeId, "settings")}#meta`;
  const ready = d.hasToken && (d.adAccount || own);
  const steps = [
    { done: d.hasToken, t: "Meta access token", d: "System user token with catalog_management and ads_management." },
    { done: Boolean(d.adAccount), t: "Ad account", d: "Used to find your Meta Business portfolio." },
    { done: Boolean(d.pixel), t: "Pixel", d: "Linked to the catalog so ads can show the products people viewed." },
  ];

  return (
    <div className="mx-auto max-w-[860px] space-y-4">
      {a?.ok && !busy && <Notice tone="success">{a.ok}</Notice>}
      {a?.error && !busy && <Notice tone="error">{a.error}</Notice>}

      <Card>
        <div className="flex flex-wrap items-center gap-4 pt-4">
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-[#0866ff] text-white">
            <svg width="26" height="26" viewBox="0 0 24 24" fill="currentColor" aria-hidden><path d="M13.5 21v-7.5h2.5l.4-3h-2.9V8.6c0-.9.3-1.5 1.5-1.5h1.5V4.4c-.3 0-1.2-.1-2.2-.1-2.2 0-3.7 1.3-3.7 3.8v2.4H8v3h2.6V21z" /></svg>
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[15px] font-semibold">Facebook &amp; Instagram catalog</p>
            <p className="text-[13px] text-ink-soft">Your products in Meta for catalog ads and shopping. Only products you add, edit or remove are sent, right when they change.</p>
          </div>
          <span className={`rounded-full px-2.5 py-1 text-[12px] font-medium ${d.on ? "bg-[#cdfee1] text-[#0c5132]" : "bg-[#e3e3e3] text-[#4a4a4a]"}`}>{d.on ? "Connected" : "Not connected"}</span>
        </div>
      </Card>

      {d.on ? (
        <Card title="Sync status">
          <div className="grid gap-3 sm:grid-cols-3">
            <Stat label="Products in catalog" value={String(d.count)} />
            <Stat label="Last update" value={ago(d.syncedAt)} />
            <Stat label="Catalog ID" value={d.catalogId} small />
          </div>
          {d.error && <div className="mt-3"><Notice tone="error">{d.error}</Notice></div>}
          <p className="mt-3 text-[12.5px] text-ink-soft">Changes go to Meta about 10 seconds after you save a product. Stock that drops after orders is checked every few minutes.</p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Form method="post"><input type="hidden" name="intent" value="sync" /><SubmitButton className="btn-secondary" busyText="Updating">Update now</SubmitButton></Form>
            <Form method="post"><input type="hidden" name="intent" value="sync" /><input type="hidden" name="full" value="1" /><SubmitButton className="btn-secondary" busyText="Sending">Send all products again</SubmitButton></Form>
            <a href={`https://business.facebook.com/commerce/catalogs/${d.catalogId}/products`} target="_blank" rel="noreferrer" className="btn-secondary"><Icon name="external" className="h-4 w-4" />Open in Commerce Manager</a>
            <Form method="post" className="ml-auto"><input type="hidden" name="intent" value="disconnect" /><button className="btn-quiet text-bad" onClick={(e) => { if (!confirm("Stop updating the Meta catalog?")) e.preventDefault(); }}>Pause sync</button></Form>
          </div>
        </Card>
      ) : (
        <Card title="Connect in one click" description="Growpefy creates the catalog in your Meta Business portfolio, links your pixel and sends every active product with a photo.">
          <ul className="space-y-2">
            {steps.map((s) => (
              <li key={s.t} className="flex items-start gap-2.5 text-[13px]">
                <span className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${s.done ? "bg-[#29845a] text-white" : "bg-[#e3e3e3] text-ink-faint"}`}>
                  {s.done ? <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12.5 10 17 19 7" /></svg> : <span className="h-1.5 w-1.5 rounded-full bg-current" />}
                </span>
                <span><b className="font-medium">{s.t}</b> <span className="text-ink-soft">· {s.d}</span></span>
              </li>
            ))}
          </ul>
          {(!d.hasToken || !d.adAccount) && <p className="mt-3 text-[12.5px] text-ink-soft">Add the missing details in <Link to={settings} className="font-medium text-ink underline">Settings → Meta ads</Link>.</p>}
          <Form method="post" className="mt-4 space-y-3">
            <input type="hidden" name="intent" value="connect" />
            <label className="flex items-center gap-2 text-[13px]"><input type="checkbox" checked={own} onChange={(e) => setOwn(e.target.checked)} />I already have a catalog in Commerce Manager</label>
            {own && <input name="catalogId" required inputMode="numeric" placeholder="Catalog ID, e.g. 1234567890123456" className="input w-full sm:w-[340px]" />}
            <SubmitButton className="btn-primary" busyText="Connecting" disabled={!ready}>{own ? "Connect this catalog" : "Create catalog and connect"}</SubmitButton>
          </Form>
        </Card>
      )}

      <Card title="What gets sent">
        <ul className="grid gap-x-6 gap-y-1.5 text-[13px] text-ink-soft sm:grid-cols-2">
          <li>• Every active product and each of its variants</li>
          <li>• Price, sale price and stock (in stock / out of stock)</li>
          <li>• Photos, title, description, brand and colour / size</li>
          <li>• Link to the product on your website</li>
          <li>• Draft, archived or deleted products are removed</li>
          <li>• Product IDs match your pixel and checkout events</li>
        </ul>
      </Card>
    </div>
  );
}

function Stat({ label, value, small }: { label: string; value: string; small?: boolean }) {
  return (
    <div className="rounded-[10px] px-3 py-2.5 shadow-[0_0_0_1px_rgba(0,0,0,.08)]">
      <p className="text-[12px] text-ink-soft">{label}</p>
      <p className={`${small ? "text-[13px]" : "text-[18px]"} truncate font-semibold`}>{value || "–"}</p>
    </div>
  );
}
