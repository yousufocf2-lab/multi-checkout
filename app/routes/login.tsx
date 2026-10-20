import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { Form, Link, useActionData, useLoaderData, useNavigation, useSearchParams } from "@remix-run/react";
import { useEffect, useState } from "react";
import { BusyOverlay } from "~/components/Brand";
import { AuthShell } from "~/components/AuthShell";
import { ContactInput, OtpStep } from "~/components/OtpAuth";
import { Notice, SubmitButton, TextField } from "~/components/ui";
import { findOwner, getViewer, login, signupOpen, startSession } from "~/lib/auth.server";
import { requireAppHost } from "~/lib/host.server";
import { clientIp } from "~/lib/orders.server";
import { ownerWidget, parseContact, sendOwnerOtp, showContact, verifyOwnerOtp } from "~/lib/owner-otp.server";

export const meta: MetaFunction = () => [{ title: "Log in · Growpefy" }, { name: "robots", content: "noindex" }];

export async function loader({ request }: LoaderFunctionArgs) {
  requireAppHost(request);
  if (await getViewer(request)) throw redirect("/dashboard");
  return json({ signup: signupOpen() });
}

type Data = { stage: "start" | "otp" | "password"; contact: string; shown?: string; resendIn?: number; error?: string; codeError?: string; widget?: { widgetId: string; tokenAuth: string } | null; phone?: string };

export async function action({ request }: ActionFunctionArgs) {
  requireAppHost(request);
  const fd = await request.formData();
  const intent = String(fd.get("intent") ?? "send");
  const next = String(fd.get("next") ?? "/dashboard");

  if (intent === "password") {
    const email = String(fd.get("email") ?? "");
    const who = await login(email, String(fd.get("password") ?? ""));
    if (!who) return json<Data>({ stage: "password", contact: email, error: "That email and password don't match an account." }, { status: 401 });
    return startSession(request, who, next);
  }

  const raw = String(fd.get("contact") ?? "").trim();
  const c = parseContact(raw);
  if (!c) return json<Data>({ stage: "start", contact: raw, error: raw.includes("@") ? "Enter a valid email address" : "Enter a valid 10-digit mobile number" }, { status: 400 });
  const user = await findOwner(c.channel, c.target);

  if (intent === "send") {
    if (!user || !user.active) {
      return json<Data>({ stage: "start", contact: raw, error: `No account found for ${showContact(c)}. Check it, or create an account.` }, { status: 404 });
    }
    const r = await sendOwnerOtp(c, "login", clientIp(request));
    if (!r.ok && !r.resendIn) return json<Data>({ stage: "start", contact: raw, error: r.error }, { status: 400 });
    return json<Data>({ stage: "otp", contact: raw, shown: showContact(c), resendIn: r.resendIn, codeError: r.ok ? undefined : r.error, widget: await ownerWidget(c), phone: c.channel === "phone" ? c.target : undefined });
  }

  const v = await verifyOwnerOtp(c, "login", String(fd.get("code") ?? ""), String(fd.get("token") ?? "") || undefined);
  if (!v.ok || !user || !user.active) return json<Data>({ stage: "otp", contact: raw, shown: showContact(c), codeError: v.ok ? "This account is turned off. Contact Growpefy." : v.error, widget: await ownerWidget(c), phone: c.channel === "phone" ? c.target : undefined }, { status: 400 });
  return startSession(request, { user }, next);
}

export default function Login() {
  const { signup } = useLoaderData<typeof loader>();
  const data = useActionData<typeof action>();
  const [params] = useSearchParams();
  const nav = useNavigation();
  const [stage, setStage] = useState<Data["stage"]>(data?.stage ?? "start");
  const [mode, setMode] = useState<"phone" | "email">(data?.contact?.includes("@") ? "email" : "phone");
  useEffect(() => { if (data?.stage) setStage(data.stage); }, [data]);
  const next = params.get("next") ?? "/dashboard";
  const expired = params.get("expired") === "1" && !data?.error;
  const loggingIn = nav.state !== "idle" && (nav.formData?.get("intent") === "verify" || nav.formData?.get("intent") === "password" || nav.location?.pathname.startsWith("/dashboard"));

  return (
    <>
      {loggingIn && !data?.codeError && <BusyOverlay title="Logging you in" note="Getting your dashboard ready." />}
      <AuthShell
        title={stage === "otp" ? "Enter your code" : "Log in"}
        subtitle={stage === "otp" ? `We sent a 6-digit code to ${data?.shown ?? "you"}.` : "Manage your stores, checkout and orders."}
        footer={signup && stage !== "otp" && <>New here? <Link to="/signup" className="font-medium text-ink underline underline-offset-2">Create an account</Link></>}
      >
        {expired && stage === "start" && <div className="mb-4"><Notice>You were logged out after some time without activity. Please log in again.</Notice></div>}

        {stage === "start" && (
          <Form method="post" className="space-y-4" noValidate>
            <input type="hidden" name="intent" value="send" />
            <input type="hidden" name="next" value={next} />
            {data?.error && <Notice tone="error">{data.error}</Notice>}
            <ContactInput mode={mode} setMode={setMode} defaultValue={data?.contact} />
            <SubmitButton className="btn-primary w-full py-3" busyText="Sending code">Get OTP</SubmitButton>
            <button type="button" onClick={() => setStage("password")} className="w-full text-center text-sm text-ink-soft hover:text-ink">Log in with password instead</button>
          </Form>
        )}

        {stage === "otp" && (
          <OtpStep hidden={{ contact: data?.contact ?? "", next }} error={data?.codeError} resendIn={data?.resendIn} onChange={() => setStage("start")} submitLabel="Log in" widget={data?.widget} phone={data?.phone} />
        )}

        {stage === "password" && (
          <Form method="post" className="space-y-4">
            <input type="hidden" name="intent" value="password" />
            <input type="hidden" name="next" value={next} />
            {data?.error && <Notice tone="error">{data.error}</Notice>}
            <TextField label="Email" name="email" type="text" autoComplete="username" defaultValue={data?.stage === "password" ? data.contact : ""} required autoFocus />
            <TextField label="Password" name="password" type="password" autoComplete="current-password" required />
            <SubmitButton className="btn-primary w-full py-3" busyText="Logging in">Log in</SubmitButton>
            <button type="button" onClick={() => setStage("start")} className="w-full text-center text-sm text-ink-soft hover:text-ink">Log in with OTP instead</button>
          </Form>
        )}
      </AuthShell>
    </>
  );
}
