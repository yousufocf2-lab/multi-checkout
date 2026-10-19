import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { Form, Link, useActionData, useNavigation } from "@remix-run/react";
import { useEffect, useState } from "react";
import { BusyOverlay } from "~/components/Brand";
import { AuthShell } from "~/components/AuthShell";
import { ContactInput, OtpStep } from "~/components/OtpAuth";
import { Notice, SubmitButton, TextField } from "~/components/ui";
import { adminEmail, createOwner, findOwner, getViewer, signupOpen, startSession } from "~/lib/auth.server";
import { requireAppHost } from "~/lib/host.server";
import { clientIp } from "~/lib/orders.server";
import { parseContact, sendOwnerOtp, showContact, verifyOwnerOtp } from "~/lib/owner-otp.server";

export const meta: MetaFunction = () => [{ title: "Create account · Growpefy" }, { name: "robots", content: "noindex" }];

export async function loader({ request }: LoaderFunctionArgs) {
  requireAppHost(request);
  if (!signupOpen()) throw redirect("/login");
  if (await getViewer(request)) throw redirect("/dashboard");
  return null;
}

type Data = {
  stage: "start" | "otp";
  contact: string;
  brand: string;
  shown?: string;
  resendIn?: number;
  errors?: { contact?: string; brand?: string; code?: string; form?: string };
  sent?: boolean;
};

export async function action({ request }: ActionFunctionArgs) {
  requireAppHost(request);
  if (!signupOpen()) throw redirect("/login");
  const fd = await request.formData();
  const intent = String(fd.get("intent") ?? "send");
  const rawContact = String(fd.get("contact") ?? "").trim();
  const brand = String(fd.get("brand") ?? "").trim().slice(0, 120);
  const c = parseContact(rawContact);
  const base: Data = { stage: "start", contact: rawContact, brand };

  const errors: Data["errors"] = {};
  if (brand.length < 2) errors.brand = "Enter your brand name";
  if (!c) errors.contact = rawContact.includes("@") ? "Enter a valid email address" : "Enter a valid 10-digit mobile number";
  else if (c.channel === "email" && c.target === adminEmail()) errors.contact = "Use a different email";
  else if (await findOwner(c.channel, c.target)) errors.contact = `An account with this ${c.channel === "phone" ? "number" : "email"} already exists. Log in instead.`;
  if (Object.keys(errors).length || !c) return json<Data>({ ...base, errors }, { status: 400 });

  if (intent === "send") {
    const r = await sendOwnerOtp(c, "signup", clientIp(request));
    if (!r.ok && !r.resendIn) return json<Data>({ ...base, errors: { contact: r.error } }, { status: 400 });
    return json<Data>({ ...base, stage: "otp", shown: showContact(c), resendIn: r.resendIn, sent: r.ok, errors: r.ok ? {} : { code: r.error } });
  }

  // verify
  const v = await verifyOwnerOtp(c, "signup", String(fd.get("code") ?? ""));
  if (!v.ok) return json<Data>({ ...base, stage: "otp", shown: showContact(c), errors: { code: v.error } }, { status: 400 });
  const user = await createOwner({ brandName: brand, channel: c.channel, target: c.target });
  return startSession(request, { user }, "/onboarding");
}

export default function Signup() {
  const data = useActionData<typeof action>();
  const nav = useNavigation();
  const e = data?.errors ?? {};
  const [mode, setMode] = useState<"phone" | "email">(data?.contact?.includes("@") ? "email" : "phone");
  const [stage, setStage] = useState<"start" | "otp">(data?.stage ?? "start");
  useEffect(() => { if (data?.stage) setStage(data.stage); }, [data]);
  const verifying = nav.state !== "idle" && nav.formData?.get("intent") === "verify";

  return (
    <>
      {verifying && !e.code && <BusyOverlay title="Creating your account" note="Next, a few business details." />}
      <AuthShell
        title={stage === "otp" ? "Verify it's you" : "Start selling with Growpefy"}
        subtitle={stage === "otp" ? `We sent a 6-digit code to ${data?.shown ?? "you"}.` : "Your own checkout, RTO protection and ads in one place. Takes a minute."}
        footer={<>Already have an account? <Link to="/login" className="font-medium text-ink underline underline-offset-2">Log in</Link></>}
      >
        {stage === "start" ? (
          <Form method="post" className="space-y-4" noValidate>
            <input type="hidden" name="intent" value="send" />
            {e.form && <Notice tone="error">{e.form}</Notice>}
            <TextField label="Brand name" name="brand" placeholder="e.g. Fusion Prime" autoComplete="organization" defaultValue={data?.brand} error={e.brand} required autoFocus />
            <ContactInput mode={mode} setMode={setMode} defaultValue={data?.contact} error={e.contact} />
            <SubmitButton className="btn-primary w-full py-3" busyText="Sending code">Get OTP</SubmitButton>
            <p className="text-center text-xs text-ink-faint">By continuing you agree to our <Link to="/terms" className="underline">Terms</Link> and <Link to="/privacy" className="underline">Privacy policy</Link>.</p>
          </Form>
        ) : (
          <OtpStep
            hidden={{ contact: data?.contact ?? "", brand: data?.brand ?? "" }}
            error={e.code}
            resendIn={data?.resendIn}
            onChange={() => setStage("start")}
            submitLabel="Verify and create account"
          />
        )}
      </AuthShell>
    </>
  );
}
