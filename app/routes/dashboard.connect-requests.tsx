import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Link, useLoaderData } from "@remix-run/react";
import { useEffect, useState } from "react";
import { ConnectAppForm } from "~/components/ConnectAppForm";
import { EmptyState, PageHeader } from "~/components/ui";
import { can, requireViewer } from "~/lib/auth.server";
import { CONNECT_WA_TEMPLATES } from "~/lib/connect";
import { connectFormAction, connectRequests } from "~/lib/connect.server";
import { env } from "~/lib/env.server";
import { SHOPIFY_SCOPES } from "~/lib/scopes";

export const meta: MetaFunction = () => [{ title: "Connect requests · Growpefy" }];

async function teamOnly(request: Request) {
  const v = await requireViewer(request);
  if (v.role !== "admin" || !can(v, "stores")) throw new Response("Not found", { status: 404 });
  return v;
}

export async function loader({ request }: LoaderFunctionArgs) {
  await teamOnly(request);
  return json({ list: await connectRequests(), appUrl: env.appUrl, scopes: SHOPIFY_SCOPES });
}

export async function action({ request }: ActionFunctionArgs) {
  await teamOnly(request);
  return json(await connectFormAction(await request.formData()));
}

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" }) : "");
function ago(iso: string | null) {
  if (!iso) return "";
  const m = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  return m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`;
}

export default function ConnectRequests() {
  const { list, appUrl, scopes } = useLoaderData<typeof loader>();
  const waiting = list.filter((r) => r.status === "requested");
  const ready = list.filter((r) => r.status === "ready");
  const [open, setOpen] = useState<number | null>(waiting[0]?.id ?? null);
  // Links in the alert email open that store's request
  useEffect(() => {
    const id = Number(window.location.hash.replace("#store-", ""));
    if (id) { setOpen(id); document.getElementById(`store-${id}`)?.scrollIntoView(); }
  }, []);

  const row = (r: (typeof list)[number]) => (
    <li key={r.id} id={`store-${r.id}`} className="panel scroll-mt-6">
      <button type="button" onClick={() => setOpen(open === r.id ? null : r.id)} aria-expanded={open === r.id}
        className="flex w-full flex-wrap items-center gap-3 px-5 py-4 text-left">
        <span className="min-w-0 flex-1">
          <span className="block font-semibold">{r.owner?.name || r.name}</span>
          <span className="block truncate text-xs text-ink-faint">{r.shop}{r.website && !r.website.includes(".myshopify.com") ? ` · ${r.website.replace(/^https?:\/\//, "")}` : ""}</span>
        </span>
        <span className="text-right text-xs text-ink-faint">
          {r.status === "requested" ? <>Asked {ago(r.requestedAt)}</> : <>Link sent {ago(r.readyAt)}</>}
          <span className="block">{r.owner?.phone ?? ""}{r.owner?.phone && r.owner?.email ? " · " : ""}{r.owner?.email ?? ""}</span>
        </span>
        <span className={`rounded-md px-2 py-0.5 text-xs font-semibold ${r.status === "requested" ? "bg-amber-50 text-amber-800" : "bg-sky-50 text-sky-800"}`}>
          {r.status === "requested" ? "Make the app" : "Waiting for owner to install"}
        </span>
      </button>
      {open === r.id && (
        <div className="border-t border-rule px-5 py-5">
          <p className="mb-4 text-xs text-ink-faint">
            Asked {when(r.requestedAt)}. Store ID <b className="text-ink">{r.slug}</b> ·{" "}
            <Link to={`/dashboard/stores/${r.id}/install`} className="underline">Open store setup</Link>
          </p>
          <ConnectAppForm store={r} appUrl={appUrl} scopes={scopes} />
        </div>
      )}
    </li>
  );

  return (
    <div className="max-w-4xl">
      <PageHeader title="Connect requests" description="Stores that asked to connect Shopify. Make the app, paste its details, and the owner connects with one click." />
      {list.length === 0 ? (
        <EmptyState title="No requests right now">When an owner clicks “Get credentials”, the store shows up here and you get an email and WhatsApp.</EmptyState>
      ) : (
        <div className="space-y-6">
          {waiting.length > 0 && <section><h2 className="mb-2 text-sm font-semibold text-ink-soft">To do ({waiting.length})</h2><ul className="space-y-3">{waiting.map(row)}</ul></section>}
          {ready.length > 0 && <section><h2 className="mb-2 text-sm font-semibold text-ink-soft">Link sent, not installed yet ({ready.length})</h2><ul className="space-y-3">{ready.map(row)}</ul></section>}
        </div>
      )}

      <details className="panel mt-8 p-5">
        <summary className="cursor-pointer text-sm font-semibold">WhatsApp templates for these messages</summary>
        <p className="mt-2 text-sm text-ink-soft">Create these two in WhatsApp Manager (category Utility, language English). Until they're approved, only the emails go out.</p>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          {Object.entries(CONNECT_WA_TEMPLATES).map(([k, t]) => (
            <div key={k} className="rounded-xl border border-rule p-4">
              <p className="text-xs font-semibold text-ink-faint">{k === "request" ? "To you, on a new request" : "To the owner, when the link is ready"}</p>
              <p className="mt-1 font-mono text-sm font-semibold">{t.name}</p>
              <pre className="mt-2 whitespace-pre-wrap rounded-lg bg-paper-sunk p-3 text-xs text-ink-soft">{t.text}</pre>
            </div>
          ))}
        </div>
      </details>
    </div>
  );
}
