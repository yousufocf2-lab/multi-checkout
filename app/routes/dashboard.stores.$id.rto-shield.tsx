import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Form, Link, useActionData, useLoaderData } from "@remix-run/react";
import { eq } from "drizzle-orm";
import { useState } from "react";
import { Icon } from "~/components/Icons";
import { Notice, SubmitButton } from "~/components/ui";
import { db, stores } from "~/db.server";
import { requireStore, requireViewer } from "~/lib/auth.server";
import { normalizePhone } from "~/lib/cod.server";
import { hasCourier } from "~/lib/logistics.server";
import {
  ACTION_LABELS, MAX_TIERS, SHIP_STATUS_LABELS, reasonText, resolveShield,
  type LiveRule, type RtoShieldSettings, type ShieldAction, type ShipCounts, type Tier,
} from "~/lib/rto-shield";
import { blockedCustomersNow, setExempt } from "~/lib/rto-shield.server";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const viewer = await requireViewer(request);
  const store = await requireStore(viewer, params.id);
  const unlocked = await hasCourier(store.id);
  const settings = resolveShield(store.rtoShield);
  const blocked = unlocked ? await blockedCustomersNow(store, 200) : [];
  return json({ storeId: store.id, unlocked, settings, codEnabled: store.codEnabled, blocked });
}

type R = { ok: string | null; error: string | null };

export async function action({ request, params }: ActionFunctionArgs) {
  const store = await requireStore(await requireViewer(request), params.id);
  const fd = await request.formData();
  const intent = String(fd.get("intent") ?? "");
  const on = (k: string) => fd.get(k) === "on";
  const act = (k: string): ShieldAction => (fd.get(k) === "all" ? "all" : "cod");

  if (intent === "save") {
    if (!(await hasCourier(store.id))) return json<R>({ ok: null, error: "Connect a courier first to use RTO Shield." }, { status: 400 });
    const counts = fd.getAll("tierCount").map((v) => Number(v));
    const actions = fd.getAll("tierAction").map((v) => (v === "all" ? "all" : "cod") as ShieldAction);
    const tiers: Tier[] = counts.map((c, i) => ({ count: c, action: actions[i] ?? "cod" })).filter((t) => Number.isFinite(t.count) && t.count >= 1);
    const historyOn = on("historyOn");
    if (historyOn && !tiers.length) return json<R>({ ok: null, error: "Add at least one RTO / return limit, or turn history rules off." }, { status: 400 });
    if (historyOn && !on("countRto") && !on("countReturned")) return json<R>({ ok: null, error: "Choose what to count: RTO, Returned or both." }, { status: 400 });
    const next: RtoShieldSettings = resolveShield({
      enabled: on("enabled"),
      neverBlockPrepaid: on("neverBlockPrepaid"),
      inTransit: { on: on("inTransitOn"), action: act("inTransitAction") },
      rtoTransit: { on: on("rtoTransitOn"), action: act("rtoTransitAction") },
      delivered: { on: on("deliveredOn"), action: act("deliveredAction") },
      history: { on: historyOn, countRto: on("countRto"), countReturned: on("countReturned"), tiers },
    });
    await db.update(stores).set({ rtoShield: next }).where(eq(stores.id, store.id));
    return json<R>({ ok: next.enabled ? "RTO Shield is on. New rules apply from the next checkout." : "Saved. RTO Shield is off.", error: null });
  }
  if (intent === "exempt" || intent === "unexempt") {
    const phone = normalizePhone(String(fd.get("phone") ?? ""));
    if (!/^\d{10}$/.test(phone)) return json<R>({ ok: null, error: "Enter a valid 10-digit mobile number" }, { status: 400 });
    await setExempt(store.id, phone, intent === "exempt");
    return json<R>({ ok: intent === "exempt" ? `+91 ${phone} can order again` : `RTO Shield rules apply to +91 ${phone} again`, error: null });
  }
  return json<R>({ ok: null, error: "Unknown action" }, { status: 400 });
}

type D = ReturnType<typeof useLoaderData<typeof loader>>;

export default function RtoShield() {
  const d = useLoaderData<typeof loader>();
  const r = useActionData<typeof action>();
  if (!d.unlocked) return <Locked storeId={d.storeId} />;
  return (
    <div className="space-y-5">
      {r?.ok && <Notice tone="success">{r.ok}</Notice>}
      {r?.error && <Notice tone="error">{r.error}</Notice>}
      {!d.codEnabled && <Notice tone="warning">Cash on Delivery is off for this store, so COD blocks have no effect. "Block all orders" rules still work.</Notice>}
      <SettingsForm d={d} />
      <BlockedList d={d} />
    </div>
  );
}

function Locked({ storeId }: { storeId: number }) {
  return (
    <div className="panel mx-auto max-w-2xl overflow-hidden">
      <div className="bg-gradient-to-br from-slate-900 to-slate-700 px-6 py-10 text-center text-white">
        <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-white/10 text-3xl" aria-hidden>🔒</span>
        <h2 className="mt-4 text-xl font-semibold">Connect a courier to unlock RTO Shield</h2>
        <p className="mx-auto mt-2 max-w-md text-sm text-white/75">RTO Shield reads each customer's delivery history from your courier. Then it can hide COD, or stop orders, for customers who keep refusing deliveries.</p>
        <Link to={`/dashboard/stores/${storeId}/logistics`} className="btn-primary mt-6 bg-white text-ink hover:bg-white/90">Connect courier →</Link>
      </div>
      <ul className="grid gap-4 p-6 sm:grid-cols-3">
        {[["shipping", "Block while in transit", "No new COD order until the last one is delivered."], ["shield", "Block after RTO", "2 RTOs → COD off. 5 RTOs → no orders. You choose."], ["check", "Prepaid stays open", "Keep online payment open for everyone, if you like."]].map(([icon, t, s]) => (
          <li key={t} className="text-sm">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-pine-tint text-pine"><Icon name={icon as "shield"} className="h-4 w-4" /></span>
            <p className="mt-2 font-medium">{t}</p>
            <p className="mt-0.5 text-xs text-ink-soft">{s}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Switch({ name, on, setOn, label }: { name: string; on: boolean; setOn: (v: boolean) => void; label: string }) {
  return (
    <label className="relative inline-flex shrink-0 cursor-pointer items-center" aria-label={label}>
      <input type="checkbox" name={name} checked={on} onChange={(e) => setOn(e.target.checked)} className="peer sr-only" />
      <span aria-hidden className={`h-6 w-10 rounded-full transition peer-focus-visible:ring-2 peer-focus-visible:ring-brand ${on ? "bg-brand" : "bg-rule-strong"}`} />
      <span aria-hidden className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${on ? "left-[18px]" : "left-0.5"}`} />
    </label>
  );
}

function ActionPick({ name, value, setValue, disabled, prepaidSafe }: { name: string; value: ShieldAction; setValue: (v: ShieldAction) => void; disabled?: boolean; prepaidSafe: boolean }) {
  return (
    <div className={`inline-flex rounded-lg border border-rule-strong p-0.5 text-xs font-medium ${disabled ? "opacity-50" : ""}`} role="radiogroup">
      <input type="hidden" name={name} value={value} />
      {(["cod", "all"] as const).map((a) => (
        <button key={a} type="button" disabled={disabled} role="radio" aria-checked={value === a} onClick={() => setValue(a)}
          className={`rounded-md px-2.5 py-1.5 transition ${value === a ? (a === "all" ? "bg-red-600 text-white" : "bg-ink text-white") : "text-ink-soft hover:text-ink"}`}>
          {a === "all" && prepaidSafe ? "Block all (prepaid kept)" : ACTION_LABELS[a]}
        </button>
      ))}
    </div>
  );
}

function LiveRow({ prefix, title, text, rule, prepaidSafe }: { prefix: string; title: string; text: string; rule: LiveRule; prepaidSafe: boolean }) {
  const [on, setOn] = useState(rule.on);
  const [action, setAction] = useState<ShieldAction>(rule.action);
  return (
    <div className={`flex flex-wrap items-center gap-3 rounded-xl border px-4 py-3 transition ${on ? "border-brand/40 bg-pine-tint/40" : "border-rule"}`}>
      <Switch name={`${prefix}On`} on={on} setOn={setOn} label={title} />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{title}</p>
        <p className="text-xs text-ink-faint">{text}</p>
      </div>
      <ActionPick name={`${prefix}Action`} value={action} setValue={setAction} disabled={!on} prepaidSafe={prepaidSafe} />
    </div>
  );
}

function SettingsForm({ d }: { d: D }) {
  const s = d.settings;
  const [enabled, setEnabled] = useState(s.enabled);
  const [safe, setSafe] = useState(s.neverBlockPrepaid);
  const [hist, setHist] = useState(s.history.on);
  const [countRto, setCountRto] = useState(s.history.countRto);
  const [countRet, setCountRet] = useState(s.history.countReturned);
  const [tiers, setTiers] = useState<Tier[]>(s.history.tiers.length ? s.history.tiers : [{ count: 2, action: "cod" }]);
  const setTier = (i: number, patch: Partial<Tier>) => setTiers((t) => t.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const what = [countRto && "RTO", countRet && "returns"].filter(Boolean).join(" + ") || "RTO";

  return (
    <Form method="post" className="space-y-5">
      <section className="panel p-5">
        <div className="flex flex-wrap items-center gap-4">
          <span className={`flex h-12 w-12 items-center justify-center rounded-2xl text-2xl transition ${enabled ? "bg-pine-tint" : "bg-paper-sunk grayscale"}`} aria-hidden>🛡️</span>
          <div className="min-w-0 flex-1">
            <p className="font-semibold">RTO Shield is {enabled ? "on" : "off"}</p>
            <p className="text-sm text-ink-soft">Checks the customer's delivery history with your store the moment they enter their mobile number.</p>
          </div>
          <Switch name="enabled" on={enabled} setOn={setEnabled} label="Turn RTO Shield on" />
        </div>
        <label className="mt-4 flex cursor-pointer items-start gap-3 rounded-xl bg-emerald-50 px-4 py-3">
          <input type="checkbox" name="neverBlockPrepaid" checked={safe} onChange={(e) => setSafe(e.target.checked)} className="mt-0.5 h-4 w-4 accent-emerald-600" />
          <span>
            <span className="block text-sm font-medium text-emerald-900">Never block prepaid orders</span>
            <span className="block text-xs text-emerald-800">Even blocked customers can always pay online. "Block all orders" then only hides COD.</span>
          </span>
        </label>
      </section>

      <section className={`panel p-5 transition ${enabled ? "" : "opacity-60"}`}>
        <h2 className="text-[15px] font-semibold">While an order is on its way</h2>
        <p className="mt-0.5 text-sm text-ink-soft">The block lifts by itself once that order is delivered or closed.</p>
        <div className="mt-4 space-y-2">
          <LiveRow prefix="inTransit" title={SHIP_STATUS_LABELS.in_transit} text="Customer has an order that hasn't been delivered yet" rule={s.inTransit} prepaidSafe={safe} />
          <LiveRow prefix="rtoTransit" title={SHIP_STATUS_LABELS.rto_transit} text="An order was refused and is coming back to you" rule={s.rtoTransit} prepaidSafe={safe} />
        </div>
        <h2 className="mt-6 text-[15px] font-semibold">After delivery</h2>
        <p className="mt-0.5 text-sm text-ink-soft">Permanent: applies once the customer has a delivered order.</p>
        <div className="mt-3"><LiveRow prefix="delivered" title={SHIP_STATUS_LABELS.delivered} text="E.g. COD only for first-time buyers, prepaid after that" rule={s.delivered} prepaidSafe={safe} /></div>
      </section>

      <section className={`panel p-5 transition ${enabled ? "" : "opacity-60"}`}>
        <div className="flex items-start gap-4">
          <div className="min-w-0 flex-1">
            <h2 className="text-[15px] font-semibold">RTO & returns history</h2>
            <p className="mt-0.5 text-sm text-ink-soft">Count how many times a customer's orders came back, and block at the limits you set. Permanent.</p>
          </div>
          <Switch name="historyOn" on={hist} setOn={setHist} label="History rules" />
        </div>
        {hist && (
          <div className="mt-4 space-y-4">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="text-ink-soft">Count:</span>
              {[["countRto", "RTO", countRto, setCountRto], ["countReturned", "Returned", countRet, setCountRet]].map(([n, l, v, set]) => (
                <label key={n as string} className={`cursor-pointer rounded-full border px-3 py-1.5 transition ${v ? "border-brand bg-pine-tint font-medium text-pine" : "border-rule-strong text-ink-soft"}`}>
                  <input type="checkbox" name={n as string} checked={v as boolean} onChange={(e) => (set as (b: boolean) => void)(e.target.checked)} className="sr-only" />{v ? "✓ " : ""}{l as string}
                </label>
              ))}
            </div>
            <div className="space-y-2">
              {tiers.map((t, i) => (
                <div key={i} className="flex flex-wrap items-center gap-2 rounded-xl border border-rule px-3 py-2.5 text-sm">
                  <span className="text-ink-soft">At</span>
                  <input type="number" name="tierCount" min={1} max={99} value={t.count} onChange={(e) => setTier(i, { count: Math.max(1, Math.min(99, Number(e.target.value) || 1)) })} className="input h-9 w-16 py-1 text-center" aria-label="Count" />
                  <span className="text-ink-soft">{what}{t.count === 1 ? "" : "s"} →</span>
                  <ActionPick name="tierAction" value={t.action} setValue={(v) => setTier(i, { action: v })} prepaidSafe={safe} />
                  {tiers.length > 1 && <button type="button" onClick={() => setTiers((x) => x.filter((_, j) => j !== i))} className="ml-auto rounded-lg p-1.5 text-ink-faint hover:text-bad" aria-label="Remove limit"><Icon name="trash" className="h-4 w-4" /></button>}
                </div>
              ))}
              {tiers.length < MAX_TIERS && (
                <button type="button" className="btn-quiet text-sm" onClick={() => setTiers((x) => [...x, { count: (x[x.length - 1]?.count ?? 1) + 2, action: "all" }])}>
                  <Icon name="plus" className="h-4 w-4" /> Add another limit
                </button>
              )}
            </div>
            <p className="rounded-lg bg-paper px-3 py-2 text-xs text-ink-soft">
              {[...tiers].sort((a, b) => a.count - b.count).map((t) => `${t.count} ${what} → ${t.action === "all" && !safe ? "can't order at all" : "COD hidden"}`).join(" · ")}
            </p>
          </div>
        )}
      </section>

      <div className="flex justify-end"><SubmitButton intent="save" className="btn-primary px-6 py-3" busyText="Saving">Save RTO Shield</SubmitButton></div>
    </Form>
  );
}

function Counts({ c }: { c: ShipCounts }) {
  const keys = (["delivered", "in_transit", "rto_transit", "rto", "returned"] as const).filter((k) => (c[k] ?? 0) > 0);
  return <span className="flex flex-wrap gap-1">{keys.map((k) => <span key={k} className="rounded bg-paper-sunk px-1.5 py-0.5 text-[11px] text-ink-soft">{SHIP_STATUS_LABELS[k]} {c[k]}</span>)}</span>;
}

function BlockedList({ d }: { d: D }) {
  const active = d.blocked.filter((b) => !b.exempt);
  const exempt = d.blocked.filter((b) => b.exempt);
  return (
    <section className="panel">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-rule px-5 py-4">
        <div>
          <h2 className="text-[15px] font-semibold">Customers blocked by these rules <span className="font-normal text-ink-faint">({active.length})</span></h2>
          <p className="mt-0.5 text-sm text-ink-soft">{d.settings.enabled ? "These customers see the block at checkout right now." : "Preview: who would be blocked if you turn RTO Shield on."}</p>
        </div>
        <Form method="post" className="flex gap-2">
          <input name="phone" inputMode="numeric" placeholder="Mobile number" className="input h-9 w-40 py-1.5 text-sm" aria-label="Mobile number to let through" />
          <SubmitButton intent="exempt" className="btn-secondary h-9 px-3 py-1.5 text-sm" busyText="Saving">Always allow</SubmitButton>
        </Form>
      </header>
      {active.length === 0 ? (
        <p className="px-5 py-8 text-center text-sm text-ink-faint">No one is blocked by these rules yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="table min-w-[640px]">
            <thead><tr><th>Customer</th><th>Why</th><th>Shipments</th><th>Block</th><th /></tr></thead>
            <tbody>
              {active.map((b) => (
                <tr key={b.phone}>
                  <td><p className="font-medium">+91 {b.phone}</p>{b.name && <p className="text-xs text-ink-faint">{b.name}</p>}</td>
                  <td className="text-sm text-ink-soft">{reasonText(b.hit.reason)}</td>
                  <td><Counts c={b.counts} /></td>
                  <td><span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${b.hit.scope === "all" ? "bg-red-50 text-bad" : "bg-orange-50 text-warn"}`}>{b.hit.scope === "all" ? "All orders" : "COD"}</span></td>
                  <td className="text-right">
                    <Form method="post"><input type="hidden" name="phone" value={b.phone} /><button name="intent" value="exempt" className="btn-quiet text-xs">Let through</button></Form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {exempt.length > 0 && (
        <details className="border-t border-rule px-5 py-3 text-sm">
          <summary className="cursor-pointer text-ink-soft">Always allowed ({exempt.length})</summary>
          <ul className="mt-2 divide-y divide-rule">
            {exempt.map((b) => (
              <li key={b.phone} className="flex items-center justify-between py-2">
                <span>+91 {b.phone} <span className="text-xs text-ink-faint">· {reasonText(b.hit.reason)}</span></span>
                <Form method="post"><input type="hidden" name="phone" value={b.phone} /><button name="intent" value="unexempt" className="btn-quiet text-xs">Apply rules again</button></Form>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
