// Settings → Customer accounts: what shoppers are asked for when they create an account, and how they log in.
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Form, useActionData, useLoaderData } from "@remix-run/react";
import { useState } from "react";
import { eq } from "drizzle-orm";
import { Card } from "~/components/settings-ui";
import { Notice, SubmitButton } from "~/components/ui";
import { db, stores } from "~/db.server";
import { can, requireStore, requireViewer } from "~/lib/auth.server";
import { channelReady } from "~/lib/customer-account.server";
import { accountSettings, settingsProblem, type AccountSettings, type FieldRule } from "~/lib/customer-accounts";
import { env } from "~/lib/env.server";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const viewer = await requireViewer(request);
  const store = await requireStore(viewer, params.id);
  if (!can(viewer, "settings")) throw new Response("Not allowed", { status: 403 });
  const site = store.storefrontDomain && store.storefrontDomainStatus === "live" ? `https://${store.storefrontDomain}` : `${env.appUrl}/s/${store.slug}`;
  return json({
    settings: accountSettings(store.accountSettings), growpefy: store.platform === "growpefy",
    accountUrl: `${env.appUrl}/s/${store.slug}/account`, site,
    smsReady: await channelReady("phone"), emailReady: await channelReady("email"),
  });
}

const rule = (v: FormDataEntryValue | null): FieldRule => (v === "required" || v === "optional" || v === "hidden" ? v : "hidden");

export async function action({ request, params }: ActionFunctionArgs) {
  const viewer = await requireViewer(request);
  const store = await requireStore(viewer, params.id);
  if (!can(viewer, "settings")) throw new Response("Not allowed", { status: 403 });
  const fd = await request.formData();
  const s: AccountSettings = {
    enabled: fd.get("enabled") === "on",
    name: fd.get("name") === "first" ? "first" : fd.get("name") === "none" ? "none" : "full",
    nameRequired: fd.get("nameRequired") === "on",
    phone: rule(fd.get("phone")), phoneVerify: fd.get("phoneVerify") === "on",
    email: rule(fd.get("email")), emailVerify: fd.get("emailVerify") === "on",
    address: rule(fd.get("address")), addressLine2: fd.get("addressLine2") === "on", landmark: fd.get("landmark") === "on",
  };
  const problem = settingsProblem(s);
  if (problem) return json({ ok: null, error: problem }, { status: 400 });
  await db.update(stores).set({ accountSettings: s }).where(eq(stores.id, store.id));
  return json({ ok: "Saved. Your website uses these settings now.", error: null });
}

export default function CustomerAccounts() {
  const d = useLoaderData<typeof loader>();
  const a = useActionData<typeof action>();
  const [s, setS] = useState<AccountSettings>(d.settings);
  const set = <K extends keyof AccountSettings>(k: K, v: AccountSettings[K]) => setS((x) => ({ ...x, [k]: v }));
  const problem = settingsProblem(s);
  const loginBy = [s.phone === "required" && "mobile number", s.email === "required" && "email"].filter(Boolean).join(" or ");
  const otpOff = (s.phone === "required" && !s.phoneVerify) || (s.email === "required" && !s.emailVerify);

  return (
    <Form method="post" className="mx-auto max-w-[760px] space-y-4">
      {a?.ok && <Notice tone="success">{a.ok}</Notice>}
      {a?.error && <Notice tone="error">{a.error}</Notice>}
      {!d.growpefy && <Notice>Customer accounts are for stores selling on their Growpefy website. Shopify and WooCommerce stores use their own accounts.</Notice>}

      <Card>
        <label className="flex items-start gap-3 pt-4">
          <input type="checkbox" name="enabled" checked={s.enabled} onChange={(e) => set("enabled", e.target.checked)} className="mt-1" />
          <span>
            <span className="block text-[14px] font-semibold">Let shoppers create accounts</span>
            <span className="block text-[13px] text-ink-soft">Adds a profile icon to your website. Shoppers log in to see their orders, where each one is, and notes from you.</span>
          </span>
        </label>
        {s.enabled && <p className="mt-3 break-all rounded-lg bg-[#f6f6f4] px-3 py-2 text-[12.5px] text-ink-soft">Account page: <a href={d.accountUrl} target="_blank" rel="noreferrer" className="font-medium text-ink underline">{d.accountUrl}</a></p>}
      </Card>

      <fieldset disabled={!s.enabled} className="space-y-4 disabled:opacity-50">
        <Card title="Name" description="What to ask for.">
          <Choice name="name" value={s.name} onChange={(v) => set("name", v as AccountSettings["name"])} options={[["full", "First and last name"], ["first", "One name field"], ["none", "Don't ask"]]} />
          {s.name !== "none" && <Check name="nameRequired" checked={s.nameRequired} onChange={(v) => set("nameRequired", v)} label="Required" />}
        </Card>

        <Card title="Mobile number">
          <Choice name="phone" value={s.phone} onChange={(v) => set("phone", v as FieldRule)} options={[["required", "Required"], ["optional", "Optional"], ["hidden", "Don't ask"]]} />
          {s.phone !== "hidden" && <Check name="phoneVerify" checked={s.phoneVerify} onChange={(v) => set("phoneVerify", v)} label="Verify with a code (OTP by SMS)" hint={d.smsReady ? "Shoppers log in with a code. Each SMS is charged from your wallet like checkout OTPs." : "SMS codes aren't set up on Growpefy right now; shoppers would use a password instead."} />}
        </Card>

        <Card title="Email">
          <Choice name="email" value={s.email} onChange={(v) => set("email", v as FieldRule)} options={[["required", "Required"], ["optional", "Optional"], ["hidden", "Don't ask"]]} />
          {s.email !== "hidden" && <Check name="emailVerify" checked={s.emailVerify} onChange={(v) => set("emailVerify", v)} label="Verify with a code (sent by email)" hint={d.emailReady ? "Free." : "Email codes aren't set up on Growpefy right now."} />}
        </Card>

        <Card title="Address" description="Make it optional or turn it off if you sell digital products.">
          <Choice name="address" value={s.address} onChange={(v) => set("address", v as FieldRule)} options={[["required", "Required"], ["optional", "Optional"], ["hidden", "Don't ask"]]} />
          {s.address !== "hidden" && (
            <div className="mt-2 space-y-1.5">
              <p className="text-[12.5px] text-ink-soft">Always asked: house no. / street, city, state, pincode. Also ask for:</p>
              <Check name="addressLine2" checked={s.addressLine2} onChange={(v) => set("addressLine2", v)} label="Apartment, floor" />
              <Check name="landmark" checked={s.landmark} onChange={(v) => set("landmark", v)} label="Landmark" />
            </div>
          )}
        </Card>
      </fieldset>

      <div className={`rounded-xl px-4 py-3 text-[13px] ${problem ? "bg-red-50 text-bad" : "bg-white text-ink-soft ring-1 ring-black/[.06]"}`}>
        {problem ?? <>Shoppers log in with their <b className="text-ink">{loginBy}</b>{otpOff ? " and a password" : " and a one-time code"}. Past orders show up once their mobile or email is verified.</>}
      </div>
      <div className="flex justify-end"><SubmitButton className="btn-primary" busyText="Saving" disabled={Boolean(problem)}>Save</SubmitButton></div>
    </Form>
  );
}

function Choice({ name, value, onChange, options }: { name: string; value: string; onChange: (v: string) => void; options: [string, string][] }) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map(([v, label]) => (
        <label key={v} className={`cursor-pointer rounded-[10px] px-3 py-2 text-[13px] ${value === v ? "font-medium shadow-[0_0_0_2px_#303030]" : "shadow-[0_0_0_1px_rgba(0,0,0,.12)] hover:bg-[#fafafa]"}`}>
          <input type="radio" name={name} value={v} checked={value === v} onChange={() => onChange(v)} className="sr-only" />{label}
        </label>
      ))}
    </div>
  );
}

function Check({ name, checked, onChange, label, hint }: { name: string; checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string }) {
  return (
    <label className="mt-3 flex items-start gap-2 text-[13px]">
      <input type="checkbox" name={name} checked={checked} onChange={(e) => onChange(e.target.checked)} className="mt-0.5" />
      <span><span className="font-medium">{label}</span>{hint && <span className="block text-[12px] text-ink-soft">{hint}</span>}</span>
    </label>
  );
}
