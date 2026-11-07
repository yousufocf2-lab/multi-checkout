// Stores' own domains through Cloudflare for SaaS (zone growpefy.com).
// The store adds one record: CNAME www -> connect.growpefy.com. Cloudflare issues the SSL certificate, and a small
// Worker forwards every request to growpefy.com with the shopper's domain in X-GP-Host (signed with CF_PROXY_KEY),
// so the app knows which store to show. Nobody adds domains on the hosting side by hand any more.
import { env } from "./env.server";

const API = "https://api.cloudflare.com/client/v4";
export const CONNECT_HOST = () => `connect.${new URL(env.appUrl).hostname}`;
const ZONE_NAME = () => new URL(env.appUrl).hostname;
const WORKER = "growpefy-domains";

export const cfConfigured = () => Boolean(process.env.CLOUDFLARE_API_TOKEN && process.env.CF_PROXY_KEY);

type CfResp<T> = { success: boolean; errors?: { code: number; message: string }[]; result: T };

async function cf<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = process.env.CLOUDFLARE_API_TOKEN;
  if (!token) throw new Error("CLOUDFLARE_API_TOKEN is not set on the server.");
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, ...(init.body && !(init.body instanceof FormData) ? { "Content-Type": "application/json" } : {}), ...(init.headers ?? {}) },
    signal: AbortSignal.timeout(20_000),
  });
  const body = (await res.json().catch(() => null)) as CfResp<T> | null;
  if (!body?.success) {
    const msg = body?.errors?.map((e) => `${e.message} (${e.code})`).join("; ") || `HTTP ${res.status}`;
    throw new Error(`Cloudflare: ${msg}`);
  }
  return body.result;
}

let zoneCache: { id: string; account: string } | null = null;
export async function zone() {
  if (zoneCache) return zoneCache;
  const list = await cf<{ id: string; account: { id: string } }[]>(`/zones?name=${encodeURIComponent(ZONE_NAME())}`);
  if (!list[0]) throw new Error(`Zone ${ZONE_NAME()} not found for this token.`);
  zoneCache = { id: list[0].id, account: list[0].account.id };
  return zoneCache;
}

const WORKER_JS = `export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const headers = new Headers(request.headers);
    headers.set("x-gp-host", url.hostname);
    headers.set("x-gp-key", env.PROXY_KEY);
    headers.set("x-gp-ip", request.headers.get("cf-connecting-ip") || "");
    headers.delete("host");
    const target = new URL(url.pathname + url.search, env.ORIGIN);
    const init = { method: request.method, headers, redirect: "manual" };
    if (request.method !== "GET" && request.method !== "HEAD") init.body = request.body;
    return fetch(target.toString(), init);
  },
};`;

/** One-time setup: connect.<zone> record, the forwarding Worker + its route, and the fallback origin. Safe to run again. */
export async function setupCloudflare() {
  const steps: string[] = [];
  const z = await zone();
  steps.push("Found the growpefy.com zone");

  // 1. connect.growpefy.com (proxied) — what stores point their domain to
  const name = CONNECT_HOST();
  const existing = await cf<{ id: string }[]>(`/zones/${z.id}/dns_records?name=${encodeURIComponent(name)}`);
  const rec = { type: "CNAME", name, content: ZONE_NAME(), proxied: true, ttl: 1, comment: "Growpefy Store domains (Cloudflare for SaaS fallback origin)" };
  if (existing[0]) await cf(`/zones/${z.id}/dns_records/${existing[0].id}`, { method: "PUT", body: JSON.stringify(rec) });
  else await cf(`/zones/${z.id}/dns_records`, { method: "POST", body: JSON.stringify(rec) });
  steps.push(`DNS record ${name} ready`);

  // 2. The Worker that forwards store domains to the app
  const form = new FormData();
  form.append("metadata", JSON.stringify({
    main_module: "worker.js", compatibility_date: "2024-09-23",
    bindings: [{ type: "plain_text", name: "ORIGIN", text: env.appUrl }, { type: "secret_text", name: "PROXY_KEY", text: process.env.CF_PROXY_KEY }],
  }));
  form.append("worker.js", new Blob([WORKER_JS], { type: "application/javascript+module" }), "worker.js");
  await cf(`/accounts/${z.account}/workers/scripts/${WORKER}`, { method: "PUT", body: form });
  steps.push("Forwarding Worker deployed");

  // 3. Run it for every proxied hostname in the zone (connect.* and every store's domain)
  const routes = await cf<{ id: string; pattern: string; script?: string }[]>(`/zones/${z.id}/workers/routes`);
  if (!routes.some((r) => r.pattern === "*/*" && r.script === WORKER)) {
    await cf(`/zones/${z.id}/workers/routes`, { method: "POST", body: JSON.stringify({ pattern: "*/*", script: WORKER }) });
  }
  steps.push("Worker route */* active");

  // 4. Fallback origin for custom hostnames
  await cf(`/zones/${z.id}/custom_hostnames/fallback_origin`, { method: "PUT", body: JSON.stringify({ origin: name }) });
  steps.push(`Fallback origin set to ${name}`);
  return steps;
}

export async function fallbackStatus() {
  const z = await zone();
  return cf<{ origin?: string; status?: string; errors?: string[] }>(`/zones/${z.id}/custom_hostnames/fallback_origin`);
}

type CustomHostname = { id: string; hostname: string; status: string; ssl?: { status?: string; validation_errors?: { message: string }[] }; verification_errors?: string[] };

export async function findHostname(hostname: string) {
  const z = await zone();
  const list = await cf<CustomHostname[]>(`/zones/${z.id}/custom_hostnames?hostname=${encodeURIComponent(hostname)}`);
  return list.find((h) => h.hostname === hostname) ?? null;
}

/**
 * Cloudflare can't serve a store's domain until the zone has a fallback origin ("zone does not have a fallback
 * origin set"). If it's missing, run the one-time setup (connect.* record, Worker, route, fallback origin) now.
 */
let fallbackOk = false;
export async function ensureFallback() {
  if (fallbackOk || !cfConfigured()) return;
  const fb = await fallbackStatus().catch(() => null);
  if (fb?.origin && fb.status !== "error") { fallbackOk = true; return; }
  const steps = await setupCloudflare();
  console.log(`[cloudflare] fallback origin was missing, setup ran: ${steps.join(" · ")}`);
  fallbackOk = true;
}

/** Adds the store's domain to Cloudflare (certificate by HTTP validation once the CNAME points to connect.*). */
export async function addHostname(hostname: string) {
  await ensureFallback().catch((e) => console.error("[cloudflare] setup:", e instanceof Error ? e.message : e));
  const found = await findHostname(hostname);
  if (found) return found;
  const z = await zone();
  return cf<CustomHostname>(`/zones/${z.id}/custom_hostnames`, {
    method: "POST",
    body: JSON.stringify({ hostname, ssl: { method: "http", type: "dv", settings: { min_tls_version: "1.2" } } }),
  });
}

export async function removeHostname(hostname: string) {
  const found = await findHostname(hostname);
  if (!found) return;
  const z = await zone();
  await cf(`/zones/${z.id}/custom_hostnames/${found.id}`, { method: "DELETE" });
}

/** live = hostname active and certificate issued. */
export async function hostnameState(hostname: string): Promise<{ state: "missing" | "pending" | "live"; detail: string | null }> {
  await ensureFallback().catch((e) => console.error("[cloudflare] setup:", e instanceof Error ? e.message : e));
  const h = await findHostname(hostname);
  if (!h) return { state: "missing", detail: null };
  const ssl = h.ssl?.status ?? "";
  if (h.status === "active" && ssl === "active") return { state: "live", detail: null };
  const detail = [...(h.verification_errors ?? []), ...(h.ssl?.validation_errors ?? []).map((e) => e.message)].filter(Boolean).join(" ").slice(0, 300) || null;
  return { state: "pending", detail };
}
