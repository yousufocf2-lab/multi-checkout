// Super admin: one globe with every store's live visitors and the last 30 minutes of orders.
import type { LoaderFunctionArgs, MetaFunction } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { Link, useLoaderData } from "@remix-run/react";
import { useEffect, useRef, useState } from "react";
import { Icon } from "~/components/Icons";
import { LiveGlobe, type GlobeHandle } from "~/components/LiveGlobe";
import { PlacesPanel } from "~/components/LivePlaces";
import { PageHeader } from "~/components/ui";
import { requireViewer, viewerStores } from "~/lib/auth.server";
import { liveSnapshotAll, type LiveAllSnapshot } from "~/lib/live.server";
import { storePath } from "~/lib/store-code";

export const meta: MetaFunction = () => [{ title: "Live globe" }];

export async function loader({ request }: LoaderFunctionArgs) {
  const viewer = await requireViewer(request);
  if (viewer.role !== "admin") return redirect("/dashboard");
  const list = await viewerStores(viewer);
  return json({ initial: await liveSnapshotAll(list.map((s) => ({ id: s.id, name: s.name }))) });
}

const POLL_MS = 4000;
const inr = (p: number) => `₹${Math.round(p / 100).toLocaleString("en-IN")}`;

export default function AdminLiveGlobe() {
  const { initial } = useLoaderData<typeof loader>();
  const [data, setData] = useState<LiveAllSnapshot>(initial as LiveAllSnapshot);
  const [ok, setOk] = useState(true);
  const globe = useRef<GlobeHandle>(null);
  useEffect(() => {
    let alive = true;
    const pull = async () => {
      if (document.visibilityState !== "visible") return;
      try {
        const r = await fetch("/dashboard/live/data", { headers: { Accept: "application/json" }, cache: "no-store" });
        if (!r.ok) throw new Error(String(r.status));
        const d = (await r.json()) as LiveAllSnapshot;
        if (alive) { setData(d); setOk(true); }
      } catch { if (alive) setOk(false); }
    };
    const t = setInterval(pull, POLL_MS);
    return () => { alive = false; clearInterval(t); };
  }, []);

  const stats = [
    { label: "Visitors right now", value: data.total.toLocaleString("en-IN"), tone: "#0284c7" },
    { label: "In checkout", value: data.stages.checkout.toLocaleString("en-IN"), tone: "#1f8f5f" },
    { label: "Value in carts", value: inr(data.cartValuePaise), tone: "#a96f00" },
    { label: "Orders · last 30 min", value: `${data.ordersLast30.toLocaleString("en-IN")} · ${inr(data.salesLast30Paise)}`, tone: "#7c3aed" },
  ];

  return (
    <div className="space-y-4">
      <PageHeader icon="globe" title="Live globe" description="Every store's visitors right now, and orders from the last 30 minutes." actions={
        <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-1 text-[11.5px] font-semibold ${ok ? "bg-[#e3f1ea] text-[#1f6f4a]" : "bg-[#fff1e3] text-[#7a4b00]"}`}>
          <span className={`h-1.5 w-1.5 rounded-full ${ok ? "animate-pulse bg-[#1f8f5f]" : "bg-[#c47f00]"}`} />{ok ? "LIVE" : "Reconnecting"}
        </span>
      } />

      <section className="panel grid grid-cols-2 overflow-hidden p-0 lg:grid-cols-4">
        {stats.map((s, i) => (
          <div key={s.label} className={`px-4 py-3 ${i % 2 ? "border-l border-rule" : ""} ${i > 1 ? "border-t border-rule lg:border-t-0" : ""} ${i === 2 ? "lg:border-l" : ""}`}>
            <p className="text-[12px] font-medium text-ink-soft">{s.label}</p>
            <p className="num mt-0.5 text-[20px] font-semibold leading-tight" style={{ color: s.tone }}>{s.value}</p>
          </div>
        ))}
      </section>

      <section className="panel overflow-hidden p-0">
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]">
          <div className="border-b border-rule lg:border-b-0 lg:border-r" style={{ background: "radial-gradient(70% 80% at 50% 45%, rgba(56,189,248,.08), transparent 70%)" }}>
            <LiveGlobe ref={globe} points={data.points} orders={data.orderPoints} height={520} showStore />
          </div>
          <PlacesPanel data={data} onPick={(lat, lon) => globe.current?.focus(lat, lon)} />
        </div>
      </section>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <section className="panel p-0">
          <div className="flex items-center justify-between border-b border-rule px-4 py-3 sm:px-5">
            <h2 className="text-[14px] font-semibold">Stores with visitors now</h2>
            <span className="num text-[12px] text-ink-faint">{data.stores.length}</span>
          </div>
          {data.stores.length ? (
            <ul className="divide-y divide-rule">
              {data.stores.map((s) => (
                <li key={s.id}>
                  <Link to={`${storePath(s.id)}/live`} className="flex items-center gap-3 px-4 py-2.5 hover:bg-paper sm:px-5">
                    <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{s.name}</span>
                    {s.checkout > 0 && <span className="rounded-full bg-[#e3f1ea] px-2 py-0.5 text-[11px] font-medium text-[#1f6f4a]">{s.checkout} in checkout</span>}
                    {s.cartPaise > 0 && <span className="hidden text-[11.5px] text-ink-faint sm:inline">Carts {inr(s.cartPaise)}</span>}
                    <b className="num w-8 text-right text-[14px]">{s.n}</b>
                    <Icon name="chevron" className="h-3.5 w-3.5 -rotate-90 text-ink-faint" />
                  </Link>
                </li>
              ))}
            </ul>
          ) : <p className="px-5 py-8 text-center text-[12.5px] text-ink-faint">No one on any store right now.</p>}
        </section>
        <section className="panel p-0">
          <div className="border-b border-rule px-4 py-3 sm:px-5"><h2 className="text-[14px] font-semibold">Where they came from</h2></div>
          {data.sources.length ? (
            <ul className="space-y-2.5 px-4 py-4 sm:px-5">
              {data.sources.map((r) => (
                <li key={r.label}>
                  <div className="flex items-center justify-between gap-3 text-[12.5px]"><span className="truncate">{r.label}</span><span className="num shrink-0 text-ink-soft">{r.n}</span></div>
                  <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-black/[.05]"><div className="h-full rounded-full bg-[#5b6cf0] transition-[width] duration-700 ease-out" style={{ width: `${(r.n / Math.max(1, data.total)) * 100}%` }} /></div>
                </li>
              ))}
            </ul>
          ) : <p className="px-5 py-8 text-center text-[12.5px] text-ink-faint">Nothing yet.</p>}
        </section>
      </div>
    </div>
  );
}
