import { useFetcher } from "@remix-run/react";
import { CopyField, Notice, TextField } from "./ui";

export type ConnectStore = {
  id: number; name: string; shop: string; status: "requested" | "ready";
  clientId: string; hasSecret: boolean; installUrl: string;
};
type Result = { ok?: boolean; errors?: Record<string, string> | null; sent?: { email: string; whatsapp: string } | null; message?: string };

/** Growpefy team: steps to create the store's Shopify app, then a form for its Client ID, secret and install link. */
export function ConnectAppForm({ store, appUrl, scopes, action }: { store: ConnectStore; appUrl: string; scopes: string; action?: string }) {
  const f = useFetcher<Result>();
  const busy = f.state !== "idle";
  const res = f.data;
  const e = res?.errors ?? {};
  const ready = store.status === "ready";
  const sentLine = (s: { email: string; whatsapp: string }) => (
    <>Email: {s.email === "sent" ? "sent ✓" : s.email} · WhatsApp: {s.whatsapp === "sent" ? "sent ✓" : s.whatsapp}</>
  );

  return (
    <div className="space-y-5">
      <ol className="space-y-4 text-sm text-ink-soft">
        <Li n={1}>
          Open <a href="https://dev.shopify.com/dashboard" target="_blank" rel="noreferrer" className="font-medium text-pine underline">Shopify Dev Dashboard</a> → <b className="text-ink">Create app</b>. Name it:
          <div className="mt-2"><CopyField label="App name" value={`Growpefy - ${store.name}`.slice(0, 30)} /></div>
        </Li>
        <Li n={2}>
          In the app's version, paste these. Turn <b className="text-ink">off</b> “Embed app in Shopify admin” and turn <b className="text-ink">on</b> “Use legacy install flow”. Then <b className="text-ink">Release</b>.
          <div className="mt-2 space-y-3">
            <CopyField label="App URL" value={`${appUrl}/shopify/install`} />
            <CopyField label="Redirect URL" value={`${appUrl}/shopify/callback`} />
            <CopyField label="Scopes" value={scopes} />
          </div>
          <p className="mt-3">In the same version, add an <b className="text-ink">App proxy</b> (checkout and payments open on the store's own website):</p>
          <div className="mt-2 grid gap-3 sm:grid-cols-3">
            <CopyField label="Subpath prefix" value="apps" />
            <CopyField label="Subpath" value="growpefy" />
            <CopyField label="Proxy URL" value={`${appUrl}/proxy`} />
          </div>
        </Li>
        <Li n={3}>
          <b className="text-ink">Distribution</b> → <b className="text-ink">Custom distribution</b> → paste the store's address → <b className="text-ink">Generate link</b>. Copy the install link.
          <div className="mt-2"><CopyField label="Store address" value={store.shop} /></div>
        </Li>
        <Li n={4}><b className="text-ink">Settings</b> → copy the <b className="text-ink">Client ID</b> and <b className="text-ink">Client secret</b>.</Li>
        <Li n={5}>Paste all three below and save. The owner gets WhatsApp and email with the link to connect.</Li>
      </ol>

      <f.Form method="post" action={action} className="space-y-4 rounded-xl border border-rule bg-paper-raised p-4" noValidate>
        <input type="hidden" name="storeId" value={store.id} />
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField label="Client ID" name="clientId" defaultValue={store.clientId} error={e.clientId} autoComplete="off" />
          <TextField label="Client secret" name="clientSecret" type="password" autoComplete="new-password" error={e.clientSecret}
            hint={store.hasSecret ? "Saved. Leave blank to keep it." : undefined} />
        </div>
        <TextField label="Install link" name="installUrl" defaultValue={store.installUrl} error={e.installUrl} autoComplete="off" placeholder="https://admin.shopify.com/oauth/install_custom_app?..." />
        <div className="flex flex-wrap gap-2">
          <button type="submit" name="intent" value="saveConnect" className="btn-primary" disabled={busy}>
            {busy && f.formData?.get("intent") === "saveConnect" ? "Saving" : ready ? "Save changes" : "Save and notify owner"}
          </button>
          {ready && (
            <button type="submit" name="intent" value="resendReady" className="btn-secondary" disabled={busy}>
              {busy && f.formData?.get("intent") === "resendReady" ? "Sending" : "Send WhatsApp + email again"}
            </button>
          )}
        </div>
        {res?.ok && (
          <Notice tone={res.sent && (res.sent.email !== "sent" || res.sent.whatsapp !== "sent") ? "warning" : "success"}>
            {res.message ?? "Saved."} {res.sent && sentLine(res.sent)}
          </Notice>
        )}
        {res?.errors?.form && <Notice tone="error">{res.errors.form}</Notice>}
      </f.Form>
    </div>
  );
}

function Li({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-pine text-[11px] font-semibold text-white">{n}</span>
      <div className="min-w-0 flex-1">{children}</div>
    </li>
  );
}
