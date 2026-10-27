import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { Form, Link, useActionData, useLoaderData, useNavigation, useSearchParams } from "@remix-run/react";
import { eq } from "drizzle-orm";
import { useState } from "react";
import { StoreSettingsForm } from "~/components/StoreSettingsForm";
import { Notice, PageHeader, Section, TextField } from "~/components/ui";
import { db, stores, users } from "~/db.server";
import { requireViewer } from "~/lib/auth.server";
import { parseShopInput, slugify } from "~/lib/connect";
import { requestConnect, shopExists } from "~/lib/connect.server";
import { parseStoreForm } from "~/lib/store-form.server";

/** Websites the owner gave at signup that aren't connected yet: the first one pre-fills the form. */
export async function loader({ request }: LoaderFunctionArgs) {
  const viewer = await requireViewer(request);
  const isAdmin = viewer.role === "admin";
  if (viewer.role !== "owner") return json({ suggestions: [], brand: "", isAdmin });
  const [u] = await db.select({ signup: users.signup, name: users.name }).from(users).where(eq(users.id, viewer.userId)).limit(1);
  const mine = await db.select({ url: stores.storefrontUrl }).from(stores).where(eq(stores.ownerId, viewer.userId));
  const host = (x: string) => x.replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "").toLowerCase();
  const used = new Set(mine.map((m) => host(m.url)));
  const suggestions = (u?.signup?.websites ?? []).filter((w) => !used.has(host(w.url))).map((w) => ({ url: w.url, platform: w.platform }));
  return json({ suggestions, brand: mine.length ? "" : u?.name ?? "", isAdmin });
}

export async function action({ request }: ActionFunctionArgs) {
  const viewer = await requireViewer(request);
  const fd = await request.formData();

  // Shopify: the owner only gives the .myshopify.com address; Growpefy's team makes the app
  if (fd.get("intent") === "requestConnect") {
    const raw = String(fd.get("shop") ?? "");
    const parsed = parseShopInput(raw);
    if ("error" in parsed) return json({ errors: { shop: parsed.error } as Record<string, string>, shop: raw }, { status: 400 });
    if (!(await shopExists(parsed.shop))) {
      return json({ errors: { shop: `No Shopify store found at ${parsed.shop}. Check the address (see the steps below).` } as Record<string, string>, shop: raw }, { status: 400 });
    }
    const r = await requestConnect({
      ownerId: viewer.role === "owner" ? viewer.userId : null,
      shop: parsed.shop,
      website: String(fd.get("website") ?? "").trim() || null,
    });
    if ("error" in r) return json({ errors: { shop: r.error } as Record<string, string>, shop: raw }, { status: 400 });
    return redirect(`/dashboard/stores/${r.storeId}/install${r.existed ? "" : "?requested=1"}`);
  }

  // WooCommerce (and the team's manual Shopify setup): the full form
  const { data, errors } = parseStoreForm(fd);
  if (!errors.slug) {
    const [d] = await db.select({ id: stores.id }).from(stores).where(eq(stores.slug, data.slug)).limit(1);
    if (d) errors.slug = "This store ID is taken. Try another.";
  }
  if (Object.keys(errors).length) return json({ errors, shop: "" }, { status: 400 });
  const [created] = await db
    .insert(stores)
    .values({ ...data, active: true, ownerId: viewer.role === "owner" ? viewer.userId : null })
    .returning({ id: stores.id });
  return redirect(`/dashboard/stores/${created.id}/install?created=1`);
}

export default function NewStore() {
  const data = useActionData<typeof action>();
  const { suggestions, brand, isAdmin } = useLoaderData<typeof loader>();
  const [params] = useSearchParams();
  const manual = isAdmin && params.get("manual") === "1";
  const first = suggestions[0];
  const [platform, setPlatform] = useState<"shopify" | "woocommerce">(first?.platform === "woocommerce" ? "woocommerce" : "shopify");
  const errors = (data?.errors ?? {}) as Record<string, string>;
  const wooSite = suggestions.find((s) => s.platform === "woocommerce") ?? (first?.platform === "other" ? first : undefined);
  const values = {
    storefrontUrl: platform === "woocommerce" ? wooSite?.url : first?.url,
    name: brand || undefined,
    platform,
    slug: brand ? slugify(brand) : undefined,
  };

  return (
    <div className="max-w-3xl">
      <Link to="/dashboard/stores" className="text-sm text-ink-soft hover:text-ink">Stores</Link>
      <PageHeader title="Connect a store" description="Pick where your store runs. Shopify stores connect in one click once we've set up your app." />

      <div className="mb-5 grid gap-3 sm:grid-cols-2" role="radiogroup" aria-label="Store platform">
        {([["shopify", "Shopify", "Give us your store address. We set up the app and you connect with one click."], ["woocommerce", "WooCommerce", "Install the Growpefy plugin on WordPress. The Checkout page opens Growpefy."]] as const).map(([id, label, text]) => (
          <button key={id} type="button" role="radio" aria-checked={platform === id} onClick={() => setPlatform(id)}
            className={`rounded-xl border-2 p-4 text-left transition ${platform === id ? "border-pine bg-pine-tint/40" : "border-rule bg-surface hover:border-rule-strong"}`}>
            <span className="flex items-center gap-2 font-semibold">
              <span className={`h-4 w-4 rounded-full border-2 ${platform === id ? "border-pine bg-pine shadow-[inset_0_0_0_3px_white]" : "border-rule-strong"}`} />
              <img src={`/brand/platforms/${id}.png`} alt="" className="h-5 w-5 object-contain" />
              {label}
            </span>
            <span className="mt-1 block text-xs text-ink-soft">{text}</span>
          </button>
        ))}
      </div>

      {platform === "shopify" && !manual ? (
        <ShopifyRequest errors={errors} shop={data?.shop ?? ""} website={first?.platform === "shopify" ? first.url : ""} isAdmin={isAdmin} />
      ) : (
        <>
          {Object.keys(errors).length > 0 && <div className="mb-5"><Notice tone="error">Fix the highlighted fields to continue.</Notice></div>}
          {manual && platform === "shopify" && <div className="mb-5"><Notice tone="info">Manual setup: paste the app's Client ID and secret yourself. <Link to="/dashboard/stores/new" className="underline">Use Get credentials instead</Link></Notice></div>}
          <StoreSettingsForm key={platform} values={values} errors={errors} submitLabel="Save and continue" isNew lockPlatform isAdmin={isAdmin}
            siteSuggestions={suggestions.filter((s) => (platform === "woocommerce" ? s.platform !== "shopify" : s.platform !== "woocommerce"))} />
        </>
      )}
    </div>
  );
}

/** Shopify: just the .myshopify.com address and "Get credentials". */
function ShopifyRequest({ errors, shop, website, isAdmin }: { errors: Record<string, string>; shop: string; website: string; isAdmin: boolean }) {
  const nav = useNavigation();
  const busy = nav.state !== "idle" && nav.formData?.get("intent") === "requestConnect";
  return (
    <div className="space-y-5">
      <Section title="Your Shopify store address" description="The address that ends with .myshopify.com. Every Shopify store has one, even with its own website.">
        <Form method="post" className="space-y-4" noValidate>
          <TextField label="Shopify store address" name="shop" defaultValue={shop} error={errors.shop} placeholder="yourstore.myshopify.com"
            autoComplete="off" autoCapitalize="none" spellCheck={false} required
            hint="You can also paste the link from your Shopify admin's address bar." />
          <TextField label="Store website (optional)" name="website" defaultValue={website} placeholder="https://yourstore.com" autoComplete="url" />
          <div className="flex flex-wrap items-center gap-3">
            <button type="submit" name="intent" value="requestConnect" className="btn-primary" disabled={busy}>{busy ? "Sending" : "Get credentials"}</button>
            <p className="text-xs text-ink-faint">Our team sets up your app, usually within a few hours. You get WhatsApp and email when it's ready.</p>
          </div>
        </Form>
      </Section>

      <Section title="Where do I find this address?" description="Takes 10 seconds. Use any one of these.">
        <ol className="space-y-4 text-sm text-ink-soft">
          <Guide n={1} title="From the address bar (easiest)">
            Log in to your Shopify admin on a computer. Look at the address bar at the top:
            <span className="mt-2 block rounded-lg border border-rule bg-paper-sunk px-3 py-2 font-mono text-[13px] text-ink">admin.shopify.com/store/<b className="rounded bg-amber-100 px-1">abcd12-xy</b>/…</span>
            The part after <b className="text-ink">/store/</b> is your store's name. Your address is <b className="text-ink">abcd12-xy.myshopify.com</b>. You can also paste the whole link above.
          </Guide>
          <Guide n={2} title="From Settings">
            Shopify admin → <b className="text-ink">Settings</b> (bottom left) → <b className="text-ink">Domains</b>. The address that ends with <b className="text-ink">.myshopify.com</b> is the one we need.
          </Guide>
          <Guide n={3} title="On the Shopify app (phone)">
            Open the Shopify app → tap your store name at the top → <b className="text-ink">Settings</b> → <b className="text-ink">Domains</b>.
          </Guide>
        </ol>
        <div className="mt-5 rounded-xl border border-rule bg-paper-raised p-4 text-sm">
          <p className="font-semibold">What happens next</p>
          <ol className="mt-2 list-decimal space-y-1 pl-5 text-ink-soft">
            <li>We create your Growpefy app on Shopify and send you WhatsApp + email.</li>
            <li>You click <b className="text-ink">Connect store</b> here, log in to Shopify and click <b className="text-ink">Install</b>.</li>
            <li>You come back here connected. Then paste one line in your theme and you're live.</li>
          </ol>
        </div>
      </Section>

      {isAdmin && <p className="text-xs text-ink-faint">Growpefy team: <Link to="?manual=1" className="underline">set up a Shopify store manually</Link> with its Client ID and secret.</p>}
    </div>
  );
}

function Guide({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-pine text-xs font-semibold text-white">{n}</span>
      <div className="min-w-0 flex-1"><p className="font-semibold text-ink">{title}</p><div className="mt-1">{children}</div></div>
    </li>
  );
}
