// Super admin → Store domains (Cloudflare for SaaS): one-time setup and health.
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Form, useActionData, useLoaderData } from "@remix-run/react";
import { Notice, SubmitButton } from "~/components/ui";
import { requireSuperAdmin } from "~/lib/auth.server";
import { cfConfigured, CONNECT_HOST, fallbackStatus, setupCloudflare } from "~/lib/cloudflare.server";

export async function loader({ request }: LoaderFunctionArgs) {
  await requireSuperAdmin(request);
  const token = Boolean(process.env.CLOUDFLARE_API_TOKEN);
  const key = Boolean(process.env.CF_PROXY_KEY);
  let fallback: { origin?: string; status?: string; errors?: string[] } | null = null;
  let error: string | null = null;
  if (token) {
    try { fallback = await fallbackStatus(); } catch (e) { error = e instanceof Error ? e.message : String(e); }
  }
  return json({ token, key, ready: cfConfigured(), connect: CONNECT_HOST(), fallback, error });
}

export async function action({ request }: ActionFunctionArgs) {
  await requireSuperAdmin(request);
  try {
    const steps = await setupCloudflare();
    return json({ steps, error: null });
  } catch (e) {
    return json({ steps: [] as string[], error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}

export default function CloudflareSetup() {
  const d = useLoaderData<typeof loader>();
  const a = useActionData<typeof action>();
  const fb = d.fallback?.status;
  return (
    <div className="max-w-3xl space-y-5">
      <h1 className="text-[22px] font-semibold tracking-tight">Store domains (Cloudflare)</h1>
      <p className="text-sm text-ink-soft">Stores connect their own domain with one record: <b>CNAME www → {d.connect}</b>. This page sets up the Cloudflare side once.</p>
      {a?.error && <Notice tone="error">{a.error}</Notice>}
      {a?.steps?.length ? <Notice tone="success">{a.steps.join(" · ")}</Notice> : null}
      {d.error && <Notice tone="warning">{d.error}</Notice>}
      <section className="panel space-y-2 p-5 text-sm">
        <p>{d.token ? "✓" : "✗"} CLOUDFLARE_API_TOKEN on the server</p>
        <p>{d.key ? "✓" : "✗"} CF_PROXY_KEY on the server</p>
        <p>{fb === "active" ? "✓" : "…"} Fallback origin {d.fallback?.origin ?? "not set"}{fb ? ` (${fb})` : ""}{d.fallback?.errors?.length ? ` · ${d.fallback.errors.join(" ")}` : ""}</p>
      </section>
      <Form method="post">
        <SubmitButton className="btn-primary" busyText="Setting up" disabled={!d.ready}>{fb ? "Run setup again" : "Set up Cloudflare"}</SubmitButton>
      </Form>
      {!d.ready && <p className="text-xs text-ink-faint">Add CLOUDFLARE_API_TOKEN (and CF_PROXY_KEY) to the Railway service variables first.</p>}
    </div>
  );
}
