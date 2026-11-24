import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { platformName, storeConnected } from "~/lib/platform.server";
import { json } from "@remix-run/node";
import { Form, Link, useActionData, useFetcher, useLoaderData, useNavigation, useRevalidator, useSearchParams } from "@remix-run/react";
import { useEffect, useState } from "react";
import { CourierLogo } from "~/components/CourierLogo";
import { Icon } from "~/components/Icons";
import { Notice, PasswordInput, Spinner, SubmitButton } from "~/components/ui";
import { requireStore, requireViewer } from "~/lib/auth.server";
import { labelSummary } from "~/lib/labels-batch.server";
import { COURIERS, type CourierInfo } from "~/lib/courier-catalog";
import { env } from "~/lib/env.server";
import { arrangeCouriers, connectCourier, courierAccountsFor, courierPerformance, disconnectCourier, shipmentList, shipmentSummary, syncStoreShipments, type DateWindow } from "~/lib/logistics.server";
import { addDays, rangeLabel, resolveRange } from "~/lib/dates";
import { RangePicker } from "~/components/Overview";
import { reattemptOrders } from "~/lib/ofd-calls.server";
import { ordinal } from "~/lib/ofd";
import { SHIP_FILTERS, type ShipFilter } from "~/lib/rto-shield";
import { SHIP_STATUS_LABELS, type ShipStatus } from "~/lib/rto-shield";
import { storePath } from "~/lib/store-code";
import { db, stores } from "~/db.server";
import { cleanShipRule, shipRuleOf, type ShipRule } from "~/lib/ship-rule";
import { callersFor } from "~/lib/calls.server";
import { eq } from "drizzle-orm";

const maskEmail = (e?: string) => (e ? e.replace(/^(.{2})[^@]*/, "$1•••") : null);

export async function loader({ request, params }: LoaderFunctionArgs) {
  const viewer = await requireViewer(request);
  const store = await requireStore(viewer, params.id);
  const url = new URL(request.url);
  const filter = (SHIP_FILTERS as readonly string[]).includes(url.searchParams.get("ship") ?? "") ? (url.searchParams.get("ship") as ShipFilter) : "all";
  const sp = new URLSearchParams(url.searchParams);
  if (!sp.get("range")) sp.set("range", "this_month"); // Shipments opens on this month; every other page opens on today
  const range = resolveRange(sp, store.createdAt.toISOString().slice(0, 10));
  const window: DateWindow = range.preset === "max" ? { from: null, to: null } : { from: new Date(`${range.since}T00:00:00+05:30`), to: new Date(`${addDays(range.until, 1)}T00:00:00+05:30`) };
  const q = url.searchParams.get("q") ?? "";
  const page = Math.max(1, Number(url.searchParams.get("page")) || 1);
  const per = Number(url.searchParams.get("per")) || 10;
  const [accounts, summary, performance, list, labels] = await Promise.all([
    courierAccountsFor(store.id), shipmentSummary(store.id, window),
    courierPerformance(store.id, window), shipmentList(store.id, { filter, q, page, window, per }), labelSummary(store.id),
  ]);
  return json({
    storeId: store.id,
    rule: shipRuleOf(store),
    waConfirm: store.confirmEnabled && store.confirmWhatsapp,
    callers: await callersFor(store).then((l) => l.length).catch(() => 0),
    shopify: storeConnected(store),
    platform: platformName(store),
    hookUrl: `${env.appUrl}/api/shipnex/${store.id}`,
    srHookUrl: `${env.appUrl}/api/ship-hook/${store.id}`,
    accounts: accounts.map((a) => ({
      id: a.id, courier: a.courier, name: a.name, priority: a.priority, autoShip: a.autoShip, status: a.status, lastError: a.lastError,
      viaShopify: Boolean(a.creds.viaShopify),
      books: a.status === "connected" && !a.creds.viaShopify && Boolean((a.courier === "delhivery" && a.creds.token && a.creds.pickupName) || (a.courier === "shiprocket" && a.creds.email && a.creds.password)),
      who: a.courier === "shipnex" ? null : a.creds.viaShopify ? `Tracked from ${platformName(store)}` : a.creds.token && a.courier !== "shiprocket" ? `Token ••••${a.creds.token.slice(-4)}` : maskEmail(a.creds.email) ?? a.creds.username ?? a.creds.label ?? null,
      clientName: a.creds.clientName ?? a.creds.label ?? null,
      pickupName: a.creds.pickupName ?? null,
      srPick: a.creds.srPick ?? "cheapest",
      secret: a.courier === "shipnex" || a.courier === "shiprocket" ? a.creds.token ?? null : null,
      lastSyncAt: a.lastSyncAt?.toISOString() ?? null,
    })),
    summary,
    labels: { ...labels, on: accounts.some((a) => (a.courier === "delhivery" || a.courier === "shiprocket") && a.status === "connected" && !a.creds.viaShopify) },
    performance, range, rangeText: rangeLabel(range),
    shipments: { filter, q, page, per: list.per, total: list.total, hasMore: list.hasMore, rows: list.rows.map((r) => ({ ...r, at: r.at?.toISOString() ?? null, createdAt: r.createdAt.toISOString(), labelAt: r.labelAt?.toISOString() ?? null, reattemptAt: r.reattemptAt?.toISOString() ?? null })) },
  });
}

type R = { ok: string | null; error: string | null; courier?: string };

export async function action({ request, params }: ActionFunctionArgs) {
  const store = await requireStore(await requireViewer(request), params.id);
  const fd = await request.formData();
  const intent = String(fd.get("intent") ?? "");
  const courier = String(fd.get("courier") ?? "");
  const accountId = Number(fd.get("accountId")) || null;
  const name = COURIERS.find((c) => c.id === courier)?.name ?? "Courier";
  if (intent === "connect") {
    const get = (k: string) => String(fd.get(k) ?? "");
    const r = await connectCourier(store, courier, { token: get("token"), clientName: get("clientName"), email: get("email"), password: get("password"), clientId: get("clientId"), username: get("username"), label: get("label"), mode: get("mode"), pickupName: get("pickupName"), srPick: get("srPick"), name: get("name") }, accountId);
    if (!r.ok) return json<R>({ ok: null, error: r.error, courier }, { status: 400 });
    return json<R>({ ok: "connected", error: null, courier });
  }
  if (intent === "reattempt") {
    const viewer = await requireViewer(request);
    const by = viewer.role === "admin" ? viewer.staff?.name ?? "Growpefy" : viewer.member?.name ?? viewer.name;
    const r = await reattemptOrders(store, fd.getAll("orderId").map(String), by);
    return json<R>("error" in r ? { ok: null, error: r.error ?? "Failed" } : { ok: r.ok, error: null });
  }
  if (intent === "sync") {
    const r = await syncStoreShipments(store, { force: true });
    return json<R>({ ok: `Synced. ${r.linked} new shipment${r.linked === 1 ? "" : "s"} found, ${r.updated} status update${r.updated === 1 ? "" : "s"}.`, error: null });
  }
  if (intent === "shipRule") {
    const rule = cleanShipRule({ mode: String(fd.get("mode")) as ShipRule["mode"], by: String(fd.get("by")) as ShipRule["by"], prepaidNow: fd.get("prepaidNow") === "on" });
    await db.update(stores).set({ shipRule: rule, autoShip: rule.mode !== "off" }).where(eq(stores.id, store.id));
    return json<R>({ ok: "Shipping rules saved.", error: null });
  }
  if (intent === "arrange") {
    let order: number[] = [], patch: Record<number, { name?: string; autoShip?: boolean }> = {};
    try { order = JSON.parse(String(fd.get("order") ?? "[]")); patch = JSON.parse(String(fd.get("patch") ?? "{}")); } catch { /* keep */ }
    await arrangeCouriers(store.id, order.map(Number).filter(Boolean), patch);
    return json<R>({ ok: "Courier order saved.", error: null });
  }
  if (intent === "disconnect") {
    await disconnectCourier(store.id, accountId ?? courier);
    return json<R>({ ok: `${name} removed`, error: null });
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
const courierInfo = (id: string) => COURIERS.find((c) => c.id === id);
const accName = (a: Pick<Acc, "name" | "courier" | "clientName">) => a.name ?? (a.courier === "other" && a.clientName ? a.clientName : courierInfo(a.courier)?.name ?? a.courier);

const TILES: { s: ShipStatus; dot: string }[] = [
  { s: "pickup_pending", dot: "bg-slate-400" },
  { s: "in_transit", dot: "bg-sky-500" },
  { s: "out_for_delivery", dot: "bg-indigo-500" },
  { s: "ndr", dot: "bg-orange-500" },
  { s: "delivered", dot: "bg-emerald-500" },
  { s: "rto_transit", dot: "bg-amber-500" },
  { s: "rto", dot: "bg-red-500" },
  { s: "returned", dot: "bg-fuchsia-500" },
];

const KIND_TAG: Record<CourierInfo["kind"], { t: string; cls: string }> = {
  api: { t: "Live API", cls: "bg-emerald-50 text-emerald-700" },
  shopify: { t: "Via store orders", cls: "bg-sky-50 text-sky-700" },
  push: { t: "Live push", cls: "bg-violet-50 text-violet-700" },
};

const GROUPS: { key: string; title: string; text: string; test: (c: CourierInfo) => boolean }[] = [
  { key: "api", title: "Live API", text: "We log in to the courier and read every scan.", test: (c) => c.kind === "api" },
  { key: "shopify", title: "Tracked from your store", text: "No login needed. We read the delivery status your courier app adds to your Shopify or WooCommerce orders.", test: (c) => c.kind === "shopify" && c.id !== "other" },
  { key: "more", title: "Other & Shipnex", text: "Not in the list? Add it as Other. Shipping with Shipnex? It pushes updates to us live.", test: (c) => c.id === "other" || c.kind === "push" },
];

type Sheet = null | { tab: "couriers" | "rules" | "labels" } | { connect: string; accountId: number | null } | { catalog: true };

export default function Logistics() {
  const d = useLoaderData<typeof loader>();
  const r = useActionData<typeof action>();
  const [sheet, setSheet] = useState<Sheet>(null);
  useEffect(() => {
    if (r?.ok === "connected") setSheet({ tab: "couriers" });
    else if (r?.error && r.courier && !(sheet && "connect" in sheet)) setSheet({ connect: r.courier, accountId: null });
  }, [r]); // eslint-disable-line react-hooks/exhaustive-deps
  const total = Object.values(d.summary).reduce((a, b) => a + (b ?? 0), 0);
  const has = d.accounts.length > 0;
  const canBook = d.accounts.some((a) => a.books);

  return (
    <div className="mx-auto w-full max-w-6xl space-y-4">
      {r?.ok && r.ok !== "connected" && <Notice tone="success">{r.ok}</Notice>}
      {r?.error && !r.courier && <Notice tone="error">{r.error}</Notice>}

      {has ? <Overview d={d} total={total} canBook={canBook} onGear={() => setSheet({ tab: "couriers" })} /> : (
        <section className="panel flex flex-col items-center px-6 py-14 text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-pine-tint text-pine"><Icon name="shipping" className="h-6 w-6" /></span>
          <h2 className="mt-4 text-[17px] font-semibold tracking-tight">Connect your courier</h2>
          <p className="mt-1 max-w-md text-[13px] text-ink-soft">Book shipments automatically, track every AWB and turn on RTO Shield. Connect as many accounts as you use, even several of the same courier.</p>
          <button type="button" onClick={() => setSheet({ catalog: true })} className="btn-primary mt-5 h-10 px-5 text-sm">Connect a courier</button>
        </section>
      )}

      {has && <Shipments d={d} />}

      {sheet && "tab" in sheet && <SettingsSheet d={d} tab={sheet.tab} setTab={(t) => setSheet({ tab: t })} onClose={() => setSheet(null)}
        onAdd={() => setSheet({ catalog: true })} onEdit={(a) => setSheet({ connect: a.courier, accountId: a.id })} />}
      {sheet && "catalog" in sheet && <Catalog onPick={(id) => setSheet({ connect: id, accountId: null })} onClose={() => setSheet(has ? { tab: "couriers" } : null)} />}
      {sheet && "connect" in sheet && (() => {
        const c = courierInfo(sheet.connect);
        if (!c) return null;
        const a = sheet.accountId ? d.accounts.find((x) => x.id === sheet.accountId) : undefined;
        return <ConnectSheet c={c} a={a} error={r?.courier === c.id ? r.error : null} hookUrl={c.id === "shiprocket" ? d.srHookUrl : d.hookUrl} onClose={() => setSheet(has ? { tab: "couriers" } : null)} />;
      })()}
    </div>
  );
}

/** One card: the numbers, where shipments stand, and each courier account's results. */
function Overview({ d, total, canBook, onGear }: { d: D; total: number; canBook: boolean; onGear: () => void }) {
  const [sp, setSp] = useSearchParams();
  const s = d.summary;
  const delivered = s.delivered ?? 0;
  const rto = (s.rto ?? 0) + (s.rto_transit ?? 0) + (s.returned ?? 0);
  const done = delivered + rto;
  const rate = (n: number) => (done ? `${Math.round((n / done) * 100)}%` : "–");
  const base = storePath(d.storeId);
  const revalidator = useRevalidator();
  const nav = useNavigation();
  const syncing = nav.state === "submitting" && nav.formData?.get("intent") === "sync";
  void sp; void setSp;
  const showNdr = () => { const n = new URLSearchParams(sp); n.set("ship", "ndr"); n.delete("page"); setSp(n, { preventScrollReset: true }); document.getElementById("shipments")?.scrollIntoView({ behavior: "smooth" }); };
  const cells = [
    { label: "Shipments", value: total.toLocaleString("en-IN"), sub: d.rangeText },
    { label: "Delivered", value: rate(delivered), sub: done ? `${delivered.toLocaleString("en-IN")} orders` : "No results yet", tone: done ? "text-[#067647]" : "" },
    { label: "RTO", value: rate(rto), sub: done ? `${rto.toLocaleString("en-IN")} orders` : "No results yet", tone: done && rto / done > 0.2 ? "text-[#b42318]" : "" },
    { label: "In transit", value: (s.in_transit ?? 0).toLocaleString("en-IN"), sub: s.pickup_pending ? `+${s.pickup_pending.toLocaleString("en-IN")} awaiting pickup` : "On the way" },
    { label: "Out for delivery", value: (s.out_for_delivery ?? 0).toLocaleString("en-IN"), sub: "With the delivery agent", tone: s.out_for_delivery ? "text-[#3538cd]" : "" },
    { label: "NDR", value: (s.ndr ?? 0).toLocaleString("en-IN"), sub: s.ndr ? "Delivery failed · re-attempt" : "No failed deliveries", tone: s.ndr ? "text-[#b54708]" : "", onClick: s.ndr ? showNdr : undefined },
  ];
  const accById = new Map(d.accounts.map((a) => [a.id, a]));
  return (
    <section className="panel overflow-hidden p-0">
      <header className="flex flex-wrap items-center gap-3 px-5 pb-3 pt-4">
        <div className="w-full min-w-0 sm:w-auto sm:flex-1">
          <h1 className="text-[17px] font-semibold tracking-tight">Shipping</h1>
          <p className="text-[12.5px] text-ink-soft">{d.accounts.length} courier account{d.accounts.length === 1 ? "" : "s"} · {canBook ? MODES.find((m) => m.id === d.rule.mode)?.short : "Tracking only"}</p>
        </div>
        <RangePicker current={d.range} align="right" />
        <Form method="post">
          <button name="intent" value="sync" disabled={syncing} title="Sync now" className="flex h-9 items-center gap-1.5 rounded-lg bg-white px-3 text-[13px] font-medium text-ink shadow-[inset_0_0_0_1px_#d4d4d4] hover:bg-paper disabled:opacity-60">
            <Icon name="refresh" className={`h-4 w-4 ${syncing ? "animate-spin" : ""}`} />{syncing ? "Syncing" : "Sync now"}
          </button>
        </Form>
        {d.labels.on && (
          <form method="post" action={`${base}/logistics/labels`} target="_blank" onSubmit={(e) => { if (!d.labels.pending) { e.preventDefault(); return; } setTimeout(() => revalidator.revalidate(), 4000); }}>
            <button type="submit" aria-label={d.labels.pending ? `Download ${d.labels.pending} new shipping labels` : "No new labels to download"} title={d.labels.pending ? `Download ${d.labels.pending} new label${d.labels.pending === 1 ? "" : "s"}` : "Every label is printed"}
              className="relative flex h-9 w-9 items-center justify-center rounded-lg bg-white text-ink shadow-[inset_0_0_0_1px_#d4d4d4] hover:bg-paper disabled:opacity-50">
              <Icon name="download" className="h-4 w-4" />
              {d.labels.pending > 0 && <span className="num absolute -right-1.5 -top-1.5 min-w-[18px] rounded-full bg-[#d92d20] px-1 text-center text-[10.5px] font-semibold leading-[18px] text-white">{d.labels.pending > 99 ? "99+" : d.labels.pending}</span>}
            </button>
          </form>
        )}
        <button type="button" onClick={onGear} aria-label="Shipping settings" title="Settings" className="flex h-9 w-9 items-center justify-center rounded-lg bg-white text-ink shadow-[inset_0_0_0_1px_#d4d4d4] hover:bg-paper">
          <Icon name="settings" className="h-[18px] w-[18px]" />
        </button>
      </header>

      <div className="grid grid-cols-2 gap-px border-t border-rule bg-rule sm:grid-cols-3 lg:grid-cols-6">
        {cells.map((c) => {
          const body = <>
            <p className="text-[12px] font-medium text-ink-soft">{c.label}</p>
            <p className={`num mt-0.5 text-[22px] font-semibold leading-tight tracking-tight ${c.tone || "text-ink"}`}>{c.value}</p>
            <p className="text-[11.5px] text-ink-faint">{c.sub}</p>
          </>;
          return "onClick" in c && c.onClick
            ? <button key={c.label} type="button" onClick={c.onClick} className="bg-surface px-5 py-3.5 text-left hover:bg-[#fafafa]">{body}</button>
            : <div key={c.label} className="bg-surface px-5 py-3.5">{body}</div>;
        })}
      </div>
      {total > 0 && (
        <div className="border-t border-rule px-5 py-3">
          <div className="flex h-2 w-full overflow-hidden rounded-full bg-paper-sunk" role="img" aria-label="Shipments by status">
            {TILES.map((t) => { const n = s[t.s] ?? 0; return n ? <span key={t.s} className={t.dot} style={{ width: `${(n / total) * 100}%` }} title={`${SHIP_STATUS_LABELS[t.s]}: ${n}`} /> : null; })}
          </div>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
            {TILES.map((t) => <span key={t.s} className="flex items-center gap-1.5 text-[11.5px] text-ink-soft"><span className={`h-1.5 w-1.5 rounded-full ${t.dot}`} />{SHIP_STATUS_LABELS[t.s]} <b className="num font-semibold text-ink">{(s[t.s] ?? 0).toLocaleString("en-IN")}</b></span>)}
          </div>
        </div>
      )}

      <div className="border-t border-rule">
        <div className="flex items-center justify-between px-5 pb-1 pt-3">
          <p className="text-[12px] font-semibold uppercase tracking-wide text-ink-soft">Couriers</p>
          <span className="text-[11.5px] text-ink-faint">{d.rangeText}</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-[13px]">
            <thead><tr className="text-left text-[11.5px] text-ink-faint">
              <th className="px-5 py-2 font-medium">Account</th><th className="px-3 py-2 text-right font-medium">Shipped</th><th className="px-3 py-2 text-right font-medium">Delivered</th>
              <th className="px-3 py-2 text-right font-medium">RTO</th><th className="px-3 py-2 text-right font-medium">In transit</th><th className="w-[24%] px-5 py-2 font-medium">Delivery rate</th>
            </tr></thead>
            <tbody>
              {d.accounts.map((a) => {
                const p = d.performance.find((x) => x.accountId === a.id) ?? { total: 0, delivered: 0, rto: 0, transit: 0 };
                const c = courierInfo(a.courier);
                const rr = p.delivered + p.rto ? Math.round((p.delivered / (p.delivered + p.rto)) * 100) : null;
                return (
                  <tr key={a.id} className="border-t border-rule">
                    <td className="px-5 py-2.5">
                      <span className="flex items-center gap-2.5">
                        {c && <CourierLogo c={c} size={26} />}
                        <span className="min-w-0">
                          <span className="flex items-center gap-1.5 font-medium">{accName(a)}{a.books && a.autoShip && <span className="num rounded bg-paper-sunk px-1 text-[10.5px] font-semibold text-ink-soft" title="Booking order">#{a.priority}</span>}</span>
                          <span className={`block text-[11.5px] ${a.status === "connected" ? "text-ink-faint" : "text-[#b42318]"}`}>{a.status === "connected" ? ago(a.lastSyncAt) : "Needs attention"}</span>
                        </span>
                      </span>
                    </td>
                    <td className="num px-3 text-right">{p.total}</td>
                    <td className="num px-3 text-right text-[#067647]">{p.delivered}</td>
                    <td className="num px-3 text-right text-[#b42318]">{p.rto}</td>
                    <td className="num px-3 text-right">{p.transit}</td>
                    <td className="px-5">
                      <div className="flex items-center gap-2">
                        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-red-100"><div className="h-full rounded-full bg-emerald-500" style={{ width: `${rr ?? 0}%` }} /></div>
                        <span className="num w-9 text-right text-[12px] font-semibold">{rr == null ? "–" : `${rr}%`}</span>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {d.performance.filter((p) => !p.accountId || !accById.has(p.accountId)).map((p) => (
                <tr key={p.key} className="border-t border-rule text-ink-soft">
                  <td className="px-5 py-2.5">{courierInfo(p.courier)?.name ?? p.courier} <span className="text-[11.5px] text-ink-faint">(not connected)</span></td>
                  <td className="num px-3 text-right">{p.total}</td><td className="num px-3 text-right">{p.delivered}</td><td className="num px-3 text-right">{p.rto}</td><td className="num px-3 text-right">{p.transit}</td><td className="px-5" />
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {d.accounts.some((a) => a.lastError) && <div className="space-y-1 px-5 pb-3">{d.accounts.filter((a) => a.lastError).map((a) => <p key={a.id} className="rounded-lg bg-[#fdeceb] px-3 py-1.5 text-[12px] text-[#8e1f0b]"><b className="font-semibold">{accName(a)}:</b> {a.lastError}</p>)}</div>}
      </div>
    </section>
  );
}

/** Right-side settings: courier accounts (booking order), auto-shipping, labels. */
function SettingsSheet({ d, tab, setTab, onClose, onAdd, onEdit }: { d: D; tab: "couriers" | "rules" | "labels"; setTab: (t: "couriers" | "rules" | "labels") => void; onClose: () => void; onAdd: () => void; onEdit: (a: Acc) => void }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    const prev = document.body.style.overflow; document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", k); document.body.style.overflow = prev; };
  }, [onClose]);
  const tabs = [["couriers", "Couriers"], ["rules", "Auto-shipping"], ["labels", "Labels"]] as const;
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-slate-950/35" onClick={onClose}>
      <aside className="flex h-full w-full flex-col bg-white shadow-2xl sm:max-w-[34rem]" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal aria-label="Shipping settings">
        <div className="flex items-center gap-2 px-5 pb-2 pt-4">
          <h2 className="flex-1 text-[16px] font-semibold tracking-tight">Shipping settings</h2>
          <button type="button" onClick={onClose} className="rounded-lg p-2 text-ink-faint hover:bg-paper hover:text-ink" aria-label="Close"><Icon name="close" className="h-4 w-4" /></button>
        </div>
        <nav className="flex gap-1 border-b border-rule px-4" role="tablist">
          {tabs.map(([id, l]) => <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => setTab(id)} className={`border-b-2 px-3 py-2.5 text-[13px] font-medium ${tab === id ? "border-ink text-ink" : "border-transparent text-ink-soft hover:text-ink"}`}>{l}</button>)}
        </nav>
        <div className="flex-1 overflow-y-auto p-5">
          {tab === "couriers" && <CourierAccounts d={d} onAdd={onAdd} onEdit={onEdit} />}
          {tab === "rules" && (d.accounts.some((a) => a.books) ? <ShipRules d={d} /> : <p className="text-[13px] text-ink-soft">Connect Delhivery (with a pickup location) or Shiprocket with its login to book orders automatically.</p>)}
          {tab === "labels" && <LabelSettings d={d} />}
        </div>
      </aside>
    </div>
  );
}

/** The store's accounts in booking order: the first is tried first; if it fails, the next one. */
function CourierAccounts({ d, onAdd, onEdit }: { d: D; onAdd: () => void; onEdit: (a: Acc) => void }) {
  const f = useFetcher<R>();
  const [list, setList] = useState(d.accounts);
  useEffect(() => setList(d.accounts), [d.accounts]);
  const dirty = JSON.stringify(list.map((a) => [a.id, a.name, a.autoShip])) !== JSON.stringify(d.accounts.map((a) => [a.id, a.name, a.autoShip]));
  const move = (i: number, step: -1 | 1) => setList((l) => { const n = [...l]; const j = i + step; if (j < 0 || j >= n.length) return l; [n[i], n[j]] = [n[j], n[i]]; return n; });
  const save = () => f.submit({ intent: "arrange", order: JSON.stringify(list.map((a) => a.id)), patch: JSON.stringify(Object.fromEntries(list.map((a) => [a.id, { name: a.name ?? "", autoShip: a.autoShip }]))) }, { method: "post" });
  const bookers = list.filter((a) => a.books && a.autoShip);
  return (
    <div className="space-y-4">
      <p className="text-[12.5px] text-ink-soft">Orders are booked with the first account. If it fails (pincode, wallet, any error), the next one tries, then the next.</p>
      <ol className="space-y-2">
        {list.map((a, i) => {
          const c = courierInfo(a.courier);
          const pos = bookers.findIndex((b) => b.id === a.id);
          return (
            <li key={a.id} className="rounded-xl p-3 shadow-[inset_0_0_0_1px_#e3e3e3]">
              <div className="flex items-center gap-2.5">
                <span className={`num flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold ${pos >= 0 ? "bg-ink text-white" : "bg-paper-sunk text-ink-faint"}`}>{pos >= 0 ? pos + 1 : "–"}</span>
                {c && <CourierLogo c={c} size={28} />}
                <input value={a.name ?? ""} placeholder={accName({ ...a, name: null })} onChange={(e) => setList((l) => l.map((x) => (x.id === a.id ? { ...x, name: e.target.value } : x)))} aria-label="Account name"
                  className="min-w-0 flex-1 rounded-md bg-transparent px-1.5 py-1 text-[13.5px] font-semibold hover:bg-paper focus:bg-white focus:outline-none focus:ring-1 focus:ring-rule-strong" />
                <div className="flex">
                  <button type="button" onClick={() => move(i, -1)} disabled={i === 0} aria-label="Move up" className="flex h-7 w-7 items-center justify-center rounded-md text-ink-soft hover:bg-paper disabled:opacity-30"><Icon name="chevron" className="h-4 w-4 rotate-180" /></button>
                  <button type="button" onClick={() => move(i, 1)} disabled={i === list.length - 1} aria-label="Move down" className="flex h-7 w-7 items-center justify-center rounded-md text-ink-soft hover:bg-paper disabled:opacity-30"><Icon name="chevron" className="h-4 w-4" /></button>
                </div>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 pl-[34px] text-[12px]">
                <span className={a.status === "connected" ? "text-ink-faint" : "font-medium text-[#b42318]"}>{a.status === "connected" ? [a.who, a.pickupName ? `Pickup: ${a.pickupName}` : null, ago(a.lastSyncAt)].filter(Boolean).join(" · ") : "Needs attention"}</span>
                {a.books && (
                  <label className="flex cursor-pointer items-center gap-1.5 text-ink-soft"><input type="checkbox" checked={a.autoShip} onChange={(e) => setList((l) => l.map((x) => (x.id === a.id ? { ...x, autoShip: e.target.checked } : x)))} className="h-3.5 w-3.5 accent-[rgb(var(--brand))]" />Books orders</label>
                )}
                <span className="ml-auto flex gap-1">
                  <button type="button" onClick={() => onEdit(a)} className="rounded-md px-2 py-1 font-medium text-[#005bd3] hover:bg-paper">Edit</button>
                  <Form method="post" onSubmit={(e) => { if (!window.confirm(`Remove ${accName(a)}? Its shipments stop updating.`)) e.preventDefault(); }}>
                    <input type="hidden" name="accountId" value={a.id} /><input type="hidden" name="courier" value={a.courier} />
                    <button name="intent" value="disconnect" className="rounded-md px-2 py-1 font-medium text-[#b42318] hover:bg-[#fdeceb]">Remove</button>
                  </Form>
                </span>
              </div>
              {a.lastError && <p className="mt-2 rounded-lg bg-[#fdeceb] px-2.5 py-1.5 text-[11.5px] text-[#8e1f0b]">{a.lastError}</p>}
            </li>
          );
        })}
      </ol>
      <div className="flex items-center gap-2">
        <button type="button" onClick={onAdd} className="btn-secondary h-9 flex-1 text-[13px]"><Icon name="plus" className="h-4 w-4" />Add courier account</button>
        {dirty && <button type="button" onClick={save} disabled={f.state !== "idle"} className="btn-primary h-9 px-4 text-[13px]">{f.state !== "idle" ? "Saving…" : "Save order"}</button>}
      </div>
      {f.data?.ok && !dirty && <p className="text-[12px] text-[#067647]">{f.data.ok}</p>}
    </div>
  );
}

function LabelSettings({ d }: { d: D }) {
  const base = storePath(d.storeId);
  return (
    <div className="space-y-4">
      <Link to={`${base}/logistics/label-design`} className="flex items-center gap-3 rounded-xl p-3.5 shadow-[inset_0_0_0_1px_#e3e3e3] hover:bg-paper">
        <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-paper-sunk"><Icon name="design" className="h-[18px] w-[18px]" /></span>
        <span className="min-w-0 flex-1"><span className="block text-[13.5px] font-semibold">Label design</span><span className="block text-[12px] text-ink-soft">Size, logo and what your labels show</span></span>
        <Icon name="chevron" className="h-4 w-4 -rotate-90 text-ink-faint" />
      </Link>
      <div>
        <p className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-ink-soft">Printed batches · last 15 days</p>
        {d.labels.batches.length ? (
          <ul className="divide-y divide-rule rounded-xl shadow-[inset_0_0_0_1px_#e3e3e3]">
            {d.labels.batches.map((b) => (
              <li key={b.batch} className="flex items-center gap-3 px-3.5 py-2.5 text-[13px]">
                <span className="min-w-0 flex-1"><span className="font-medium">{b.batch}</span><span className="ml-2 text-ink-faint">{b.count} label{b.count === 1 ? "" : "s"}</span></span>
                <a href={`${base}/logistics/labels?batch=${encodeURIComponent(b.batch)}`} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-[12.5px] font-medium text-[#005bd3]"><Icon name="download" className="h-3.5 w-3.5" />Reprint</a>
              </li>
            ))}
          </ul>
        ) : <p className="text-[13px] text-ink-faint">Nothing printed yet. The download button on the Shipping page prints every new label.</p>}
      </div>
    </div>
  );
}

function Catalog({ onPick, onClose }: { onPick: (id: string) => void; onClose: () => void }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/40 sm:items-center sm:p-4" onClick={onClose} role="dialog" aria-modal aria-label="Add a courier">
      <div className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-t-2xl bg-white p-5 shadow-2xl sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2">
          <h2 className="flex-1 text-[16px] font-semibold tracking-tight">Add a courier account</h2>
          <button type="button" onClick={onClose} className="rounded-lg p-2 text-ink-faint hover:bg-paper hover:text-ink" aria-label="Close"><Icon name="close" className="h-4 w-4" /></button>
        </div>
        <p className="text-[12.5px] text-ink-soft">You can add the same courier more than once, e.g. three Delhivery accounts with their own API tokens.</p>
        {GROUPS.map((g) => (
          <div key={g.key} className="mt-5">
            <p className="text-[11.5px] font-semibold uppercase tracking-wide text-ink-faint">{g.title}</p>
            <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
              {COURIERS.filter(g.test).map((c) => (
                <button key={c.id} type="button" onClick={() => onPick(c.id)} className="flex items-center gap-2.5 rounded-xl p-2.5 text-left shadow-[inset_0_0_0_1px_#e3e3e3] hover:bg-paper">
                  <CourierLogo c={c} size={32} />
                  <span className="min-w-0"><span className="block truncate text-[13px] font-semibold">{c.name}</span><span className="block truncate text-[11px] text-ink-faint">{c.tagline}</span></span>
                </button>
              ))}
            </div>
          </div>
        ))}
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
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/40 p-0 sm:items-center sm:p-4" onClick={onClose} role="dialog" aria-modal aria-label={`${verb} ${c.name}`}>
      <div className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-t-2xl bg-white shadow-2xl sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-3 border-b border-rule px-5 py-4">
          <CourierLogo c={c} size={40} />
          <div className="min-w-0 flex-1">
            <p className="flex items-center gap-2 font-semibold">{a ? accName(a) : c.name}<span className={`rounded px-1.5 py-px text-[10px] font-semibold ${tag.cls}`}>{tag.t}</span></p>
            <p className="text-xs text-ink-faint">{a ? "Update this account" : c.tagline}</p>
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
            {a && <input type="hidden" name="accountId" value={a.id} />}
            {error && <Notice tone="error">{error}</Notice>}
            <label className="block">
              <span className="mb-1 block text-xs font-medium">Account name<span className="font-normal text-ink-faint"> · optional</span></span>
              <input name="name" defaultValue={a?.name ?? ""} placeholder={`e.g. ${c.name} Surat`} maxLength={60} className="input h-10 text-sm" />
            </label>
            {c.id === "shiprocket" && a?.secret && !a.viaShopify && (
              <div className="space-y-2 rounded-xl bg-paper p-3 text-xs">
                <p className="font-semibold">Live status (optional, recommended)</p>
                <p className="text-[11px] text-ink-soft">In Shiprocket open Settings → API → Webhooks, turn on the shipment-status webhook and paste these.</p>
                <Copy label="URL" value={hookUrl} />
                <Copy label="Token (x-api-key)" value={a.secret} />
              </div>
            )}
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
                  defaultValue={f.name === "label" ? a?.clientName ?? "" : f.name === "pickupName" ? a?.pickupName ?? "" : ""}
                  autoComplete={f.type === "password" ? "new-password" : "off"} spellCheck={false} required={!f.optional && !(f.name === "password" && a)} />
                {f.hint && <span className="mt-1 block text-[11px] text-ink-faint">{f.hint}</span>}
              </label>
            ))}
            {c.id === "shiprocket" && (
              <label className="block">
                <span className="mb-1 block text-xs font-medium">Courier for each order</span>
                <select name="srPick" defaultValue={a?.srPick ?? "cheapest"} className="input h-10 text-sm">
                  <option value="cheapest">Cheapest courier for the pincode</option>
                  <option value="recommended">Shiprocket's recommended courier</option>
                  <option value="fastest">Fastest delivery</option>
                  <option value="manual">I'll choose in Shiprocket</option>
                </select>
                <span className="mt-1 block text-[11px] text-ink-faint">Growpefy creates the order in Shiprocket, assigns this courier (AWB) and asks for pickup. The courier charge comes from your Shiprocket wallet.</span>
              </label>
            )}
            {!(c.kind === "push" && a) && (
              <button type="submit" name="intent" value="connect" className="btn-primary w-full py-2.5 text-sm" disabled={busy}>
                {busy ? <><Spinner /> {c.kind === "api" ? `Checking with ${c.name}` : "Saving"}</> : a ? "Save" : `${verb} ${c.name}`}
              </button>
            )}
            <p className="flex items-center gap-1.5 text-[11px] text-ink-faint"><Icon name="shield" className="h-3.5 w-3.5" />{c.kind === "api" ? "Passwords are encrypted." : "Read-only. Remove any time."}</p>
          </Form>
          {c.kind === "api" && !a && (
            <Form method="post" className="rounded-xl border border-dashed border-rule-strong p-3.5 sm:col-span-2">
              <input type="hidden" name="courier" value={c.id} />
              <input type="hidden" name="mode" value="shopify" />
              <div className="flex flex-wrap items-center gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold">No API {c.fields?.some((f) => f.name === "token") ? "token" : "login"}?</p>
                  <p className="text-xs text-ink-soft">Track {c.name} from your store orders instead (no automatic booking; updates are a little slower).</p>
                </div>
                <button type="submit" name="intent" value="connect" className="btn-secondary shrink-0 px-4 py-2 text-sm" disabled={busy}>Track without API</button>
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

const STATUS_DOT: Record<string, string> = { pickup_pending: "bg-slate-400", in_transit: "bg-sky-500", out_for_delivery: "bg-indigo-500", ndr: "bg-orange-500", delivered: "bg-emerald-500", rto_transit: "bg-amber-500", rto: "bg-red-500", returned: "bg-fuchsia-500", cancelled: "bg-slate-400" };
const FILTER_LABEL: Record<string, string> = { all: "All", pickup_pending: "Ready for pickup", in_transit: "In transit", out_for_delivery: "Out for delivery", ndr: "NDR", delivered: "Delivered", rto_transit: "RTO in transit", rto: "RTO", returned: "Returned" };
const PER = [10, 20, 30, 50, 100];
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) : "—");

function Shipments({ d }: { d: D }) {
  const [sp, setSp] = useSearchParams();
  const sh = d.shipments;
  const go = (patch: Record<string, string | null>) => {
    const n = new URLSearchParams(sp);
    for (const [k, v] of Object.entries(patch)) { if (v == null || v === "") n.delete(k); else n.set(k, v); }
    setSp(n, { preventScrollReset: true });
  };
  // Rows per page: the store's choice is remembered on this device
  const key = `gp-ship-per-${d.storeId}`;
  useEffect(() => {
    if (sp.get("per")) return;
    try { const v = Number(localStorage.getItem(key)); if (PER.includes(v) && v !== sh.per) go({ per: String(v), page: null }); } catch { /* storage off */ }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const setPer = (v: number) => { try { localStorage.setItem(key, String(v)); } catch { /* storage off */ } go({ per: String(v), page: null }); };
  const accName2 = (id: number | null, courier: string | null) => { const a = id ? d.accounts.find((x) => x.id === id) : d.accounts.find((x) => x.courier === courier); return a ? accName(a) : courierInfo(courier ?? "")?.name ?? courier ?? "—"; };
  const from = sh.total ? (sh.page - 1) * sh.per + 1 : 0, to = Math.min(sh.total, sh.page * sh.per);
  const ndrMode = sh.filter === "ndr";
  const [picked, setPicked] = useState<string[]>([]);
  useEffect(() => setPicked([]), [sh.filter, sh.page]);
  const canRe = (r: { courier: string | null; status: string | null }) => r.courier === "delhivery" && r.status === "ndr";
  const reRows = sh.rows.filter(canRe);
  const nav = useNavigation();
  const busy = nav.state !== "idle" && nav.formData?.get("intent") === "reattempt";
  return (
    <section className="panel overflow-hidden p-0" id="shipments">
      <div className="flex flex-wrap items-center gap-3 px-5 pb-2 pt-4">
        <h2 className="mr-auto text-[15px] font-semibold">Shipments</h2>
        <form onSubmit={(e) => { e.preventDefault(); go({ q: String(new FormData(e.currentTarget).get("q") ?? ""), page: null }); }} className="relative">
          <Icon name="search" className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-faint" />
          <input name="q" defaultValue={sh.q} placeholder="Order, AWB or phone" aria-label="Search shipments" className="input h-9 w-56 !pl-8 text-[13px]" />
        </form>
      </div>
      <div className="flex gap-1 overflow-x-auto border-b border-rule px-4" role="tablist">
        {SHIP_FILTERS.map((f) => (
          <button key={f} type="button" role="tab" aria-selected={sh.filter === f} onClick={() => go({ ship: f === "all" ? null : f, page: null })}
            className={`flex shrink-0 items-center gap-1.5 border-b-2 px-2.5 py-2.5 text-[12.5px] font-medium ${sh.filter === f ? "border-ink text-ink" : "border-transparent text-ink-soft hover:text-ink"}`}>
            {FILTER_LABEL[f]}{f !== "all" && d.summary[f as ShipStatus] ? <span className="num rounded bg-paper-sunk px-1.5 text-[11px] text-ink-soft">{d.summary[f as ShipStatus]}</span> : null}
          </button>
        ))}
      </div>
      {ndrMode && reRows.length > 0 && (
        <Form method="post" className="flex flex-wrap items-center gap-3 border-b border-rule bg-[#fff8f1] px-5 py-2.5 text-[12.5px]">
          <input type="hidden" name="intent" value="reattempt" />
          {(picked.length ? picked : []).map((id) => <input key={id} type="hidden" name="orderId" value={id} />)}
          <label className="flex items-center gap-2 font-medium">
            <input type="checkbox" className="h-4 w-4 accent-[#0B5D4B]" checked={picked.length === reRows.length} onChange={(e) => setPicked(e.target.checked ? reRows.map((r) => r.id) : [])} />
            Select all {reRows.length}
          </label>
          <span className="text-ink-soft">Failed deliveries. Ask Delhivery to try again.</span>
          <button type="submit" disabled={!picked.length || busy} className="btn-primary ml-auto h-8 px-3 text-[12.5px] disabled:opacity-50">
            <Icon name="refresh" className={`h-3.5 w-3.5 ${busy ? "animate-spin" : ""}`} />{busy ? "Sending…" : `Re-attempt${picked.length ? ` ${picked.length}` : ""}`}
          </button>
        </Form>
      )}
      {sh.rows.length === 0 ? (
        <p className="px-5 py-10 text-center text-[13px] text-ink-faint">No shipments here.</p>
      ) : (<>
        <ul className="divide-y divide-rule sm:hidden">
          {sh.rows.map((r) => {
            const st = (r.status ?? "in_transit") as ShipStatus;
            return (
              <li key={r.id} className="px-5 py-3">
                <p className="flex justify-between gap-2 text-[13px]"><span className="num font-semibold">{r.name ?? r.id}</span><span className="flex items-center gap-1.5 font-medium"><span className={`h-1.5 w-1.5 rounded-full ${STATUS_DOT[st] ?? "bg-sky-500"}`} />{SHIP_STATUS_LABELS[st] ?? st}<AttemptBadge n={r.attempts} status={st} /></span></p>
                {st === "ndr" && r.ndrReason && <p className="text-[11.5px] text-[#b54708]">{r.ndrReason}</p>}
                {ndrMode && canRe(r) && <div className="mt-1.5"><ReattemptButton id={r.id} at={r.reattemptAt} /></div>}
                <p className="truncate text-[12px] text-ink-soft">{r.customer.firstName} {r.customer.lastName} · {r.customer.city} · {r.method === "cod" ? "COD" : r.method === "partial" ? "Partial COD" : "Prepaid"} ₹{Math.round(r.total / 100).toLocaleString("en-IN")}</p>
                <p className="flex items-center justify-between gap-2 text-[11.5px] text-ink-faint"><span className="truncate">{accName2(r.accountId, r.courier)} · <span className="font-mono">{r.awb}</span></span><LabelChip r={r} base={storePath(d.storeId)} /></p>
              </li>
            );
          })}
        </ul>
        <div className="hidden overflow-x-auto sm:block">
          <table className="w-full min-w-[760px] text-[13px]">
            <thead><tr className="border-b border-rule bg-[#fafafa] text-left text-[11.5px] text-ink-soft">
              {ndrMode && <th className="w-8 pl-5" />}<th className="px-5 py-2 font-medium">Order</th><th className="px-3 py-2 font-medium">Customer</th><th className="px-3 py-2 font-medium">Courier · AWB</th><th className="px-3 py-2 font-medium">Status</th><th className="px-3 py-2 font-medium">{ndrMode ? "Action" : "Label"}</th><th className="px-5 py-2 text-right font-medium">Updated</th>
            </tr></thead>
            <tbody className="divide-y divide-rule">
              {sh.rows.map((r) => {
                const st = (r.status ?? "in_transit") as ShipStatus;
                return (
                  <tr key={r.id} className="hover:bg-[#fafafa]">
                    {ndrMode && <td className="pl-5">{canRe(r) && <input type="checkbox" aria-label={`Select ${r.name ?? r.id}`} className="h-4 w-4 accent-[#0B5D4B]" checked={picked.includes(r.id)} onChange={(e) => setPicked((p) => e.target.checked ? [...p, r.id] : p.filter((x) => x !== r.id))} />}</td>}
                    <td className="px-5 py-2.5"><span className="num font-semibold">{r.name ?? r.id}</span><span className="block text-[11.5px] text-ink-faint">{r.method === "cod" ? "COD" : r.method === "partial" ? "Partial COD" : "Prepaid"} · ₹{Math.round(r.total / 100).toLocaleString("en-IN")}</span></td>
                    <td className="px-3">{r.customer.firstName} {r.customer.lastName}<span className="block text-[11.5px] text-ink-faint">{r.customer.city} {r.customer.pincode}</span></td>
                    <td className="px-3">{accName2(r.accountId, r.courier)}<span className="block font-mono text-[11px] text-ink-faint">{r.awb}</span></td>
                    <td className="px-3"><span className="inline-flex flex-wrap items-center gap-1.5 font-medium"><span className={`h-1.5 w-1.5 rounded-full ${STATUS_DOT[st] ?? "bg-sky-500"}`} />{SHIP_STATUS_LABELS[st] ?? st}<AttemptBadge n={r.attempts} status={st} /></span>
                      {st === "ndr" && r.ndrReason ? <span className="block max-w-[220px] truncate text-[11px] text-[#b54708]" title={r.ndrReason}>{r.ndrReason}</span> : r.raw && <span className="block max-w-[200px] truncate text-[11px] text-ink-faint">{r.raw}</span>}</td>
                    <td className="px-3">{ndrMode ? (canRe(r) ? <ReattemptButton id={r.id} at={r.reattemptAt} /> : <span className="text-[11.5px] text-ink-faint">—</span>) : <LabelChip r={r} base={storePath(d.storeId)} />}</td>
                    <td className="px-5 text-right text-[12px] text-ink-soft">{when(r.at)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </>)}
      <div className="flex flex-wrap items-center gap-3 border-t border-rule px-5 py-2.5 text-[12.5px] text-ink-soft">
        <label className="flex items-center gap-2">Rows
          <select value={sh.per} onChange={(e) => setPer(Number(e.target.value))} className="h-7 rounded-md border border-rule bg-white px-1.5 text-[12.5px] text-ink">
            {PER.map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </label>
        <span className="num ml-auto">{sh.total ? `${from}–${to} of ${sh.total.toLocaleString("en-IN")}` : "0"}</span>
        <div className="flex">
          <button type="button" aria-label="Previous page" disabled={sh.page <= 1} onClick={() => go({ page: String(sh.page - 1) })} className="flex h-7 w-7 items-center justify-center rounded-md hover:bg-paper disabled:opacity-30"><Icon name="chevron" className="h-4 w-4 rotate-90" /></button>
          <button type="button" aria-label="Next page" disabled={!sh.hasMore} onClick={() => go({ page: String(sh.page + 1) })} className="flex h-7 w-7 items-center justify-center rounded-md hover:bg-paper disabled:opacity-30"><Icon name="chevron" className="h-4 w-4 -rotate-90" /></button>
        </div>
      </div>
    </section>
  );
}

function AttemptBadge({ n, status }: { n: number; status: string }) {
  if (n < 2 || !["out_for_delivery", "ndr", "delivered", "in_transit"].includes(status)) return null;
  return <span className="rounded-full bg-[#eef0ff] px-1.5 py-px text-[10.5px] font-semibold text-[#3538cd]">{ordinal(n)} attempt</span>;
}

function ReattemptButton({ id, at }: { id: string; at: string | null }) {
  const f = useFetcher<{ ok: string | null; error: string | null }>();
  const busy = f.state !== "idle";
  const done = f.data?.ok;
  return (
    <f.Form method="post" className="inline-flex flex-col items-start">
      <input type="hidden" name="intent" value="reattempt" /><input type="hidden" name="orderId" value={id} />
      <button type="submit" disabled={busy} className="inline-flex items-center gap-1 rounded-md bg-[#fff1e3] px-2 py-1 text-[11.5px] font-semibold text-[#8a4b00] hover:bg-[#ffe6cc] disabled:opacity-60">
        <Icon name="refresh" className={`h-3.5 w-3.5 ${busy ? "animate-spin" : ""}`} />{busy ? "Sending" : done ? "Requested" : "Re-attempt"}
      </button>
      {f.data?.error ? <span className="mt-0.5 max-w-[180px] text-[10.5px] text-[#b42318]">{f.data.error}</span>
        : at && !done ? <span className="mt-0.5 text-[10.5px] text-ink-faint">Asked {when(at)}</span> : null}
    </f.Form>
  );
}

function LabelChip({ r, base }: { r: { id: string; courier: string | null; awb: string | null; status: string | null; labelAt: string | null; labelBatch: string | null }; base: string }) {
  if ((r.courier !== "delhivery" && r.courier !== "shiprocket") || !r.awb) return null;
  if (!r.labelAt && r.status !== "pickup_pending") return <span className="text-[11.5px] text-ink-faint">—</span>;
  return (
    <a href={`${base}/logistics/labels?order=${encodeURIComponent(r.id)}`} target="_blank" rel="noreferrer" title={r.labelAt ? `Printed${r.labelBatch ? ` · ${r.labelBatch}` : ""}. Click to reprint.` : "Not printed. Click to print."}
      className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11.5px] font-medium ${r.labelAt ? "text-[#067647] hover:bg-[#e3f1ea]" : "bg-[#fff1e3] text-[#8a4b00] hover:bg-[#ffe6cc]"}`}>
      {r.labelAt ? <Icon name="check" className="h-3.5 w-3.5" /> : <Icon name="download" className="h-3.5 w-3.5" />}{r.labelAt ? "Printed" : "Print"}
    </a>
  );
}

const MODES: { id: ShipRule["mode"]; title: string; short: string; text: string }[] = [
  { id: "off", title: "Ship by hand", short: "Ship by hand", text: "Nothing goes to the courier on its own. Use Ship on the Orders page, one order or many." },
  { id: "all", title: "Ship every order", short: "Auto-ships every order", text: "Every order goes to your courier 10 minutes after it's placed." },
  { id: "confirmed", title: "Ship confirmed orders", short: "Auto-ships confirmed orders", text: "Only orders confirmed by the customer on WhatsApp or by your calling team." },
];
const BY: { id: ShipRule["by"]; title: string }[] = [
  { id: "whatsapp", title: "Customer on WhatsApp" }, { id: "team", title: "Calling team" }, { id: "either", title: "Either one" },
];

/** Shipping rules: when orders are booked with the courier automatically. */
function ShipRules({ d }: { d: D }) {
  const [mode, setMode] = useState(d.rule.mode);
  const [by, setBy] = useState(d.rule.by);
  const [prepaidNow, setPrepaidNow] = useState(d.rule.prepaidNow);
  const dirty = mode !== d.rule.mode || by !== d.rule.by || prepaidNow !== d.rule.prepaidNow;
  const base = storePath(d.storeId);
  return (
    <section>
      <p className="text-[12.5px] text-ink-soft">When orders are booked with your courier on their own.</p>
      <Form method="post" className="mt-4 space-y-4">
        <input type="hidden" name="intent" value="shipRule" />
        <div className="grid gap-2" role="radiogroup" aria-label="Shipping mode">
          {MODES.map((m) => (
            <label key={m.id} className={`cursor-pointer rounded-xl p-3 transition ${mode === m.id ? "bg-pine-tint/60 shadow-[inset_0_0_0_1.5px_#0B5D4B]" : "shadow-[inset_0_0_0_1px_#e3e3e3] hover:bg-black/[.015]"}`}>
              <span className="flex items-center gap-2 text-[13px] font-semibold"><input type="radio" name="mode" value={m.id} checked={mode === m.id} onChange={() => setMode(m.id)} className="h-3.5 w-3.5 accent-[#0B5D4B]" />{m.title}</span>
              <span className="mt-1 block pl-[22px] text-[12px] leading-snug text-ink-soft">{m.text}</span>
            </label>
          ))}
        </div>
        {mode === "confirmed" ? (
          <div className="space-y-3 rounded-xl bg-[#f6f6f7] p-3.5">
            <div>
              <p className="text-[12.5px] font-medium">Confirmed by</p>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {BY.map((b) => (
                  <label key={b.id} className={`cursor-pointer rounded-lg px-3 py-1.5 text-[12.5px] font-medium transition ${by === b.id ? "bg-white text-ink shadow-[0_0_0_1.5px_#0B5D4B]" : "bg-white/60 text-ink-soft shadow-[0_0_0_1px_#e3e3e3] hover:text-ink"}`}>
                    <input type="radio" name="by" value={b.id} checked={by === b.id} onChange={() => setBy(b.id)} className="sr-only" />{b.title}
                  </label>
                ))}
              </div>
              {by !== "team" && !d.waConfirm && <p className="mt-1.5 text-[12px] text-[#8a6100]">WhatsApp order confirmation is off. <Link to={`${base}/rto#confirm`} className="font-medium underline">Turn it on</Link>{by === "either" ? " or use the calling team." : "."}</p>}
              {by !== "whatsapp" && !d.callers && <p className="mt-1.5 text-[12px] text-[#8a6100]">No calling team yet. <Link to="/dashboard/team" className="font-medium underline">Add a team member</Link> with the "Order confirmation (calling)" role.</p>}
            </div>
            <label className="flex cursor-pointer items-start gap-2.5">
              <input type="checkbox" name="prepaidNow" checked={prepaidNow} onChange={(e) => setPrepaidNow(e.target.checked)} className="mt-0.5 h-4 w-4 accent-[#0B5D4B]" />
              <span className="text-[12.5px]"><b className="font-medium">Prepaid orders ship right away</b><span className="block text-ink-faint">No WhatsApp or call confirmation needed when the customer has already paid.</span></span>
            </label>
          </div>
        ) : <><input type="hidden" name="by" value={by} />{prepaidNow && <input type="hidden" name="prepaidNow" value="on" />}</>}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="flex items-center gap-1.5 text-[12px] text-ink-faint"><Icon name="shield" className="h-3.5 w-3.5" />Orders cancelled on WhatsApp or by your calling team are never shipped.</p>
          <SubmitButton intent="shipRule" className="btn-primary btn h-8" busyText="Saving" disabled={!dirty}>Save rules</SubmitButton>
        </div>
      </Form>
    </section>
  );
}
