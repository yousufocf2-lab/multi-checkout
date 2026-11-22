// Settings → Shopify: the connected Shopify store and its customers (read live from Shopify), with search and CSV.
import type { LoaderFunctionArgs, MetaFunction } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Form, Link, useLoaderData, useNavigation, useSearchParams } from "@remix-run/react";
import { Icon } from "~/components/Icons";
import { PageHeader } from "~/components/ui";
import { requireStore, requireViewer } from "~/lib/auth.server";
import { fetchShopifyCustomers, type ShopifyCustomer } from "~/lib/shopify.server";
import { storePath } from "~/lib/store-code";

export const meta: MetaFunction = () => [{ title: "Shopify · Growpefy" }];

const connected = (s: { shopDomain: string | null; adminToken: string | null; clientId: string | null; clientSecret: string | null }) =>
  Boolean(s.shopDomain && (s.adminToken || (s.clientId && s.clientSecret)));

export async function loader({ request, params }: LoaderFunctionArgs) {
  const viewer = await requireViewer(request);
  const store = await requireStore(viewer, params.id);
  const sp = new URL(request.url).searchParams;
  const q = (sp.get("q") ?? "").trim().slice(0, 100);
  const after = sp.get("after");
  const base = { storeId: store.id, shop: store.shopDomain, q };
  if (!connected(store)) return json({ ...base, connected: false, error: null as string | null, total: null as number | null, next: null as string | null, customers: [] as ShopifyCustomer[], page: 1 });
  // Phone typed as 98765 43210 / +91…: Shopify's search wants the digits
  const digits = q.replace(/\D/g, "");
  const query = digits.length >= 6 && digits.length >= q.replace(/\s/g, "").length - 3 ? `phone:*${digits.slice(-10)}*` : q;
  try {
    const r = await fetchShopifyCustomers(store, { after, query });
    return json({ ...base, connected: true, error: null, ...r, page: Math.max(1, Number(sp.get("page")) || 1) });
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    const error = /ACCESS_DENIED|access denied|protected customer data|not approved/i.test(m)
      ? "Shopify hasn't allowed customer data for this app yet. In the Shopify Dev Dashboard open the app → API access requests → Protected customer data, select name, email, phone and address, save, then release a new version and approve it in the store."
      : /read_customers|scope/i.test(m) ? "The app doesn't have the read_customers permission. Add it to the app's scopes, release, and connect the store again."
      : `Couldn't load customers from Shopify: ${m.slice(0, 200)}`;
    return json({ ...base, connected: true, error, total: null, next: null, customers: [], page: 1 });
  }
}

const inr = (p: number) => `₹${(p / 100).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
const day = (iso: string) => new Date(iso).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", year: "numeric" });

export default function ShopifySettings() {
  const d = useLoaderData<typeof loader>();
  const [sp] = useSearchParams();
  const nav = useNavigation();
  const loading = nav.state === "loading" && nav.location?.pathname.endsWith("/shopify");
  const link = (patch: Record<string, string | null>) => { const p = new URLSearchParams(sp); for (const [k, v] of Object.entries(patch)) v == null ? p.delete(k) : p.set(k, v); return `?${p}`; };

  return (
    <div className="mx-auto w-full max-w-6xl">
      <PageHeader icon="plug" title="Shopify" description="Customers from your connected Shopify store." />

      <section className="panel mb-5 flex flex-wrap items-center gap-4 p-5">
        <span className={`grid h-11 w-11 place-items-center rounded-xl ${d.connected ? "bg-[#e3f1ea] text-[#067647]" : "bg-[#f2f4f7] text-ink-soft"}`}><Icon name="plug" className="h-5 w-5" /></span>
        <div className="min-w-0 flex-1">
          <p className="text-[15px] font-semibold">{d.shop ?? "No Shopify store"}</p>
          <p className="text-[13px] text-ink-soft">{d.connected ? (d.total != null ? `Connected · ${d.total.toLocaleString("en-IN")} customers` : "Connected") : "Not connected yet"}</p>
        </div>
        {!d.connected && <Link to={storePath(d.storeId, "install")} className="btn-primary">Connect Shopify</Link>}
      </section>

      {d.error && <div className="mb-5 rounded-xl border border-[#fecdca] bg-[#fef3f2] px-4 py-3 text-[13px] text-[#912018]">{d.error}</div>}

      {d.connected && !d.error && (
        <section className="panel overflow-hidden p-0">
          <div className="flex flex-wrap items-center gap-3 border-b border-rule p-3 sm:px-4">
            <Form method="get" className="flex min-w-0 flex-1 items-center gap-2">
              <div className="relative min-w-0 flex-1">
                <Icon name="search" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-faint" />
                <input name="q" defaultValue={d.q} aria-label="Search customers" placeholder="Name, email, mobile, city or tag" className="input h-9 min-w-0 !pl-9" />
              </div>
              <button type="submit" className="btn-secondary">Search</button>
              {d.q && <Link to="?" className="text-[13px] text-ink-soft hover:text-ink">Clear</Link>}
            </Form>
            <a href={storePath(d.storeId, `shopify/customers.csv${d.q ? `?q=${encodeURIComponent(d.q)}` : ""}`)} className="btn-secondary h-9"><Icon name="download" className="h-4 w-4" />Download CSV</a>
          </div>

          {d.customers.length === 0 ? (
            <p className="px-5 py-12 text-center text-[13px] text-ink-faint">{d.q ? "No customers match your search." : "No customers in Shopify yet."}</p>
          ) : (<>
            <div className={`hidden overflow-x-auto md:block ${loading ? "opacity-60" : ""}`}>
              <table className="w-full text-[13px]">
                <thead><tr className="border-b border-rule text-left text-[11.5px] text-ink-soft">
                  <th className="px-5 py-2 font-medium">Customer</th><th className="px-3 py-2 font-medium">Mobile</th><th className="px-3 py-2 font-medium">Location</th>
                  <th className="px-3 py-2 text-right font-medium">Orders</th><th className="px-3 py-2 text-right font-medium">Spent</th><th className="px-5 py-2 text-right font-medium">Since</th>
                </tr></thead>
                <tbody className="divide-y divide-rule">
                  {d.customers.map((c) => (
                    <tr key={c.id} className="hover:bg-[#fafafa]">
                      <td className="px-5 py-2.5"><span className="font-semibold">{c.name || "—"}</span>{c.email && <span className="block text-[11.5px] text-ink-faint">{c.email}</span>}
                        {c.tags.length > 0 && <span className="mt-1 flex flex-wrap gap-1">{c.tags.slice(0, 4).map((t) => <span key={t} className="rounded bg-[#f2f4f7] px-1.5 py-px text-[10.5px] text-ink-soft">{t}</span>)}</span>}</td>
                      <td className="num px-3">{c.phone ?? "—"}</td>
                      <td className="px-3">{[c.city, c.state].filter(Boolean).join(", ") || "—"}{c.pincode && <span className="num block text-[11.5px] text-ink-faint">{c.pincode}</span>}</td>
                      <td className="num px-3 text-right">{c.orders}</td>
                      <td className="num px-3 text-right font-medium">{inr(c.spentPaise)}</td>
                      <td className="px-5 text-right text-ink-soft">{day(c.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <ul className="divide-y divide-rule md:hidden">
              {d.customers.map((c) => (
                <li key={c.id} className="px-4 py-3 text-[13px]">
                  <p className="flex justify-between gap-2"><span className="font-semibold">{c.name || "—"}</span><span className="num font-medium">{inr(c.spentPaise)}</span></p>
                  <p className="num text-ink-soft">{[c.phone, c.email].filter(Boolean).join(" · ")}</p>
                  <p className="text-[12px] text-ink-faint">{[c.city, c.state, c.pincode].filter(Boolean).join(", ")} · {c.orders} order{c.orders === 1 ? "" : "s"}</p>
                </li>
              ))}
            </ul>
            <div className="flex items-center justify-between border-t border-rule px-5 py-3 text-[12.5px] text-ink-soft">
              <span>Page {d.page}</span>
              <span className="flex gap-2">
                {d.page > 1 && <Link to={link({ after: null, page: null })} className="btn-secondary h-8">First page</Link>}
                {d.next && <Link to={link({ after: d.next, page: String(d.page + 1) })} className="btn-secondary h-8">Next</Link>}
              </span>
            </div>
          </>)}
        </section>
      )}
    </div>
  );
}
