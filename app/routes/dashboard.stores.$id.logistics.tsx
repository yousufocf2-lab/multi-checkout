import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Form, Link, useActionData, useLoaderData, useNavigation, useSearchParams } from "@remix-run/react";
import { useEffect, useMemo, useState } from "react";
import { CourierLogo } from "~/components/CourierLogo";
import { Icon } from "~/components/Icons";
import { Notice, PasswordInput, Spinner, SubmitButton } from "~/components/ui";
import { requireStore, requireViewer } from "~/lib/auth.server";
import { COURIERS, type CourierInfo } from "~/lib/courier-catalog";
import { env } from "~/lib/env.server";
import { connectCourier, courierAccountsFor, courierPerformance, disconnectCourier, shipmentList, shipmentSummary, shipmentsByCourier, syncStoreShipments } from "~/lib/logistics.server";
import { SHIP_FILTERS, type ShipFilter } from "~/lib/rto-shield";
import { SHIP_STATUS_LABELS, type ShipStatus } from "~/lib/rto-shield";

const maskEmail = (e?: string) => (e ? e.replace(/^(.{2})[^@]*/, "$1•••") : null);

export async function loader({ request, params }: LoaderFunctionArgs) {
  const viewer = await requireViewer(request);
  const store = await requireStore(viewer, params.id);
  const url = new URL(request.url);
  const filter = (SHIP_FILTERS as readonly string[]).includes(url.searchParams.get("ship") ?? "") ? (url.searchParams.get("ship") as ShipFilter) : "all";
  const days = url.searchParams.get("days") === "30" ? 30 : 90;
  const q = url.searchParams.get("q") ?? "";
  const page = Math.max(1, Number(url.searchParams.get("page")) || 1);
  const [accounts, summary, perCourier, performance, list] = await Promise.all([
    courierAccountsFor(store.id), shipmentSummary(store.id), shipmentsByCourier(store.id),
    courierPerformance(store.id, days), shipmentList(store.id, { filter, q, page, days }),
  ]);
  return json({
    storeId: store.id,
    shopify: Boolean(store.adminToken || (store.clientId && store.clientSecret)),
    hookUrl: `${env.appUrl}/api/shipnex/${store.id}`,
    accounts: accounts.map((a) => ({
      courier: a.courier, status: a.status, lastError: a.lastError,
      viaShopify: Boolean(a.creds.viaShopify),
      who: a.courier === "shipnex" ? null : a.creds.viaShopify ? "Tracked from Shopify" : a.creds.token ? `Token ••••${a.creds.token.slice(-4)}` : maskEmail(a.creds.email) ?? a.creds.username ?? a.creds.label ?? null,
      clientName: a.creds.clientName ?? a.creds.label ?? null,
      secret: a.courier === "shipnex" ? a.creds.token ?? null : null,
      lastSyncAt: a.lastSyncAt?.toISOString() ?? null,
    })),
    summary,
    perCourier,
    performance, days,
    shipments: { filter, q, page, hasMore: list.hasMore, rows: list.rows.map((r) => ({ ...r, at: r.at?.toISOString() ?? null, createdAt: r.createdAt.toISOString() })) },
  });
}

type R = { ok: string | null; error: string | null; courier?: string };

export async function action({ request, params }: ActionFunctionArgs) {
  const store = await requireStore(await requireViewer(request), params.id);
  const fd = await request.formData();
  const intent = String(fd.get("intent") ?? "");
  const courier = String(fd.get("courier") ?? "");
  const name = COURIERS.find((c) => c.id === courier)?.name ?? "Courier";
  if (intent === "connect") {
    const get = (k: string) => String(fd.get(k) ?? "");
    const r = await connectCourier(store, courier, { token: get("token"), clientName: get("clientName"), email: get("email"), password: get("password"), clientId: get("clientId"), username: get("username"), label: get("label"), mode: get("mode") });
    if (!r.ok) return json<R>({ ok: null, error: r.error, courier }, { status: 400 });
    return json<R>({ ok: "connected", error: null, courier });
  }
  if (intent === "sync") {
    const r = await syncStoreShipments(store, { force: true });
    return json<R>({ ok: `Synced. ${r.linked} new shipment${r.linked === 1 ? "" : "s"} found, ${r.updated} status update${r.updated === 1 ? "" : "s"}.`, error: null });
  }
  if (intent === "disconnect") {
    await disconnectCourier(store.id, courier);
    return json<R>({ ok: `${name} disconnected`, error: null });
  }
  return json<R>({ ok: null, error: "Unknown action" }, { status: 400 });
}

type D = ReturnType<typeof useLoaderData<typeof loader>>;
type Acc = D["accounts"][number];

const ago = (iso: string | null) => {
  if (!iso) return "not synced yet";
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1) return "synced just now";
  if (m < 60) return `synced ${m} min ago`;
  const h = Math.round(m / 60);
  return h < 24 ? `synced ${h} h ago` : `synced ${new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "Asia/Kolkata" })}`;
};

const TILES: { s: ShipStatus; dot: string }[] = [
  { s: "in_transit", dot: "bg-sky-500" },
  { s: "delivered", dot: "bg-emerald-500" },
  { s: "rto_transit", dot: "bg-amber-500" },
  { s: "rto", dot: "bg-red-500" },
  { s: "returned", dot: "bg-fuchsia-500" },
];

const KIND_TAG: Record<CourierInfo["kind"], { t: string; cls: string }> = {
  api: { t: "Live API", cls: "bg-emerald-50 text-emerald-700" },
  shopify: { t: "Via Shopify", cls: "bg-sky-50 text-sky-700" },
  push: { t: "Live push", cls: "bg-violet-50 text-violet-700" },
};

const GROUPS: { key: string; title: string; text: string; test: (c: CourierInfo) => boolean }[] = [
  { key: "api", title: "Live API", text: "We log in to the courier and read every scan.", test: (c) => c.kind === "api" },
  { key: "shopify", title: "Tracked from Shopify", text: "No login needed. We read the delivery status your courier app sends to Shopify.", test: (c) => c.kind === "shopify" && c.id !== "other" },
  { key: "more", title: "Other & Shipnex", text: "Not in the list? Add it as Other. Shipping with Shipnex? It pushes updates to us live.", test: (c) => c.id === "other" || c.kind === "push" },
];

export default function Logistics() {
  const d = useLoaderData<typeof loader>();
  const r = useActionData<typeof action>();
  const [open, setOpen] = useState<string | null>(null);
  useEffect(() => {
    if (r?.ok === "connected") setOpen(r.courier === "shipnex" ? "shipnex" : null);
    else if (r?.error && r.courier) setOpen(r.courier);
  }, [r]);
  const byId = useMemo(() => new Map(d.accounts.map((a) => [a.courier, a])), [d.accounts]);
  const mine = COURIERS.filter((c) => byId.has(c.id));
  const total = Object.values(d.summary).reduce((a, b) => a + (b ?? 0), 0);
  const openInfo = COURIERS.find((c) => c.id === open) ?? null;
  const justConnected = r?.ok === "connected" ? COURIERS.find((c) => c.id === r.courier) : null;

  return (
    <div className="space-y-5">
      <Hero connected={mine.length} total={total} />

      {justConnected && (
        <div className="panel flex flex-wrap items-center gap-4 border-emerald-200 bg-gradient-to-r from-emerald-50 to-sky-50 p-4">
          <CourierLogo c={justConnected} size={40} />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold">{justConnected.name} connected. RTO Shield is unlocked 🛡️</p>
            <p className="text-xs text-ink-soft">{justConnected.kind === "push" ? "Share the webhook link below with Shipnex." : "We pick up AWBs from your Shopify orders and refresh them every hour."}</p>
          </div>
          <Link to={`/dashboard/stores/${d.storeId}/rto-shield`} className="btn-primary text-sm">Set up RTO Shield →</Link>
        </div>
      )}
      {r?.ok && r.ok !== "connected" && <Notice tone="success">{r.ok}</Notice>}
      {r?.error && !r.courier && <Notice tone="error">{r.error}</Notice>}
      {!d.shopify && <Notice tone="warning">Connect Shopify first (Settings → Store settings). We read AWB numbers from your Shopify order fulfillments.</Notice>}

      {mine.length > 0 && (
        <section className="panel p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-[15px] font-semibold">Shipments · last 90 days</h2>
              <p className="text-xs text-ink-soft">{total ? `${total} checkout orders tracked across ${mine.length} courier${mine.length === 1 ? "" : "s"}` : "Shipments show up once orders are fulfilled in Shopify with an AWB."}</p>
            </div>
            <Form method="post"><SubmitButton intent="sync" className="btn-secondary h-9 px-3 text-sm" busyText="Syncing"><Icon name="trend" className="h-4 w-4" />Sync now</SubmitButton></Form>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-5">
            {TILES.map((t) => {
              const n = d.summary[t.s] ?? 0;
              return (
                <div key={t.s} className="rounded-xl border border-rule px-3 py-2.5">
                  <p className="flex items-center gap-1.5 text-[11px] font-medium text-ink-soft"><span className={`h-1.5 w-1.5 rounded-full ${t.dot}`} />{SHIP_STATUS_LABELS[t.s]}</p>
                  <p className="num mt-0.5 text-xl font-semibold">{n}{total > 0 && n > 0 && <span className="ml-1 text-[11px] font-normal text-ink-faint">{Math.round((n / total) * 100)}%</span>}</p>
                </div>
              );
            })}
          </div>

          <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {mine.map((c) => <ConnectedCard key={c.id} c={c} a={byId.get(c.id)!} n={d.perCourier[c.id] ?? 0} hookUrl={d.hookUrl} onManage={() => setOpen(c.id)} />)}
          </div>
        </section>
      )}

      {mine.length > 0 && <Performance d={d} />}
      {mine.length > 0 && <Shipments d={d} />}

      <section className="panel p-5">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 className="text-[15px] font-semibold">{mine.length ? "Add another courier" : "Connect your couriers"}</h2>
            <p className="text-xs text-ink-soft">Ship with 2, 3 or 4 couriers? Connect all of them. We match every AWB to the right one.</p>
          </div>
          <span className="rounded-full bg-paper-sunk px-2.5 py-1 text-[11px] font-medium text-ink-soft">Optional · checkout works without it</span>
        </div>
        {GROUPS.map((g) => (
          <div key={g.key} className="mt-5">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint">{g.title}</p>
            <p className="text-xs text-ink-soft">{g.text}</p>
            <div className="mt-2.5 grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
              {COURIERS.filter(g.test).map((c) => <CourierTile key={c.id} c={c} a={byId.get(c.id)} onClick={() => setOpen(c.id)} />)}
            </div>
          </div>
        ))}
      </section>

      {openInfo && <ConnectSheet c={openInfo} a={byId.get(openInfo.id)} error={r?.courier === openInfo.id ? r.error : null} hookUrl={d.hookUrl} onClose={() => setOpen(null)} />}
    </div>
  );
}

function Hero({ connected, total }: { connected: number; total: number }) {
  const logos = COURIERS.filter((c) => c.logo);
  return (
    <section className="panel relative overflow-hidden bg-gradient-to-br from-slate-900 via-slate-800 to-pine px-5 py-6 text-white sm:px-7">
      <div aria-hidden className="pointer-events-none absolute -right-16 -top-16 h-56 w-56 rounded-full bg-emerald-400/20 blur-3xl" />
      <div className="relative flex flex-wrap items-center gap-6">
        <div className="min-w-0 flex-1 basis-72">
          <p className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-2.5 py-1 text-[11px] font-medium text-emerald-200"><Icon name="shield" className="h-3 w-3" />Logistics · optional</p>
          <h2 className="mt-3 text-lg font-semibold sm:text-xl">Your couriers, one RTO brain</h2>
          <p className="mt-1 max-w-lg text-xs leading-relaxed text-white/70 sm:text-[13px]">Connect the couriers you already ship with. We track every AWB, learn which customers refuse deliveries, and RTO Shield stops their next risky COD order at checkout.</p>
          <div className="mt-4 flex flex-wrap gap-2 text-[11px]">
            <span className="rounded-lg bg-white/10 px-2.5 py-1.5"><b className="num text-sm">{connected}</b> connected</span>
            <span className="rounded-lg bg-white/10 px-2.5 py-1.5"><b className="num text-sm">{total}</b> shipments tracked</span>
            <span className="rounded-lg bg-white/10 px-2.5 py-1.5"><b className="num text-sm">{COURIERS.length}</b> couriers supported</span>
          </div>
        </div>
        <div className="flex -space-x-3" aria-hidden>
          {logos.map((c, i) => <CourierLogo key={c.id} c={c} size={52} className="ring-2 ring-slate-800 transition hover:-translate-y-1" />)}
        </div>
      </div>
    </section>
  );
}

function StatusPill({ a }: { a?: Acc }) {
  if (!a) return null;
  return a.status === "connected"
    ? <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold text-good"><span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />Connected</span>
    : <span className="inline-flex items-center gap-1 rounded-full bg-red-50 px-1.5 py-0.5 text-[10px] font-semibold text-bad"><span className="h-1.5 w-1.5 rounded-full bg-red-500" />Needs attention</span>;
}

function CourierTile({ c, a, onClick }: { c: CourierInfo; a?: Acc; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick}
      className={`group flex flex-col items-center rounded-2xl border px-3 pb-3 pt-4 text-center transition hover:-translate-y-0.5 hover:shadow-lift ${a ? "border-emerald-200 bg-emerald-50/40" : "border-rule bg-white"}`}>
      <CourierLogo c={c} size={48} className="transition group-hover:scale-105" />
      <p className="mt-2 line-clamp-1 text-[13px] font-semibold">{c.id === "other" && a?.clientName ? a.clientName : c.name}</p>
      <p className="line-clamp-1 text-[11px] text-ink-faint">{c.tagline}</p>
      <span className="mt-2">{a ? <StatusPill a={a} /> : <span className="rounded-full border border-rule-strong px-2 py-0.5 text-[11px] font-medium text-ink-soft group-hover:border-ink group-hover:text-ink">{c.kind === "api" ? "Connect" : "Turn on"}</span>}</span>
    </button>
  );
}

function ConnectedCard({ c, a, n, hookUrl, onManage }: { c: CourierInfo; a: Acc; n: number; hookUrl: string; onManage: () => void }) {
  const tag = a.viaShopify ? KIND_TAG.shopify : KIND_TAG[c.kind];
  return (
    <div className={`min-w-0 rounded-2xl border p-3.5 ${a.status === "connected" ? "border-rule" : "border-red-200 bg-red-50/40"}`}>
      <div className="flex items-center gap-3">
        <CourierLogo c={c} size={40} />
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-1.5 text-[13px] font-semibold">{c.id === "other" && a.clientName ? a.clientName : c.name}<StatusPill a={a} /></p>
          <p className="truncate text-[11px] text-ink-faint"><span className={`mr-1 rounded px-1 py-px text-[10px] font-semibold ${tag.cls}`}>{tag.t}</span>{a.who ? `${a.who} · ` : ""}{ago(a.lastSyncAt)}</p>
        </div>
        <div className="text-right">
          <p className="num text-base font-semibold leading-none">{n}</p>
          <p className="text-[10px] text-ink-faint">shipments</p>
        </div>
      </div>
      {a.lastError && <p className="mt-2 rounded-lg bg-red-50 px-2.5 py-1.5 text-[11px] text-bad">{a.lastError}</p>}
      {c.kind === "push" && <p className="mt-2 truncate rounded-lg bg-paper px-2.5 py-1.5 font-mono text-[10px] text-ink-soft">{hookUrl}</p>}
      <div className="mt-3 flex items-center gap-1.5">
        <button type="button" onClick={onManage} className="btn-secondary h-8 flex-1 px-2 text-xs">{c.kind === "api" ? (a.viaShopify ? "Add API login" : "Update login") : "Details"}</button>
        <Form method="post" onSubmit={(e) => { if (!window.confirm(`Disconnect ${c.name}? Tracking for its shipments stops.`)) e.preventDefault(); }}>
          <input type="hidden" name="courier" value={c.id} />
          <button name="intent" value="disconnect" className="btn-quiet h-8 px-2 text-xs text-bad">Disconnect</button>
        </Form>
      </div>
    </div>
  );
}

function ConnectSheet({ c, a, error, hookUrl, onClose }: { c: CourierInfo; a?: Acc; error: string | null; hookUrl: string; onClose: () => void }) {
  const nav = useNavigation();
  const busy = nav.state === "submitting" && nav.formData?.get("intent") === "connect";
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);
  const tag = KIND_TAG[c.kind];
  const verb = c.kind === "api" ? "Connect" : "Turn on";

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/50 p-0 backdrop-blur-sm sm:items-center sm:p-4" onClick={onClose} role="dialog" aria-modal aria-label={`${verb} ${c.name}`}>
      <div className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-t-3xl bg-white shadow-2xl sm:rounded-3xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-3 border-b border-rule px-5 py-4">
          <CourierLogo c={c} size={44} />
          <div className="min-w-0 flex-1">
            <p className="flex items-center gap-2 font-semibold">{c.name}<span className={`rounded px-1.5 py-px text-[10px] font-semibold ${tag.cls}`}>{tag.t}</span></p>
            <p className="text-xs text-ink-faint">{c.tagline}</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-2 text-ink-faint hover:bg-paper hover:text-ink" aria-label="Close"><Icon name="close" className="h-4 w-4" /></button>
        </div>

        <div className="grid gap-5 p-5 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint">How it works</p>
            <ol className="mt-3 space-y-3">
              {c.steps?.map((s, i) => (
                <li key={i} className="flex gap-2.5 text-xs leading-relaxed text-ink-soft">
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-ink text-[10px] font-semibold text-white">{i + 1}</span>
                  <span>{s}</span>
                </li>
              ))}
            </ol>
            {c.link && <a href={c.link.href} target="_blank" rel="noreferrer" className="btn-secondary mt-4 h-8 px-3 text-xs">{c.link.label} ↗</a>}
          </div>

          <Form method="post" className="space-y-3">
            <input type="hidden" name="courier" value={c.id} />
            {error && <Notice tone="error">{error}</Notice>}
            {c.kind === "push" && a?.secret && (
              <div className="space-y-2 rounded-xl bg-paper p-3 text-xs">
                <Copy label="Webhook URL" value={hookUrl} />
                <Copy label="Secret (header X-Growpefy-Secret)" value={a.secret} />
                <p className="break-all text-[11px] text-ink-faint">Body: <code>{`{"awb":"…","status":"Delivered","order_id":"#1234"}`}</code></p>
              </div>
            )}
            {c.fields?.map((f) => (
              <label key={f.name} className="block">
                <span className="mb-1 block text-xs font-medium">{f.label}{f.optional && <span className="font-normal text-ink-faint"> · optional</span>}</span>
                <PwOrText name={f.name} type={f.type ?? "text"} className={`input h-10 text-sm ${f.name === "token" ? "font-mono text-[12px]" : ""}`}
                  placeholder={f.name === "password" && a ? "Leave empty to keep the saved password" : f.placeholder}
                  defaultValue={f.name === "label" ? a?.clientName ?? "" : ""}
                  autoComplete={f.type === "password" ? "new-password" : "off"} spellCheck={false} required={!f.optional && !(f.name === "password" && a)} />
                {f.hint && <span className="mt-1 block text-[11px] text-ink-faint">{f.hint}</span>}
              </label>
            ))}
            {!(c.kind === "push" && a) && (
              <button type="submit" name="intent" value="connect" className="btn-primary w-full py-2.5 text-sm" disabled={busy}>
                {busy ? <><Spinner /> {c.kind === "api" ? `Checking with ${c.name}` : "Saving"}</> : a ? (c.kind === "api" ? "Save new login" : "Save") : `${verb} ${c.name}`}
              </button>
            )}
            <p className="flex items-center gap-1.5 text-[11px] text-ink-faint"><Icon name="shield" className="h-3.5 w-3.5" />{c.kind === "api" ? "Passwords are encrypted. Used only to read tracking." : "Read-only. Disconnect any time."}</p>
          </Form>
          {c.kind === "api" && (
            <Form method="post" className="rounded-2xl border border-dashed border-rule-strong p-3.5 sm:col-span-2">
              <input type="hidden" name="courier" value={c.id} />
              <input type="hidden" name="mode" value="shopify" />
              <div className="flex flex-wrap items-center gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold">Don't want to share an API {c.fields?.some((f) => f.name === "token") ? "token" : "login"}?</p>
                  <p className="text-xs text-ink-soft">Just turn {c.name} on. We read each order's AWB and delivery status from Shopify, the way your {c.name} app updates it. Updates come a little slower than the live API.</p>
                </div>
                <button type="submit" name="intent" value="connect" className="btn-secondary shrink-0 px-4 py-2 text-sm" disabled={busy}>
                  {a?.viaShopify ? "On · tracked from Shopify" : "Turn on without API"}
                </button>
              </div>
            </Form>
          )}
        </div>
      </div>
    </div>
  );
}

function Copy({ label, value }: { label: string; value: string }) {
  const [done, setDone] = useState(false);
  return (
    <div>
      <p className="mb-1 font-medium">{label}</p>
      <div className="flex items-center overflow-hidden rounded-lg border border-rule-strong bg-white">
        <code className="min-w-0 flex-1 truncate px-2.5 py-1.5 text-[11px]">{value}</code>
        <button type="button" className="border-l border-rule-strong px-2.5 py-1.5 text-[11px] font-medium hover:bg-paper" onClick={() => { void navigator.clipboard.writeText(value); setDone(true); setTimeout(() => setDone(false), 1400); }}>{done ? "Copied" : "Copy"}</button>
      </div>
    </div>
  );
}

/** Password fields get the show / hide eye. */
function PwOrText({ type, ...rest }: React.InputHTMLAttributes<HTMLInputElement>) {
  return type === "password" ? <PasswordInput {...rest} /> : <input type={type} {...rest} />;
}

const STATUS_DOT: Record<string, string> = { in_transit: "bg-sky-500", delivered: "bg-emerald-500", rto_transit: "bg-amber-500", rto: "bg-red-500", returned: "bg-fuchsia-500", cancelled: "bg-slate-400" };
const pct = (n: number, d: number) => (d ? Math.round((n / d) * 100) : 0);

function Performance({ d }: { d: D }) {
  const [sp, setSp] = useSearchParams();
  const all = d.performance.reduce((a, r) => ({ total: a.total + r.total, delivered: a.delivered + r.delivered, rto: a.rto + r.rto, transit: a.transit + r.transit }), { total: 0, delivered: 0, rto: 0, transit: 0 });
  const done = all.delivered + all.rto;
  const setDays = (v: string) => { const n = new URLSearchParams(sp); n.set("days", v); setSp(n, { preventScrollReset: true }); };
  return (
    <section className="panel p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-[15px] font-semibold">Delivery performance</h2>
          <p className="text-xs text-ink-soft">Delivered and RTO out of shipments that reached a result. In-transit shipments aren't counted yet.</p>
        </div>
        <div className="inline-flex rounded-lg border border-rule-strong bg-surface p-0.5" role="tablist">
          {["30", "90"].map((v) => (
            <button key={v} type="button" role="tab" aria-selected={String(d.days) === v} onClick={() => setDays(v)}
              className={`rounded-md px-3 py-1 text-sm ${String(d.days) === v ? "bg-ink font-medium text-white" : "text-ink-soft"}`}>{v} days</button>
          ))}
        </div>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        <Kpi label="Delivered" value={`${pct(all.delivered, done)}%`} sub={`${all.delivered} orders`} tone="text-good" />
        <Kpi label="RTO" value={`${pct(all.rto, done)}%`} sub={`${all.rto} orders`} tone="text-bad" />
        <Kpi label="In transit" value={String(all.transit)} sub="on the way" />
        <Kpi label="Shipped" value={String(all.total)} sub={`last ${d.days} days`} />
      </div>
      {d.performance.length > 0 && (
        <div className="mt-4 overflow-x-auto">
          <table className="table min-w-[560px]">
            <thead><tr><th>Courier</th><th className="text-right">Shipped</th><th className="text-right">Delivered</th><th className="text-right">RTO</th><th className="text-right">In transit</th><th className="w-[28%]">Delivery rate</th></tr></thead>
            <tbody>
              {d.performance.map((r) => {
                const c = COURIERS.find((x) => x.id === r.courier);
                const rate = pct(r.delivered, r.delivered + r.rto);
                return (
                  <tr key={r.courier}>
                    <td><span className="flex items-center gap-2">{c && <CourierLogo c={c} size={24} />}<span className="font-medium">{c?.name ?? r.courier}</span></span></td>
                    <td className="num text-right">{r.total}</td>
                    <td className="num text-right text-good">{r.delivered}</td>
                    <td className="num text-right text-bad">{r.rto}</td>
                    <td className="num text-right">{r.transit}</td>
                    <td>
                      <div className="flex items-center gap-2">
                        <div className="h-2 flex-1 overflow-hidden rounded-full bg-red-100"><div className="h-full rounded-full bg-emerald-500" style={{ width: `${r.delivered + r.rto ? rate : 0}%` }} /></div>
                        <span className="num w-10 text-right text-xs font-semibold">{r.delivered + r.rto ? `${rate}%` : "–"}</span>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function Kpi({ label, value, sub, tone = "" }: { label: string; value: string; sub: string; tone?: string }) {
  return (
    <div className="rounded-xl border border-rule px-3.5 py-3">
      <p className="text-[11px] font-medium text-ink-soft">{label}</p>
      <p className={`num mt-0.5 text-2xl font-semibold ${tone}`}>{value}</p>
      <p className="text-[11px] text-ink-faint">{sub}</p>
    </div>
  );
}

const FILTER_LABEL: Record<string, string> = { all: "All", in_transit: "In transit", delivered: "Delivered", rto_transit: "RTO in transit", rto: "RTO", returned: "Returned" };

function Shipments({ d }: { d: D }) {
  const [sp, setSp] = useSearchParams();
  const sh = d.shipments;
  const go = (patch: Record<string, string | null>) => {
    const n = new URLSearchParams(sp);
    for (const [k, v] of Object.entries(patch)) { if (v == null || v === "") n.delete(k); else n.set(k, v); }
    setSp(n, { preventScrollReset: true });
  };
  return (
    <section className="panel" id="shipments">
      <div className="flex flex-wrap items-center gap-3 border-b border-rule px-5 py-4">
        <h2 className="mr-auto text-[15px] font-semibold">Shipments</h2>
        <form onSubmit={(e) => { e.preventDefault(); go({ q: String(new FormData(e.currentTarget).get("q") ?? ""), page: null }); }} className="flex items-center gap-2">
          <input name="q" defaultValue={sh.q} placeholder="Order, AWB or phone" className="input h-9 w-48 text-sm" />
          <button className="btn-secondary h-9 px-3 text-sm">Search</button>
        </form>
      </div>
      <div className="flex gap-1.5 overflow-x-auto px-5 py-3">
        {SHIP_FILTERS.map((f) => (
          <button key={f} type="button" onClick={() => go({ ship: f === "all" ? null : f, page: null })}
            className={`flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium ${sh.filter === f ? "border-ink bg-ink text-white" : "border-rule-strong text-ink-soft hover:border-ink"}`}>
            {f !== "all" && <span className={`h-1.5 w-1.5 rounded-full ${STATUS_DOT[f]}`} />}{FILTER_LABEL[f]}{f !== "all" && d.summary[f as ShipStatus] ? <span className="num opacity-70">{d.summary[f as ShipStatus]}</span> : null}
          </button>
        ))}
      </div>
      {sh.rows.length === 0 ? (
        <p className="px-5 pb-8 pt-4 text-center text-sm text-ink-faint">No shipments here.</p>
      ) : (<>
        <ul className="divide-y divide-rule border-t border-rule sm:hidden">
          {sh.rows.map((r) => {
            const c = COURIERS.find((x) => x.id === r.courier);
            const st = (r.status ?? "in_transit") as ShipStatus;
            return (
              <li key={r.id} className="flex items-start gap-3 px-5 py-3">
                <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${STATUS_DOT[st] ?? "bg-sky-500"}`} />
                <div className="min-w-0 flex-1">
                  <p className="flex justify-between gap-2 text-sm"><span className="num font-medium">{r.name ?? r.id}</span><span className="font-medium">{SHIP_STATUS_LABELS[st] ?? st}</span></p>
                  <p className="truncate text-xs text-ink-soft">{r.customer.firstName} {r.customer.lastName} · {r.customer.city} · {r.method === "cod" ? "COD" : r.method === "partial" ? "Partial COD" : "Prepaid"} ₹{Math.round(r.total / 100).toLocaleString("en-IN")}</p>
                  <p className="truncate text-[11px] text-ink-faint">{c?.name ?? r.courier} · <span className="font-mono">{r.awb}</span>{r.at ? ` · ${new Date(r.at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}` : ""}</p>
                </div>
              </li>
            );
          })}
        </ul>
        <div className="hidden overflow-x-auto sm:block">
          <table className="table min-w-[760px]">
            <thead><tr><th>Order</th><th>Customer</th><th>Courier · AWB</th><th>Status</th><th>Updated</th></tr></thead>
            <tbody>
              {sh.rows.map((r) => {
                const c = COURIERS.find((x) => x.id === r.courier);
                const st = (r.status ?? "in_transit") as ShipStatus;
                return (
                  <tr key={r.id}>
                    <td><span className="num font-medium">{r.name ?? r.id}</span><span className="block text-xs text-ink-faint">{r.method === "cod" ? "COD" : r.method === "partial" ? "Partial COD" : "Prepaid"} · ₹{Math.round(r.total / 100).toLocaleString("en-IN")}</span></td>
                    <td className="text-sm">{r.customer.firstName} {r.customer.lastName}<span className="block text-xs text-ink-faint">{r.customer.city} {r.customer.pincode}</span></td>
                    <td className="text-sm">{c?.name ?? r.courier ?? "—"}<span className="block font-mono text-[11px] text-ink-faint">{r.awb}</span></td>
                    <td><span className="inline-flex items-center gap-1.5 text-sm font-medium"><span className={`h-2 w-2 rounded-full ${STATUS_DOT[st] ?? "bg-sky-500"}`} />{SHIP_STATUS_LABELS[st] ?? st}</span>{r.raw && <span className="block max-w-[220px] truncate text-[11px] text-ink-faint">{r.raw}</span>}</td>
                    <td className="text-xs text-ink-soft">{r.at ? new Date(r.at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </>)}
      {(sh.page > 1 || sh.hasMore) && (
        <div className="flex justify-between border-t border-rule px-5 py-3 text-sm">
          <button type="button" className="btn-quiet" disabled={sh.page <= 1} onClick={() => go({ page: String(sh.page - 1) })}>← Newer</button>
          <button type="button" className="btn-quiet" disabled={!sh.hasMore} onClick={() => go({ page: String(sh.page + 1) })}>Older →</button>
        </div>
      )}
    </section>
  );
}
