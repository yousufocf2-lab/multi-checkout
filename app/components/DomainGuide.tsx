// Step-by-step help for connecting a store's own domain, per domain provider.
import { useState } from "react";

type Provider = { id: string; name: string; cname: string[]; forward: string[]; note?: string };

const PROVIDERS = (host: string, target: string, bare: string, www: string): Provider[] => [
  {
    id: "godaddy", name: "GoDaddy",
    cname: [
      "Log in to GoDaddy and open My Products → your domain → DNS (Manage DNS).",
      `If there's already a record named "${host}" (CNAME or A), click the pencil and change it. Otherwise click Add New Record.`,
      `Type: CNAME · Name: ${host} · Value: ${target} · TTL: 1 hour. Save.`,
    ],
    forward: [
      `On the same DNS page scroll to Forwarding and click Add Forwarding next to Domain.`,
      `Forward to: https://${www} · Type: Permanent (301) · Settings: Forward only. Save.`,
      `GoDaddy removes the old "@" A record by itself. If one is left (for example 23.227.38.32 from Shopify), delete it.`,
    ],
  },
  {
    id: "hostinger", name: "Hostinger",
    cname: [
      "Open hPanel → Domains → your domain → DNS / Nameservers.",
      `Delete any existing record named "${host}".`,
      `Add record: Type CNAME · Name ${host} · Points to ${target} · TTL 3600. Add Record.`,
    ],
    forward: [
      `In hPanel open Domains → your domain → Redirects (or "Forward domain").`,
      `Redirect ${bare} to https://${www}, type Permanent (301). Save.`,
    ],
  },
  {
    id: "bigrock", name: "BigRock / ResellerClub",
    cname: [
      "Log in, open Manage Domain → DNS Management (Manage DNS).",
      `Open the CNAME Records tab and click Add CNAME Record.`,
      `Host name: ${host} · Value: ${target} · TTL 14400. Add Record. Delete any A record for ${host}.`,
    ],
    forward: [
      `Open Manage Domain → Domain Forwarding.`,
      `Forward ${bare} to https://${www}, turn off URL masking. Save.`,
    ],
  },
  {
    id: "namecheap", name: "Namecheap",
    cname: [
      "Open Domain List → Manage → Advanced DNS.",
      `Remove any record with host "${host}".`,
      `Add New Record: CNAME Record · Host ${host} · Value ${target} · TTL Automatic. Save.`,
    ],
    forward: [
      `Still in Advanced DNS, add a URL Redirect Record: Host @ · Value https://${www} · Permanent (301).`,
      "Delete any A record for @ (for example 23.227.38.32 from Shopify).",
    ],
  },
  {
    id: "cloudflare", name: "Cloudflare",
    cname: [
      "Open your domain in Cloudflare → DNS → Records.",
      `Edit or add: Type CNAME · Name ${host} · Target ${target}.`,
      "Important: click the orange cloud so it turns grey (DNS only). Orange stops the secure lock from being issued.",
    ],
    forward: [
      `Add a proxied (orange cloud) record for ${bare}, e.g. A @ 192.0.2.1, so Cloudflare can redirect it.`,
      `Rules → Redirect Rules → Create rule: "Redirect from root to WWW" template, target https://${www}, status 301. Deploy.`,
    ],
    note: "Use the grey cloud only for the www record. The root record stays orange so the redirect works.",
  },
  {
    id: "other", name: "Other",
    cname: [
      "Log in where you bought the domain and open its DNS settings (sometimes called DNS Zone, Name Server Management or Advanced DNS).",
      `Delete old records named "${host}".`,
      `Add a CNAME record: Name/Host ${host} · Value/Points to ${target}.`,
    ],
    forward: [
      `Look for Domain Forwarding / URL Redirect and send ${bare} to https://${www} as a permanent (301) redirect.`,
      "If you can't find it, ask your domain provider's support to forward the root domain to the www address.",
    ],
  },
];

export function DomainGuide({ domain, target, coming }: { domain: string; target: string; coming?: string | null }) {
  const bare = domain.replace(/^www\./, "");
  const www = domain.startsWith("www.") ? domain : `www.${bare}`;
  const host = domain.split(".").length > 2 ? domain.split(".").slice(0, -2).join(".") : "@";
  const list = PROVIDERS(host, target, bare, www);
  const [tab, setTab] = useState(list[0].id);
  const p = list.find((x) => x.id === tab)!;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Where you bought the domain">
        {list.map((x) => (
          <button key={x.id} type="button" role="tab" aria-selected={tab === x.id} onClick={() => setTab(x.id)}
            className={`h-8 rounded-lg px-3 text-[12.5px] font-medium ${tab === x.id ? "bg-[#303030] text-white" : "bg-[#f1f1f1] text-ink-soft hover:text-ink"}`}>{x.name}</button>
        ))}
      </div>

      <Step n={1} title={`Point ${domain} to Growpefy`}>
        <ol className="space-y-1.5">{p.cname.map((s, i) => <li key={i} className="flex gap-2"><span className="text-ink-faint">{i + 1}.</span><span>{s}</span></li>)}</ol>
      </Step>

      {domain.startsWith("www.") && (
        <Step n={2} title={`Send ${bare} (without www) to ${domain}`}>
          <p className="mb-1.5 text-ink-soft">So customers who type {bare} also reach your store. Skip this and {bare} keeps opening your old website.</p>
          <ol className="space-y-1.5">{p.forward.map((s, i) => <li key={i} className="flex gap-2"><span className="text-ink-faint">{i + 1}.</span><span>{s}</span></li>)}</ol>
        </Step>
      )}

      <Step n={domain.startsWith("www.") ? 3 : 2} title="Moving from Shopify or another platform?">
        <ul className="space-y-1.5">
          <li>• In Shopify open Settings → Domains and remove {bare} and {www}, so Shopify stops sending visitors back to it.</li>
          <li>• Keep the Shopify store itself running while orders still sync to it.</li>
          <li>• Product links like /products/… keep working on Growpefy.</li>
        </ul>
      </Step>

      {p.note && <p className="rounded-lg bg-[#fff1e3] px-3 py-2 text-[12.5px] text-[#5e4200]">{p.note}</p>}

      <div className="rounded-lg bg-[#f6f6f4] px-3 py-2.5 text-[12.5px] text-ink-soft">
        <b className="text-ink">How long?</b> Usually 10–30 minutes, sometimes up to a few hours. The secure lock (https) is added for you. If the old website still shows, open the address in an incognito window: browsers remember the old one for a while.
        {coming && <span className="mt-1 block text-[11.5px] text-ink-faint">Current status: {coming}</span>}
      </div>
    </div>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3 text-[13px]">
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#303030] text-[12px] font-semibold text-white">{n}</span>
      <div className="min-w-0 flex-1"><p className="mb-1.5 font-semibold">{title}</p>{children}</div>
    </div>
  );
}
