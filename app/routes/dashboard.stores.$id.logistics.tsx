import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Form, Link, useActionData, useLoaderData, useNavigation } from "@remix-run/react";
import { useEffect, useState } from "react";
import { Icon } from "~/components/Icons";
import { Notice, Spinner, SubmitButton } from "~/components/ui";
import { requireStore, requireViewer } from "~/lib/auth.server";
import { COURIERS, connectCourier, courierAccountsFor, disconnectCourier, isLiveCourier, shipmentSummary, syncStoreShipments } from "~/lib/logistics.server";
import { SHIP_STATUS_LABELS, type ShipStatus } from "~/lib/rto-shield";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const viewer = await requireViewer(request);
  const store = await requireStore(viewer, params.id);
  const [accounts, summary] = await Promise.all([courierAccountsFor(store.id), shipmentSummary(store.id)]);
  return json({
    storeId: store.id,
    shopify: Boolean(store.adminToken || (store.clientId && store.clientSecret)),
    couriers: COURIERS,
    accounts: accounts.map((a) => ({
      courier: a.courier, status: a.status, lastError: a.lastError, clientName: a.creds.clientName ?? null,
      tokenEnd: a.creds.token.slice(-4), lastSyncAt: a.lastSyncAt?.toISOString() ?? null, since: a.createdAt.toISOString(),
    })),
    summary,
  });
}

type R = { ok: string | null; error: string | null; courier?: string };

export async function action({ request, params }: ActionFunctionArgs) {
  const store = await requireStore(await requireViewer(request), params.id);
  const fd = await request.formData();
  const intent = String(fd.get("intent") ?? "");
  const courier = String(fd.get("courier") ?? "");
  if (intent === "connect") {
    if (!isLiveCourier(courier)) return json<R>({ ok: null, error: "This courier isn't available yet", courier }, { status: 400 });
    const r = await connectCourier(store, courier, { token: String(fd.get("token") ?? ""), clientName: String(fd.get("clientName") ?? "") });
    if (!r.ok) return json<R>({ ok: null, error: r.error, courier }, { status: 400 });
    return json<R>({ ok: "connected", error: null, courier });
  }
  if (intent === "sync") {
    const r = await syncStoreShipments(store, { force: true });
    return json<R>({ ok: `Synced. ${r.linked} new shipment${r.linked === 1 ? "" : "s"} found, ${r.updated} status update${r.updated === 1 ? "" : "s"}.`, error: null, courier });
  }
  if (intent === "disconnect") {
    await disconnectCourier(store.id, courier);
    return json<R>({ ok: "Disconnected", error: null, courier });
  }
  return json<R>({ ok: null, error: "Unknown action" }, { status: 400 });
}

const ago = (iso: string | null) => {
  if (!iso) return "not yet";
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  return h < 24 ? `${h} h ago` : new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "Asia/Kolkata" });
};

const TILES: { s: ShipStatus; cls: string }[] = [
  { s: "in_transit", cls: "text-sky-700 bg-sky-50" },
  { s: "delivered", cls: "text-good bg-emerald-50" },
  { s: "rto_transit", cls: "text-amber-700 bg-amber-50" },
  { s: "rto", cls: "text-bad bg-red-50" },
  { s: "returned", cls: "text-fuchsia-700 bg-fuchsia-50" },
];

export default function Logistics() {
  const d = useLoaderData<typeof loader>();
  const r = useActionData<typeof action>();
  const connected = d.accounts.filter((a) => a.status === "connected");
  const [open, setOpen] = useState<string | null>(null);
  useEffect(() => { if (r?.ok === "connected") setOpen(null); else if (r?.error && r.courier) setOpen(r.courier); }, [r]);
  const total = Object.values(d.summary).reduce((a, b) => a + (b ?? 0), 0);

  return (
    <div className="space-y-5">
      {r?.ok === "connected" && (
        <div className="panel flex flex-wrap items-center gap-4 border-emerald-200 bg-gradient-to-r from-emerald-50 to-sky-50 p-5">
          <span className="flex h-11 w-11 items-center justify-center rounded-full bg-white text-2xl shadow-sm" aria-hidden>🛡️</span>
          <div className="min-w-0 flex-1">
            <p className="font-semibold">Courier connected. RTO Shield is unlocked!</p>
            <p className="text-sm text-ink-soft">We'll pick up shipments from your Shopify orders and track them every hour. Set rules to stop risky COD orders.</p>
          </div>
          <Link to={`/dashboard/stores/${d.storeId}/rto-shield`} className="btn-primary">Set up RTO Shield →</Link>
        </div>
      )}
      {r?.ok && r.ok !== "connected" && <Notice tone="success">{r.ok}</Notice>}
      {!d.shopify && <Notice tone="warning">Connect Shopify first (Settings → Store settings). We read the AWB numbers from your Shopify order fulfillments.</Notice>}

      {connected.length > 0 && (
        <section className="panel p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-[15px] font-semibold">Shipments, last 90 days</h2>
              <p className="text-sm text-ink-soft">{total ? `${total} orders tracked from checkout` : "Shipments appear here once your orders are fulfilled in Shopify with a Delhivery AWB."}</p>
            </div>
            <Form method="post"><input type="hidden" name="courier" value="delhivery" /><SubmitButton intent="sync" className="btn-secondary" busyText="Syncing"><Icon name="trend" className="h-4 w-4" />Sync now</SubmitButton></Form>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-5">
            {TILES.map((t) => (
              <div key={t.s} className={`rounded-xl px-4 py-3 ${t.cls}`}>
                <p className="text-xs font-medium opacity-80">{SHIP_STATUS_LABELS[t.s]}</p>
                <p className="num mt-0.5 text-2xl font-semibold">{d.summary[t.s] ?? 0}</p>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="panel">
        <header className="border-b border-rule px-5 py-4">
          <h2 className="text-[15px] font-semibold">Couriers</h2>
          <p className="mt-0.5 text-sm text-ink-soft">Connect the courier you ship with. It takes about a minute.</p>
        </header>
        <ul className="divide-y divide-rule">
          {d.couriers.map((c) => {
            const acc = d.accounts.find((a) => a.courier === c.id);
            const isOpen = open === c.id;
            return (
              <li key={c.id} className="px-5 py-4">
                <div className="flex flex-wrap items-center gap-3">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-sm font-bold text-white" style={{ background: c.color }}>{c.name.slice(0, 1)}</span>
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-2 font-medium">
                      {c.name}
                      {acc?.status === "connected" && <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-good">● Connected</span>}
                      {acc?.status === "error" && <span className="rounded-full bg-red-50 px-2 py-0.5 text-[11px] font-semibold text-bad">Needs attention</span>}
                      {!c.live && <span className="rounded-full bg-paper-sunk px-2 py-0.5 text-[11px] font-semibold text-ink-soft">Coming soon</span>}
                    </p>
                    {acc ? (
                      <p className="text-xs text-ink-faint">Token ••••{acc.tokenEnd}{acc.clientName ? ` · ${acc.clientName}` : ""} · last sync {ago(acc.lastSyncAt)}</p>
                    ) : (
                      <p className="text-xs text-ink-faint">{c.live ? "Track shipments and unlock RTO Shield" : "We're adding this courier soon"}</p>
                    )}
                  </div>
                  {c.live && !acc && !isOpen && <button type="button" className="btn-primary" onClick={() => setOpen(c.id)}>Connect</button>}
                  {acc && (
                    <div className="flex gap-2">
                      <button type="button" className="btn-secondary" onClick={() => setOpen(isOpen ? null : c.id)}>{isOpen ? "Close" : "Update token"}</button>
                      <Form method="post" onSubmit={(e) => { if (!window.confirm(`Disconnect ${c.name}? Shipment tracking and RTO Shield stop for this courier.`)) e.preventDefault(); }}>
                        <input type="hidden" name="courier" value={c.id} />
                        <button name="intent" value="disconnect" className="btn-quiet text-bad">Disconnect</button>
                      </Form>
                    </div>
                  )}
                </div>
                {acc?.lastError && <div className="mt-3"><Notice tone="error">{acc.lastError}</Notice></div>}
                {isOpen && c.live && <ConnectPanel c={c} error={r?.courier === c.id ? r.error : null} />}
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}

function ConnectPanel({ c, error }: { c: ReturnType<typeof useLoaderData<typeof loader>>["couriers"][number]; error: string | null }) {
  const nav = useNavigation();
  const busy = nav.state === "submitting" && nav.formData?.get("intent") === "connect";
  return (
    <div className="mt-4 grid gap-5 rounded-xl border border-rule bg-paper/60 p-4 sm:p-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <div>
        <p className="text-sm font-semibold">How to get your {c.name} token</p>
        <ol className="mt-3 space-y-3">
          {c.steps?.map((s, i) => (
            <li key={i} className="flex gap-3 text-sm text-ink-soft">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-ink text-xs font-semibold text-white">{i + 1}</span>
              <span className="pt-0.5">{s}</span>
            </li>
          ))}
        </ol>
        {c.link && <a href={c.link.href} target="_blank" rel="noreferrer" className="btn-secondary mt-4">{c.link.label} ↗</a>}
      </div>
      <Form method="post" className="space-y-3">
        <input type="hidden" name="courier" value={c.id} />
        {error && <Notice tone="error">{error}</Notice>}
        {c.fields?.map((f) => (
          <label key={f.name} className="block">
            <span className="label">{f.label}{f.optional && <span className="font-normal text-ink-faint"> (optional)</span>}</span>
            <input name={f.name} className={`input ${f.name === "token" ? "font-mono text-[13px]" : ""}`} placeholder={f.placeholder} autoComplete="off" spellCheck={false} required={!f.optional} />
            {f.hint && <span className="hint">{f.hint}</span>}
          </label>
        ))}
        <button type="submit" name="intent" value="connect" className="btn-primary w-full py-3" disabled={busy}>
          {busy ? <><Spinner /> Checking with {c.name}</> : `Connect ${c.name}`}
        </button>
        <p className="flex items-center gap-1.5 text-xs text-ink-faint"><Icon name="shield" className="h-3.5 w-3.5" />Used only to track your shipments. You can disconnect any time.</p>
      </Form>
    </div>
  );
}
