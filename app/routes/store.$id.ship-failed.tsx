// Shipping → Failed shipping: website orders the courier couldn't book (pincode not serviceable, address
// problem, courier error). They never reach the courier's panel, so they're listed here to reship.
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Form, Link, useActionData, useLoaderData, useNavigation } from "@remix-run/react";
import { useEffect, useMemo, useState } from "react";
import { Icon } from "~/components/Icons";
import { Notice, PageHeader, Spinner } from "~/components/ui";
import { requireStore, requireViewer } from "~/lib/auth.server";
import { failedShipments, reshipOrders } from "~/lib/auto-ship.server";
import { formatINR } from "~/lib/pricing";
import { codAmount } from "~/lib/store-fulfil.server";

const isPin = (e: string) => /non[-\s]?serviceable|not serviceable|doesn't deliver to pincode/i.test(e);

export async function loader({ request, params }: LoaderFunctionArgs) {
  const viewer = await requireViewer(request);
  const store = await requireStore(viewer, params.id);
  const list = await failedShipments(store.id);
  return json({
    orders: list.map((o) => ({
      id: o.id, name: o.shopifyOrderName ?? `#${o.id.slice(-6).toUpperCase()}`, at: o.createdAt.toISOString(), tried: o.shipBookAt?.toISOString() ?? null,
      error: o.shipError ?? "", pin: isPin(o.shipError ?? ""), method: o.paymentMethod, cod: codAmount(o), total: o.total,
      customer: `${o.customer.firstName} ${o.customer.lastName}`.trim(), phone: o.customer.phone, place: `${o.customer.city}, ${o.customer.state} ${o.customer.pincode}`,
      items: o.items.map((l) => `${l.quantity} × ${l.title}${l.variantTitle ? ` (${l.variantTitle})` : ""}`).join(", "),
    })),
  });
}

export async function action({ request, params }: ActionFunctionArgs) {
  const viewer = await requireViewer(request);
  const store = await requireStore(viewer, params.id);
  const fd = await request.formData();
  const ids = fd.getAll("id").map(String).filter(Boolean);
  if (!ids.length) return json({ error: "Select at least one order.", results: [] }, { status: 400 });
  const r = await reshipOrders(store, ids);
  return json(r, { status: r.error ? 400 : 200 });
}

const when = (iso: string) => new Date(iso).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

export default function FailedShipping() {
  const { orders } = useLoaderData<typeof loader>();
  const a = useActionData<typeof action>();
  const nav = useNavigation();
  const busy = nav.state === "submitting";
  const [sel, setSel] = useState<Set<string>>(new Set());
  useEffect(() => setSel((s) => new Set([...s].filter((id) => orders.some((o) => o.id === id)))), [orders]);
  const all = orders.length > 0 && sel.size === orders.length;
  const some = sel.size > 0 && !all;
  const toggle = (id: string) => setSel((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const pinCount = useMemo(() => orders.filter((o) => o.pin).length, [orders]);
  const ok = a?.results?.filter((r) => r.ok) ?? [];
  const bad = a?.results?.filter((r) => !r.ok) ?? [];

  return (
    <div className="space-y-5">
      <PageHeader title="Failed shipping" description="Orders your courier couldn't book automatically. They don't show in the courier's panel, so reship them from here." icon="shipping" />

      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="Waiting to reship" value={orders.length} />
        <Stat label="Pincode not serviceable" value={pinCount} tone="warn" />
        <Stat label="Other errors" value={orders.length - pinCount} />
      </div>

      {a?.error && <Notice tone="error">{a.error}</Notice>}
      {ok.length > 0 && <Notice tone="success">{ok.length} order{ok.length === 1 ? "" : "s"} booked: {ok.map((r) => `${r.name} (${r.message})`).join(" · ")}</Notice>}
      {bad.length > 0 && <Notice tone="warning">{bad.length} still failed: {bad.map((r) => `${r.name}: ${r.message}`).join(" · ")}</Notice>}

      {orders.length === 0 ? (
        <section className="panel px-6 py-14 text-center">
          <Icon name="check" className="mx-auto h-8 w-8 text-pine" />
          <p className="mt-2 font-medium">No failed shipments</p>
          <p className="mt-1 text-sm text-ink-soft">Every order went to the courier. Orders still waiting are under <Link to="../to-ship" relative="path" className="link">Orders to ship</Link>.</p>
        </section>
      ) : (
        <Form method="post" className="panel overflow-hidden">
          <div className={`sticky top-0 z-10 flex flex-wrap items-center gap-3 border-b border-rule px-4 py-3 ${sel.size ? "bg-[#f3f8f5]" : "bg-surface"}`}>
            <label className="flex items-center gap-2 text-sm font-medium">
              <input type="checkbox" className="h-4 w-4" checked={all} ref={(el) => { if (el) el.indeterminate = some; }}
                onChange={() => setSel(all ? new Set() : new Set(orders.map((o) => o.id)))} aria-label="Select all orders" />
              {sel.size ? `${sel.size} selected` : "Select all"}
            </label>
            {sel.size > 0 && (
              <>
                {[...sel].map((id) => <input key={id} type="hidden" name="id" value={id} />)}
                <button type="submit" disabled={busy} className="btn-primary h-9">
                  {busy ? <><Spinner /> Reshipping {sel.size}…</> : <><Icon name="shipping" className="h-4 w-4" /> Reship {sel.size}</>}
                </button>
                <button type="button" onClick={() => setSel(new Set())} className="text-sm text-ink-soft hover:text-ink">Clear</button>
              </>
            )}
            <span className="ml-auto text-xs text-ink-faint">Reship tries every connected courier, Delhivery then Shiprocket.</span>
          </div>
          <ul className="divide-y divide-rule">
            {orders.map((o) => (
              <li key={o.id} className={`flex gap-3 px-4 py-3.5 transition ${sel.has(o.id) ? "bg-[#f7fbf9]" : "hover:bg-paper"}`}>
                <input type="checkbox" className="mt-1 h-4 w-4 shrink-0" checked={sel.has(o.id)} onChange={() => toggle(o.id)} aria-label={`Select ${o.name}`} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="num font-semibold">{o.name}</span>
                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${o.method === "prepaid" ? "bg-sky-50 text-sky-800" : "bg-orange-50 text-warn"}`}>{o.method === "prepaid" ? `Prepaid ${formatINR(o.total)}` : `COD ${formatINR(o.cod)}`}</span>
                    <span className="text-xs text-ink-faint">Ordered {when(o.at)}{o.tried ? ` · last tried ${when(o.tried)}` : ""}</span>
                  </div>
                  <p className="mt-0.5 truncate text-sm text-ink-soft">{o.items}</p>
                  <p className="text-xs text-ink-faint">{o.customer} · {o.phone} · {o.place}</p>
                  <p className={`mt-1.5 inline-flex items-start gap-1.5 rounded-md px-2 py-1 text-xs font-medium ${o.pin ? "bg-[#fff6e6] text-[#8a5a00]" : "bg-[#fdeceb] text-bad"}`}>
                    <Icon name="alert" className="mt-px h-3.5 w-3.5 shrink-0" />{o.pin ? `Pincode ${o.place.split(" ").pop()} not serviceable: ` : ""}{o.error}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </Form>
      )}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: "warn" }) {
  return (
    <div className="panel px-4 py-3">
      <p className="text-xs text-ink-soft">{label}</p>
      <p className={`num mt-1 text-2xl font-semibold ${tone === "warn" && value > 0 ? "text-warn" : ""}`}>{value.toLocaleString("en-IN")}</p>
    </div>
  );
}
