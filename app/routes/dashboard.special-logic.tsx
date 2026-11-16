// Super admin → Special logic. Stores never see this page, its menu item, or anything it decides.
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Form, useActionData, useLoaderData } from "@remix-run/react";
import { asc } from "drizzle-orm";
import { useEffect, useMemo, useState } from "react";
import { Notice, PageHeader, SubmitButton } from "~/components/ui";
import { db, stores, type StoreConnectGroup } from "~/db.server";
import { requireSuperAdmin } from "~/lib/auth.server";
import { normalizePhone } from "~/lib/cod.server";
import { DEFAULT_BLOCK_ON, MAX_GROUPS, MAX_STORES, MIN_STORES, newGroupId, PLACED_WINDOW_DAYS, resolveGroups, STATE_LABEL, type LinkedHit } from "~/lib/store-connect";
import { connectGroups, linkedOrders, saveConnectGroups } from "~/lib/store-connect.server";

const TABS = [{ id: "store-connect", label: "Store data connect" }] as const;

export async function loader({ request }: LoaderFunctionArgs) {
  await requireSuperAdmin(request);
  const [all, groups] = await Promise.all([
    db.select({ id: stores.id, name: stores.name, logoUrl: stores.logoUrl }).from(stores).orderBy(asc(stores.name)),
    connectGroups(true),
  ]);
  return json({ stores: all, groups });
}

type TestResult = { phone: string; store: string; group: string | null; blocked: boolean; hits: (LinkedHit & { storeName: string })[] };

export async function action({ request }: ActionFunctionArgs) {
  await requireSuperAdmin(request);
  const fd = await request.formData();
  const intent = String(fd.get("intent") ?? "");
  const all = await db.select({ id: stores.id, name: stores.name }).from(stores);
  const names = new Map(all.map((s) => [s.id, s.name]));

  if (intent === "save") {
    let raw: unknown;
    try { raw = JSON.parse(String(fd.get("groups") ?? "[]")); } catch { return json({ error: "Couldn't read the groups. Reload and try again.", saved: false, test: null }, { status: 400 }); }
    const groups = resolveGroups(raw, new Set(names.keys()));
    const short = groups.find((g) => (raw as StoreConnectGroup[]).find((r) => r.id === g.id)?.enabled && g.storeIds.length < MIN_STORES);
    await saveConnectGroups(groups);
    return json({ error: short ? `"${short.name}" needs at least ${MIN_STORES} stores before it can be turned on. It was saved as off.` : null, saved: true, test: null });
  }

  if (intent === "test") {
    const phone = normalizePhone(String(fd.get("phone") ?? ""));
    const storeId = Number(fd.get("storeId"));
    if (!/^\d{10}$/.test(phone) || !names.has(storeId)) return json({ error: "Enter a 10-digit mobile number and pick a store.", saved: false, test: null }, { status: 400 });
    const g = (await connectGroups(true)).find((x) => x.enabled && x.storeIds.includes(storeId)) ?? null;
    const hits = g ? await linkedOrders(storeId, phone, g, 10) : [];
    const test: TestResult = { phone, store: names.get(storeId) ?? "", group: g?.name ?? null, blocked: hits.length > 0, hits: hits.map((h) => ({ ...h, storeName: names.get(h.storeId) ?? `Store ${h.storeId}` })) };
    return json({ error: null, saved: false, test });
  }
  return json({ error: "Unknown action", saved: false, test: null }, { status: 400 });
}

export default function SpecialLogic() {
  const d = useLoaderData<typeof loader>();
  const a = useActionData<typeof action>();
  const [groups, setGroups] = useState<StoreConnectGroup[]>(d.groups);
  useEffect(() => setGroups(d.groups), [d.groups]);
  const dirty = JSON.stringify(groups) !== JSON.stringify(d.groups);
  const byId = useMemo(() => new Map(d.stores.map((s) => [s.id, s])), [d.stores]);
  const owner = (storeId: number, except: string) => groups.find((g) => g.id !== except && g.storeIds.includes(storeId));

  const patch = (id: string, p: Partial<StoreConnectGroup>) => setGroups((gs) => gs.map((g) => (g.id === id ? { ...g, ...p } : g)));
  const add = () => setGroups((gs) => [...gs, { id: newGroupId(), name: `Connected stores ${gs.length + 1}`, enabled: false, storeIds: [], blockOn: { ...DEFAULT_BLOCK_ON }, sameStore: false }]);
  const toggleStore = (g: StoreConnectGroup, sid: number) => {
    const has = g.storeIds.includes(sid);
    if (!has && g.storeIds.length >= MAX_STORES) return;
    const storeIds = has ? g.storeIds.filter((x) => x !== sid) : [...g.storeIds, sid];
    patch(g.id, { storeIds, enabled: storeIds.length >= MIN_STORES ? g.enabled : false });
  };

  return (
    <div className="max-w-4xl space-y-5">
      <PageHeader title="Special logic" description="Rules that run behind the scenes. Only you can see this page. Stores never see these settings, and customers only see the normal “pay online” message." icon="shield" />

      <div className="flex gap-1 border-b border-line">
        {TABS.map((t) => (
          <span key={t.id} className="-mb-px border-b-2 border-ink px-3 py-2 text-[13.5px] font-semibold">{t.label}</span>
        ))}
      </div>

      <section className="panel space-y-2 p-5 text-[13.5px] leading-relaxed">
        <h2 className="text-[15px] font-semibold">Store data connect</h2>
        <p className="text-ink-soft">
          Connect {MIN_STORES} to {MAX_STORES} stores that sell to the same customers. When a customer has a live order on one of them,
          Cash on Delivery is turned off for that mobile number on the others. Prepaid always stays open. Once the order is cancelled,
          returned or comes back (RTO), COD opens again.
        </p>
        <p className="text-[12.5px] text-ink-faint">A placed order that is never shipped stops counting after {PLACED_WINDOW_DAYS} days. A store can be in one group only.</p>
      </section>

      {a?.error && <Notice tone="warning">{a.error}</Notice>}
      {a?.saved && !a.error && <Notice tone="success">Saved. Checkouts use the new rules within 30 seconds.</Notice>}

      <Form method="post" className="space-y-4">
        <input type="hidden" name="intent" value="save" />
        <input type="hidden" name="groups" value={JSON.stringify(groups)} />
        {!groups.length && <div className="panel p-6 text-center text-[13.5px] text-ink-soft">No connected stores yet.</div>}
        {groups.map((g) => (
          <div key={g.id} className={`panel space-y-4 p-5 ${g.enabled ? "ring-1 ring-[#2dd496]" : ""}`}>
            <div className="flex flex-wrap items-center gap-3">
              <input value={g.name} onChange={(e) => patch(g.id, { name: e.target.value.slice(0, 60) })} className="input h-9 min-w-[220px] flex-1 font-medium" aria-label="Group name" />
              <label className={`inline-flex items-center gap-2 text-[13.5px] font-medium ${g.storeIds.length < MIN_STORES ? "opacity-50" : ""}`}>
                <input type="checkbox" checked={g.enabled} disabled={g.storeIds.length < MIN_STORES} onChange={(e) => patch(g.id, { enabled: e.target.checked })} className="h-4 w-4" />
                {g.enabled ? "On" : "Off"}
              </label>
              <button type="button" onClick={() => setGroups((gs) => gs.filter((x) => x.id !== g.id))} className="btn-secondary h-8 text-[12.5px] text-[#8e1f0b]">Remove</button>
            </div>

            <div>
              <p className="label mb-1.5">Stores <span className="font-normal text-ink-faint">({g.storeIds.length}/{MAX_STORES}, at least {MIN_STORES})</span></p>
              <div className="flex flex-wrap gap-1.5">
                {d.stores.map((s) => {
                  const on = g.storeIds.includes(s.id);
                  const other = owner(s.id, g.id);
                  const full = !on && g.storeIds.length >= MAX_STORES;
                  return (
                    <button key={s.id} type="button" disabled={Boolean(other) || full} onClick={() => toggleStore(g, s.id)}
                      title={other ? `Already in "${other.name}"` : full ? `Up to ${MAX_STORES} stores` : undefined}
                      className={`inline-flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-[12.5px] transition ${on ? "border-ink bg-ink text-white" : "border-line bg-white hover:border-ink-soft"} disabled:cursor-not-allowed disabled:opacity-40`}>
                      {s.logoUrl ? <img src={s.logoUrl} alt="" className="h-4 w-4 rounded object-contain" /> : null}
                      {s.name}{on ? " ✓" : ""}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <p className="label mb-1.5">Block COD while the customer has an order that is</p>
                {(["placed", "inTransit", "delivered"] as const).map((k) => (
                  <label key={k} className="flex items-center gap-2 py-0.5 text-[13.5px]">
                    <input type="checkbox" checked={g.blockOn[k]} onChange={(e) => patch(g.id, { blockOn: { ...g.blockOn, [k]: e.target.checked } })} className="h-4 w-4" />
                    {k === "placed" ? "Placed or manifested (not shipped yet)" : k === "inTransit" ? "Shipped / in transit" : "Delivered"}
                  </label>
                ))}
                <p className="mt-1 text-[12px] text-ink-faint">Cancelled, failed, RTO and returned orders never block.</p>
              </div>
              <div>
                <p className="label mb-1.5">Which orders count</p>
                <label className="flex items-start gap-2 text-[13.5px]">
                  <input type="checkbox" checked={g.sameStore} onChange={(e) => patch(g.id, { sameStore: e.target.checked })} className="mt-0.5 h-4 w-4" />
                  <span>Also the customer's orders on the same store<span className="block text-[12px] text-ink-faint">Off: only orders on the other connected stores count.</span></span>
                </label>
              </div>
            </div>

            {g.storeIds.length > 0 && (
              <p className="text-[12.5px] text-ink-soft">
                {g.enabled ? "Live: " : "When on: "}a customer with a live order on {g.storeIds.map((id) => byId.get(id)?.name ?? id).join(" or ")} can only pay online on the {g.sameStore ? "connected stores" : "other connected stores"}.
              </p>
            )}
          </div>
        ))}
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={add} disabled={groups.length >= MAX_GROUPS} className="btn-secondary">Add connected stores</button>
          <SubmitButton className="btn-primary" busyText="Saving" disabled={!dirty}>Save</SubmitButton>
          {dirty && <span className="text-[12.5px] text-ink-faint">Unsaved changes</span>}
        </div>
      </Form>

      <section className="panel space-y-3 p-5">
        <h2 className="text-[15px] font-semibold">Check a customer</h2>
        <p className="text-[13px] text-ink-soft">See what a customer would get at checkout on a store, using the saved rules.</p>
        <Form method="post" className="flex flex-wrap items-end gap-2">
          <input type="hidden" name="intent" value="test" />
          <label className="block"><span className="label">Mobile number</span><input name="phone" inputMode="numeric" placeholder="98xxxxxxxx" className="input h-9 w-44" /></label>
          <label className="block"><span className="label">Buying on</span>
            <select name="storeId" className="input h-9 w-56">{d.stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
          </label>
          <SubmitButton className="btn-secondary h-9" busyText="Checking">Check</SubmitButton>
        </Form>
        {a?.test && (
          <div className="rounded-lg bg-paper-sunk p-3 text-[13px]">
            <p className="font-medium">{a.test.blocked ? "COD blocked, prepaid open" : "COD open"} for {a.test.phone} on {a.test.store}</p>
            {!a.test.group && <p className="text-ink-soft">This store isn't in a connected group that is on.</p>}
            {a.test.hits.length > 0 && (
              <ul className="mt-1.5 space-y-0.5 text-ink-soft">
                {a.test.hits.map((h) => <li key={h.orderId}>{h.storeName} · order {h.orderId.slice(0, 12)} · {STATE_LABEL[h.state]} · {new Date(h.createdAt).toLocaleDateString("en-IN")}</li>)}
              </ul>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
