// Growpefy Store → Orders to ship: website orders waiting for an AWB. Mark shipped, or download for a courier upload.
import { shipRuleOf } from "~/lib/ship-rule";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Form, useActionData, useLoaderData } from "@remix-run/react";
import { Notice, SubmitButton } from "~/components/ui";
import { requireStore, requireViewer } from "~/lib/auth.server";
import { catalogAllowed } from "~/lib/catalog.server";
import { COURIERS } from "~/lib/courier-catalog";
import { formatINR } from "~/lib/pricing";
import { codAmount, markShipped, ordersToShip } from "~/lib/store-fulfil.server";
import { bookOrder } from "~/lib/auto-ship.server";
import { and, eq } from "drizzle-orm";
import { courierAccounts, db, orders as ordersTable } from "~/db.server";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const viewer = await requireViewer(request);
  const store = await requireStore(viewer, params.id);
  if (!catalogAllowed(viewer, store)) throw new Response("Not found", { status: 404 });
  const list = await ordersToShip(store.id);
  const [dl] = await db.select().from(courierAccounts).where(and(eq(courierAccounts.storeId, store.id), eq(courierAccounts.courier, "delhivery"))).limit(1);
  return json({
    autoShip: shipRuleOf(store).mode !== "off" && Boolean(dl?.creds.token && dl.creds.pickupName),
    couriers: COURIERS.filter((c) => c.id !== "other").map((c) => ({ id: c.id, name: c.name })),
    orders: list.map((o) => ({
      id: o.id, name: o.shopifyOrderName ?? o.id, shipError: o.shipError, confirm: o.confirmStatus, at: o.createdAt.toISOString(), cod: codAmount(o), total: o.total, method: o.paymentMethod,
      customer: `${o.customer.firstName} ${o.customer.lastName}`.trim(), phone: o.customer.phone, place: `${o.customer.city}, ${o.customer.pincode}`,
      items: o.items.map((l) => `${l.quantity} × ${l.title}${l.variantTitle ? ` (${l.variantTitle})` : ""}`).join(", "),
    })),
  });
}

export async function action({ request, params }: ActionFunctionArgs) {
  const viewer = await requireViewer(request);
  const store = await requireStore(viewer, params.id);
  if (!catalogAllowed(viewer, store)) throw new Response("Not found", { status: 404 });
  const fd = await request.formData();
  if (fd.get("intent") === "book") {
    const [dl] = await db.select().from(courierAccounts).where(and(eq(courierAccounts.storeId, store.id), eq(courierAccounts.courier, "delhivery"))).limit(1);
    const [o] = await db.select().from(ordersTable).where(and(eq(ordersTable.storeId, store.id), eq(ordersTable.id, String(fd.get("id"))))).limit(1);
    if (!dl?.creds.token || !dl.creds.pickupName || !o) return json({ ok: null, error: "Connect Delhivery with a pickup location first (Logistics)." }, { status: 400 });
    const r = await bookOrder(store, o, dl);
    return r.ok ? json({ ok: `${fd.get("name")} booked with Delhivery. AWB ${r.awb}.`, error: null }) : json({ ok: null, error: `Delhivery: ${r.error}` }, { status: 400 });
  }
  try {
    await markShipped(store.id, String(fd.get("id")), String(fd.get("courier") ?? ""), String(fd.get("awb") ?? ""));
    return json({ ok: `${fd.get("name")} marked shipped. Tracking updates now come in automatically for connected couriers.`, error: null });
  } catch (e) {
    return json({ ok: null, error: e instanceof Error ? e.message : "Couldn't save" }, { status: 400 });
  }
}

const when = (iso: string) => new Date(iso).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

export default function ToShip() {
  const { orders, couriers, autoShip } = useLoaderData<typeof loader>();
  const a = useActionData<typeof action>();
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="flex-1 text-[22px] font-semibold tracking-tight">Orders to ship <span className="text-ink-faint">{orders.length}</span></h1>
        {orders.length > 0 && <a href="to-ship.csv" className="btn-secondary" download>Download for courier (CSV)</a>}
      </div>
      {a?.ok && <Notice tone="success">{a.ok}</Notice>}
      {a?.error && <Notice tone="error">{a.error}</Notice>}
      <p className="text-sm text-ink-soft">{autoShip
        ? "Delhivery is set to book these automatically (10 minutes after the order; COD orders after the customer confirms on WhatsApp, if confirmation is on)."
        : "Website orders waiting for a tracking number. Add a pickup location to Delhivery under Logistics to book them automatically, or Shipnex picks them up once connected."}</p>
      {orders.length === 0 ? (
        <section className="panel px-6 py-12 text-center text-sm text-ink-soft">Nothing to ship right now.</section>
      ) : (
        <section className="panel divide-y divide-rule">
          {orders.map((o) => (
            <div key={o.id} className="flex flex-wrap items-center gap-4 px-5 py-4">
              <div className="min-w-0 flex-[2_1_320px]">
                <p className="font-semibold">{o.name} <span className="ml-2 text-xs font-normal text-ink-faint">{when(o.at)}</span></p>
                <p className="truncate text-sm text-ink-soft">{o.items}</p>
                <p className="text-xs text-ink-faint">{o.customer} · {o.phone} · {o.place}{o.confirm === "confirmed" ? " · Confirmed on WhatsApp" : ""}</p>
                {o.shipError && <p className="mt-1 text-xs font-medium text-bad">Delhivery: {o.shipError}</p>}
              </div>
              <div className="text-sm">
                <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${o.method === "prepaid" ? "bg-sky-50 text-sky-800" : "bg-orange-50 text-warn"}`}>{o.method === "prepaid" ? "Prepaid" : `COD ${formatINR(o.cod)}`}</span>
              </div>
              <Form method="post" className="flex flex-[1_1_360px] flex-wrap items-center gap-2">
                <input type="hidden" name="id" value={o.id} /><input type="hidden" name="name" value={o.name} />
                <select name="courier" className="input h-9 w-40" aria-label="Courier" defaultValue="shipnex">
                  {couriers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  <option value="other">Other</option>
                </select>
                <input name="awb" required placeholder="AWB number" className="input h-9 min-w-0 flex-1" aria-label={`AWB for ${o.name}`} />
                <SubmitButton className="btn-primary h-9" busyText="Saving">Shipped</SubmitButton>
              </Form>
              {autoShip && (
                <Form method="post"><input type="hidden" name="intent" value="book" /><input type="hidden" name="id" value={o.id} /><input type="hidden" name="name" value={o.name} />
                  <SubmitButton className="btn-secondary h-9" busyText="Booking">Book with Delhivery now</SubmitButton>
                </Form>
              )}
            </div>
          ))}
        </section>
      )}
    </div>
  );
}
