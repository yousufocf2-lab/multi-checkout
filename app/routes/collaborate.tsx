// Public: an agency or freelancer asks a store for access with the store's collaborator code. The owner approves in Team & access.
import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Form, Link, useActionData, useLoaderData } from "@remix-run/react";
import { useState } from "react";
import { eq } from "drizzle-orm";
import { AuthShell } from "~/components/AuthShell";
import { Notice, SubmitButton, TextField } from "~/components/ui";
import { collaboratorRequests, db, stores } from "~/db.server";
import { hashPassword, loginTaken, teamLogin } from "~/lib/auth.server";
import { noteMiss, pendingCount, tooManyMisses } from "~/lib/collaborators.server";
import { requireAppHost } from "~/lib/host.server";
import { clientIp } from "~/lib/orders.server";
import { cleanPerms, OWNER_PERMS } from "~/lib/team";
import { logTeam } from "~/lib/team-activity.server";

export const meta: MetaFunction = () => [{ title: "Request collaborator access · Growpefy" }];

const ASKABLE = OWNER_PERMS.filter((p) => p.id !== "team" && p.id !== "billing");

export async function loader({ request }: LoaderFunctionArgs) {
  requireAppHost(request);
  const u = new URL(request.url);
  return json({ store: u.searchParams.get("store") ?? "" });
}

type Res = { ok?: string; error?: string; errors?: Record<string, string> };

export async function action({ request }: ActionFunctionArgs) {
  requireAppHost(request);
  const ip = clientIp(request) ?? "unknown";
  if (tooManyMisses(ip)) return json<Res>({ error: "Too many tries. Please try again in an hour." }, { status: 429 });
  const fd = await request.formData();
  const s = (k: string, max = 120) => String(fd.get(k) ?? "").trim().slice(0, max);
  const errors: Record<string, string> = {};
  const slug = s("store", 60).toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  const code = s("code", 10).replace(/\D/g, "");
  const name = s("name", 80);
  const key = teamLogin(s("login"));
  const password = String(fd.get("password") ?? "");
  const perms = cleanPerms("owner", fd.getAll("perms").map(String)).filter((p) => ASKABLE.some((a) => a.id === p));
  if (name.length < 2) errors.name = "Enter your name";
  if (!key) errors.login = "Enter a valid email or 10-digit mobile number";
  if (password.length < 8) errors.password = "Use at least 8 characters";
  if (!perms.length) errors.perms = "Pick what you need access to";
  if (!slug) errors.store = "Enter the store ID";
  if (code.length !== 6) errors.code = "The request code has 6 digits";
  if (Object.keys(errors).length) return json<Res>({ errors }, { status: 400 });

  const [store] = await db.select().from(stores).where(eq(stores.slug, slug)).limit(1);
  if (!store || !store.ownerId || !store.collabOpen || store.collabCode !== code) {
    noteMiss(ip);
    return json<Res>({ error: "The store ID or request code doesn't match. Ask the store owner for the code from Settings → Team & access → Collaborators." }, { status: 400 });
  }
  if (await loginTaken(key!)) return json<Res>({ errors: { login: "This email or number already has a Growpefy login. Use another one for this store." } }, { status: 400 });
  if ((await pendingCount(store.id, key!)) > 0) return json<Res>({ ok: `Your request is already waiting for ${store.name} to approve it.` });

  await db.insert(collaboratorRequests).values({
    storeId: store.id, name, login: key!, passwordHash: await hashPassword(password),
    company: s("company", 80) || null, message: s("message", 500) || null, perms,
  });
  await logTeam("owner", store.ownerId, name, "Requested collaborator access", `${store.name}${s("company", 80) ? ` · ${s("company", 80)}` : ""}`);
  return json<Res>({ ok: `Request sent to ${store.name}. Once they approve it, log in at growpefy.com/login with the email or number and password you chose.` });
}

export default function Collaborate() {
  const { store } = useLoaderData<typeof loader>();
  const r = useActionData<typeof action>() as Res | undefined;
  const e = r?.errors ?? {};
  const [picked, setPicked] = useState<string[]>(["products", "online_store"]);
  if (r?.ok) {
    return (
      <AuthShell title="Request sent" subtitle="The store owner gets your request in Team & access.">
        <Notice tone="success">{r.ok}</Notice>
        <Link to="/login" className="btn-primary mt-5 w-full justify-center">Go to login</Link>
      </AuthShell>
    );
  }
  return (
    <AuthShell title="Request collaborator access" subtitle="For agencies, designers and developers working on someone else's store. The owner decides what you can see.">
      <Form method="post" className="space-y-4" noValidate>
        {r?.error && <Notice tone="error">{r.error}</Notice>}
        <div className="grid grid-cols-2 gap-3">
          <TextField label="Store ID" name="store" defaultValue={store} error={e.store} placeholder="your-brand" autoComplete="off" />
          <TextField label="Request code" name="code" error={e.code} placeholder="6 digits" inputMode="numeric" autoComplete="off" maxLength={6} />
        </div>
        <TextField label="Your name" name="name" error={e.name} autoComplete="name" />
        <TextField label="Company or agency (optional)" name="company" autoComplete="organization" />
        <TextField label="Email or mobile number" name="login" error={e.login} autoComplete="username" hint="You'll log in with this." />
        <TextField label="Choose a password" name="password" type="password" error={e.password} autoComplete="new-password" hint="At least 8 characters." />
        <fieldset>
          <legend className="label">Access you need</legend>
          <div className="space-y-1.5">
            {ASKABLE.map((p) => (
              <label key={p.id} className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-rule px-3 py-2 text-sm hover:border-rule-strong">
                <input type="checkbox" name="perms" value={p.id} checked={picked.includes(p.id)} onChange={() => setPicked((x) => (x.includes(p.id) ? x.filter((y) => y !== p.id) : [...x, p.id]))} className="mt-0.5 h-4 w-4" />
                <span><b className="font-medium">{p.label}</b><span className="block text-xs text-ink-soft">{p.description}</span></span>
              </label>
            ))}
          </div>
          {e.perms && <p className="error-text mt-1">{e.perms}</p>}
        </fieldset>
        <label className="block"><span className="label">Message to the owner (optional)</span>
          <textarea name="message" rows={3} className="input" placeholder="What you'll work on and for how long." maxLength={500} />
        </label>
        <SubmitButton className="btn-primary w-full justify-center" busyText="Sending">Send request</SubmitButton>
      </Form>
    </AuthShell>
  );
}
