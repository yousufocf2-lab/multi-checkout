// Growpefy Store → Integrations: couriers, payment gateways (your own API keys), and a custom order webhook for any other app.
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Form, Link, useActionData, useLoaderData } from "@remix-run/react";
import crypto from "node:crypto";
import { eq } from "drizzle-orm";
import { CopyField, Notice, SubmitButton, LearnMore } from "~/components/ui";
import { db, stores } from "~/db.server";
import { requireStore, requireViewer } from "~/lib/auth.server";
import { catalogAllowed } from "~/lib/catalog.server";
import { courierAccountsFor } from "~/lib/logistics.server";
import { courierById } from "~/lib/courier-catalog";
import { postWebhook } from "~/lib/order-webhook.server";
import { storePath } from "~/lib/store-code";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const viewer = await requireViewer(request);
  const store = await requireStore(viewer, params.id);
  if (!catalogAllowed(viewer, store)) throw new Response("Not found", { status: 404 });
  const couriers = await courierAccountsFor(store.id);
  return json({
    id: store.id,
    couriers: couriers.map((a) => ({ name: courierById(a.courier)?.name ?? a.courier, ok: a.status === "connected", autoBook: a.courier === "delhivery" && Boolean(a.creds.pickupName) })),
    webhookUrl: store.orderWebhookUrl, secret: store.orderWebhookSecret,
  });
}

export async function action({ request, params }: ActionFunctionArgs) {
  const viewer = await requireViewer(request);
  const store = await requireStore(viewer, params.id);
  if (!catalogAllowed(viewer, store)) throw new Response("Not found", { status: 404 });
  const fd = await request.formData();
  const intent = fd.get("intent");
  if (intent === "save") {
    const url = String(fd.get("url") ?? "").trim();
    if (url && !/^https:\/\/[^\s]+$/.test(url)) return json({ ok: null, error: "Use an https:// address." }, { status: 400 });
    if (url) {
      const host = (() => { try { return new URL(url).hostname.toLowerCase(); } catch { return ""; } })();
      if (!host || /^(localhost|127\.|10\.|0\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|\[)|\.internal$|\.local$/.test(host) || !host.includes(".")) {
        return json({ ok: null, error: "Use a public https:// address." }, { status: 400 });
      }
    }
    await db.update(stores).set({ orderWebhookUrl: url || null, orderWebhookSecret: url ? store.orderWebhookSecret || crypto.randomBytes(24).toString("hex") : store.orderWebhookSecret }).where(eq(stores.id, store.id));
    return json({ ok: url ? "Saved. Every new order is now sent to this address." : "Order webhook turned off.", error: null });
  }
  if (intent === "rotate") {
    await db.update(stores).set({ orderWebhookSecret: crypto.randomBytes(24).toString("hex") }).where(eq(stores.id, store.id));
    return json({ ok: "New secret made. Update it in the app that receives your orders.", error: null });
  }
  if (intent === "test") {
    if (!store.orderWebhookUrl || !store.orderWebhookSecret) return json({ ok: null, error: "Save an address first." }, { status: 400 });
    try {
      const status = await postWebhook(store.orderWebhookUrl, store.orderWebhookSecret, { event: "test", store: { id: store.id, name: store.name }, sent_at: new Date().toISOString() });
      return status < 300 ? json({ ok: `Test sent. Your address answered ${status}.`, error: null }) : json({ ok: null, error: `Your address answered ${status}.` }, { status: 400 });
    } catch (e) {
      return json({ ok: null, error: `Couldn't reach your address: ${e instanceof Error ? e.message : "error"}` }, { status: 400 });
    }
  }
  return json({ ok: null, error: null });
}

export default function Integrations() {
  const { id, couriers, webhookUrl, secret } = useLoaderData<typeof loader>();
  const a = useActionData<typeof action>();
  return (
    <div className="max-w-3xl space-y-5">
      <div className="flex items-center gap-2"><h1 className="flex-1 text-[22px] font-semibold tracking-tight">Integrations</h1><LearnMore topic="integrations" /></div>
      {a?.ok && <Notice tone="success">{a.ok}</Notice>}
      {a?.error && <Notice tone="error">{a.error}</Notice>}

      <section className="panel space-y-3 p-5">
        <div className="flex items-center"><h2 className="flex-1 text-[15px] font-semibold">Couriers</h2><Link to={`${storePath(id)}/logistics`} className="btn-secondary">Connect a courier</Link></div>
        <p className="text-sm text-ink-soft">Connect with your own API key or login. Delhivery with a pickup location books website orders by itself; every connected courier sends tracking updates back.</p>
        {couriers.length > 0 && (
          <ul className="flex flex-wrap gap-2">
            {couriers.map((c) => <li key={c.name} className={`rounded-full px-3 py-1 text-xs font-medium ${c.ok ? "bg-emerald-50 text-good" : "bg-red-50 text-bad"}`}>{c.name}{c.autoBook ? " · auto-booking" : ""}{c.ok ? "" : " · needs attention"}</li>)}
          </ul>
        )}
      </section>

      <section className="panel space-y-3 p-5">
        <div className="flex items-center"><h2 className="flex-1 text-[15px] font-semibold">Payment gateways</h2><Link to={`${storePath(id)}/payments`} className="btn-secondary">Add your keys</Link></div>
        <p className="text-sm text-ink-soft">PayU, Razorpay, Cashfree, PhonePe, Paytm, Easebuzz and CCAvenue with your own merchant keys. Money settles straight to your bank.</p>
      </section>

      <section className="panel space-y-4 p-5">
        <h2 className="text-[15px] font-semibold">Custom integration (any other app)</h2>
        <p className="text-sm text-ink-soft">Use this for an ERP, a warehouse or courier we don't support yet, Zapier or Make: we send every new order to your address the moment it is placed.</p>
        <Form method="post" className="flex flex-wrap gap-2">
          <input type="hidden" name="intent" value="save" />
          <input name="url" defaultValue={webhookUrl ?? ""} placeholder="https://your-app.com/growpefy/orders" className="input min-w-0 flex-1" aria-label="Order webhook address" />
          <SubmitButton className="btn-primary" busyText="Saving">Save</SubmitButton>
        </Form>
        {webhookUrl && secret && (
          <div className="space-y-3 rounded-xl bg-paper p-4 text-sm">
            <CopyField label="Secret (check X-Growpefy-Signature = HMAC-SHA256 of the body)" value={secret} />
            <p className="text-xs text-ink-soft">Each order arrives as JSON: <code>{`{ "event": "order.created", "order": { "number", "payment", "total", "cod_amount", "customer": {...}, "items": [...] } }`}</code></p>
            <div className="flex flex-wrap gap-2">
              <Form method="post"><input type="hidden" name="intent" value="test" /><SubmitButton className="btn-secondary" busyText="Sending">Send a test</SubmitButton></Form>
              <Form method="post" onSubmit={(e) => { if (!confirm("Make a new secret? The old one stops working.")) e.preventDefault(); }}><input type="hidden" name="intent" value="rotate" /><SubmitButton className="btn-quiet" busyText="Saving">New secret</SubmitButton></Form>
            </div>
          </div>
        )}
      </section>

      <p className="text-sm text-ink-soft">Need a provider that isn't here? <Link to="/dashboard/support" className="font-semibold text-pine underline">Tell us</Link> and we'll add it.</p>
    </div>
  );
}
