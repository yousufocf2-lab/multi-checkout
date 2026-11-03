// Login & security: Face ID / fingerprint (passkey) login for the logged-in person, per device.
import type { LoaderFunctionArgs, MetaFunction } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, useRevalidator } from "@remix-run/react";
import { useState } from "react";
import { FingerprintIcon, fingerprintLabel, removePasskeyRequest, useAddPasskey, useCanUsePasskeys } from "~/components/Passkey";
import { Notice, PageHeader, Section, Spinner } from "~/components/ui";
import { requireViewer } from "~/lib/auth.server";
import { listPasskeys, principalOf } from "~/lib/passkeys.server";

export const meta: MetaFunction = () => [{ title: "Login & security · Growpefy" }];

export async function loader({ request }: LoaderFunctionArgs) {
  const v = await requireViewer(request);
  const list = await listPasskeys(v);
  return json({ who: principalOf(v).label, login: v.email, keys: list.map((k) => ({ id: k.id, device: k.device || "Device", createdAt: k.createdAt.toISOString(), lastUsedAt: k.lastUsedAt?.toISOString() ?? null })) });
}

const when = (iso: string) => new Date(iso).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" });

export default function Security() {
  const d = useLoaderData<typeof loader>();
  const rv = useRevalidator();
  const can = useCanUsePasskeys();
  const [ok, setOk] = useState<string | null>(null);
  const [removing, setRemoving] = useState<number | null>(null);
  const { add, busy, error } = useAddPasskey(() => { setOk(`Done. Next time, tap “Log in with ${fingerprintLabel()}” on the login page.`); rv.revalidate(); });
  const remove = async (id: number) => {
    if (!confirm("Remove Face ID / fingerprint login for this device? You can turn it on again any time.")) return;
    setRemoving(id);
    try { await removePasskeyRequest(id); setOk("Removed."); rv.revalidate(); } finally { setRemoving(null); }
  };
  return (
    <div className="max-w-2xl">
      <PageHeader title="Login & security" description={`${d.who} · ${d.login}`} />
      <div className="space-y-5">
        {ok && <Notice tone="success">{ok}</Notice>}
        {error && <Notice tone="error">{error}</Notice>}
        <Section title="Face ID / fingerprint login" description="Log in with your phone's or laptop's screen lock instead of an OTP or password. Turn it on once on each device you use. OTP and password still work.">
          {!can.web ? (
            <Notice tone="warning">This browser doesn't support it. Open Growpefy in Chrome or Safari.</Notice>
          ) : (
            <button type="button" onClick={add} disabled={busy} className="btn-primary">{busy ? <Spinner /> : <FingerprintIcon />}Turn on for this device</button>
          )}
          <ul className="mt-5 divide-y divide-rule rounded-xl border border-rule">
            {d.keys.length === 0 && <li className="px-4 py-4 text-sm text-ink-faint">Not turned on for any device yet.</li>}
            {d.keys.map((k) => (
              <li key={k.id} className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
                <span className="text-pine"><FingerprintIcon /></span>
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{k.device}</p>
                  <p className="text-xs text-ink-faint">Added {when(k.createdAt)}{k.lastUsedAt ? ` · last used ${when(k.lastUsedAt)}` : " · not used yet"}</p>
                </div>
                <button type="button" onClick={() => remove(k.id)} disabled={removing === k.id} className="btn-quiet text-xs text-bad">{removing === k.id ? <Spinner /> : "Remove"}</button>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-ink-faint">Lost a phone? Remove it here. iPhone keeps these in iCloud Keychain and Android in your Google account, so a new phone signed in to the same account usually has them too.</p>
        </Section>
      </div>
    </div>
  );
}
