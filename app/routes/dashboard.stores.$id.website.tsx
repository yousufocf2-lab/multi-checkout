// Growpefy Store → Website & domain: preview link and the store's own domain (www.brand.com).
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Form, useActionData, useLoaderData } from "@remix-run/react";
import { and, eq, ne } from "drizzle-orm";
import { CopyField, Notice, SubmitButton } from "~/components/ui";
import { db, stores } from "~/db.server";
import { requireStore, requireViewer } from "~/lib/auth.server";
import { catalogAllowed } from "~/lib/catalog.server";
import { env } from "~/lib/env.server";

/** "https://Brand.com/" -> "www.brand.com"; "shop.brand.com" stays as it is. Null when it isn't a domain. */
function cleanDomain(raw: string) {
  const h = raw.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/[/?#].*$/, "").replace(/\.$/, "");
  if (!/^(?=.{4,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}$/.test(h)) return null;
  if (/(^|\.)growpefy\.com$|\.railway\.app$|myshopify\.com$/.test(h)) return null;
  return h.split(".").length === 2 ? `www.${h}` : h;
}

export async function loader({ request, params }: LoaderFunctionArgs) {
  const viewer = await requireViewer(request);
  const store = await requireStore(viewer, params.id);
  if (!catalogAllowed(viewer, store)) throw new Response("Not found", { status: 404 });
  return json({
    isAdmin: viewer.role === "admin",
    preview: `${env.appUrl}/s/${store.slug}`,
    domain: store.storefrontDomain, target: store.storefrontDnsTarget, status: store.storefrontDomainStatus,
  });
}

export async function action({ request, params }: ActionFunctionArgs) {
  const viewer = await requireViewer(request);
  const store = await requireStore(viewer, params.id);
  if (!catalogAllowed(viewer, store)) throw new Response("Not found", { status: 404 });
  const fd = await request.formData();
  const intent = fd.get("intent");
  if (intent === "domain") {
    const d = cleanDomain(String(fd.get("domain") ?? ""));
    if (!d) return json({ ok: null, error: "That doesn't look like a domain. Type it like brand.com" }, { status: 400 });
    const [taken] = await db.select({ id: stores.id }).from(stores).where(and(eq(stores.storefrontDomain, d), ne(stores.id, store.id))).limit(1);
    if (taken) return json({ ok: null, error: "This domain is already connected to another store." }, { status: 400 });
    await db.update(stores).set({ storefrontDomain: d, storefrontDomainStatus: "requested", storefrontDnsTarget: null }).where(eq(stores.id, store.id));
    console.log(`[domain] store=${store.id} requested ${d}`);
    return json({ ok: `Got it. We're preparing ${d}; you'll see the DNS record to add here shortly.`, error: null });
  }
  if (intent === "remove") {
    await db.update(stores).set({ storefrontDomain: null, storefrontDomainStatus: null, storefrontDnsTarget: null }).where(eq(stores.id, store.id));
    return json({ ok: "Domain removed. Your website is still on the preview link.", error: null });
  }
  if (viewer.role === "admin" && intent === "target") {
    const t = String(fd.get("target") ?? "").trim().toLowerCase().replace(/\.$/, "");
    const live = fd.get("live") === "on";
    await db.update(stores).set({ storefrontDnsTarget: t || null, storefrontDomainStatus: live ? "live" : t ? "dns" : "requested" }).where(eq(stores.id, store.id));
    return json({ ok: "Saved.", error: null });
  }
  return json({ ok: null, error: null });
}

export default function Website() {
  const { isAdmin, preview, domain, target, status } = useLoaderData<typeof loader>();
  const a = useActionData<typeof action>();
  const bare = domain?.replace(/^www\./, "");
  return (
    <div className="max-w-3xl space-y-5">
      <h1 className="text-[22px] font-semibold tracking-tight">Website & domain</h1>
      {a?.ok && <Notice tone="success">{a.ok}</Notice>}
      {a?.error && <Notice tone="error">{a.error}</Notice>}

      <section className="panel space-y-3 p-5">
        <h2 className="text-[15px] font-semibold">Preview</h2>
        <CopyField label="Preview link (not shown on Google)" value={preview} />
        <a href={preview} target="_blank" rel="noreferrer" className="btn-secondary inline-flex">Open website</a>
      </section>

      <section className="panel space-y-4 p-5">
        <div className="flex items-center gap-2">
          <h2 className="flex-1 text-[15px] font-semibold">Your domain</h2>
          {status && <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${status === "live" ? "bg-emerald-50 text-good" : "bg-amber-50 text-amber-800"}`}>{status === "live" ? "Live" : status === "dns" ? "Add the DNS record" : "Being prepared"}</span>}
        </div>

        {!domain ? (
          <Form method="post" className="flex flex-wrap gap-2">
            <input type="hidden" name="intent" value="domain" />
            <input name="domain" required placeholder="brand.com" className="input min-w-0 flex-1" aria-label="Your domain" />
            <SubmitButton className="btn-primary" busyText="Saving">Connect domain</SubmitButton>
          </Form>
        ) : (
          <>
            <p className="text-sm">Website address: <b>{domain}</b>{status === "live" && <> · <a className="font-semibold text-pine underline" href={`https://${domain}`} target="_blank" rel="noreferrer">Open</a></>}</p>
            {status === "requested" && <p className="text-sm text-ink-soft">We're setting up your domain on Growpefy. The record to add will appear here, usually within a few hours.</p>}
            {target && status !== "live" && (
              <div className="space-y-3 rounded-xl bg-paper p-4 text-sm">
                <p className="font-semibold">Add this record where you bought the domain (GoDaddy, Hostinger, Cloudflare...)</p>
                <div className="grid gap-2 sm:grid-cols-3">
                  <CopyField label="Type" value="CNAME" />
                  <CopyField label="Name / Host" value={domain.split(".").length > 2 ? domain.split(".").slice(0, -2).join(".") : "@"} />
                  <CopyField label="Value / Points to" value={target} />
                </div>
                {domain.startsWith("www.") && <p className="text-ink-soft">Then turn on <b>forwarding</b> from {bare} to https://{domain} in the same place, so both addresses open your store. Delete any old A or CNAME records for www first.</p>}
                <p className="text-ink-soft">It usually starts working within 30 minutes (sometimes a few hours). The secure lock (https) is added automatically.</p>
              </div>
            )}
            {status === "live" && <p className="text-sm text-ink-soft">Your admin opens at <b>{domain}/admin</b>.</p>}
            <Form method="post" onSubmit={(e) => { if (!confirm("Remove this domain? Your website stays on the preview link.")) e.preventDefault(); }}>
              <input type="hidden" name="intent" value="remove" />
              <button className="text-sm text-bad underline">Remove domain</button>
            </Form>
          </>
        )}
      </section>

      {isAdmin && domain && (
        <section className="panel space-y-3 border-dashed p-5">
          <h2 className="text-[15px] font-semibold">Growpefy team</h2>
          <p className="text-xs text-ink-soft">Add <b>{domain}</b> on the hosting side, paste the CNAME target here, and tick Live once it is verified. Only the Growpefy team sees this box.</p>
          <Form method="post" className="flex flex-wrap items-center gap-2">
            <input type="hidden" name="intent" value="target" />
            <input name="target" defaultValue={target ?? ""} placeholder="CNAME target" className="input min-w-0 flex-1" aria-label="CNAME target" />
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="live" defaultChecked={status === "live"} />Live</label>
            <SubmitButton className="btn-secondary" busyText="Saving">Save</SubmitButton>
          </Form>
        </section>
      )}
    </div>
  );
}
