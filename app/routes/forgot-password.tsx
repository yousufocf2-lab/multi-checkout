import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { Form, Link, useActionData } from "@remix-run/react";
import { useEffect, useState } from "react";
import { AuthShell } from "~/components/AuthShell";
import { ContactInput, OtpStep } from "~/components/OtpAuth";
import { Notice, SubmitButton, TextField } from "~/components/ui";
import { findOwner, getViewer, resetTicket, setPassword, startSession, userFromResetTicket } from "~/lib/auth.server";
import { requireAppHost } from "~/lib/host.server";
import { clientIp } from "~/lib/orders.server";
import { ownerWidget, parseContact, sendOwnerOtp, showContact, verifyOwnerOtp } from "~/lib/owner-otp.server";

export const meta: MetaFunction = () => [{ title: "Reset password · Growpefy" }, { name: "robots", content: "noindex" }];

export async function loader({ request }: LoaderFunctionArgs) {
  requireAppHost(request);
  if (await getViewer(request)) throw redirect("/dashboard");
  return null;
}

type Data = {
  stage: "start" | "otp" | "new";
  contact: string;
  shown?: string;
  resendIn?: number;
  error?: string;
  codeError?: string;
  ticket?: string;
  widget?: { widgetId: string; tokenAuth: string } | null;
  phone?: string;
};

export async function action({ request }: ActionFunctionArgs) {
  requireAppHost(request);
  const fd = await request.formData();
  const intent = String(fd.get("intent") ?? "send");

  if (intent === "save") {
    const ticket = String(fd.get("ticket") ?? "");
    const pw = String(fd.get("password") ?? "");
    const base = { stage: "new" as const, contact: "", ticket };
    if (pw.length < 8) return json<Data>({ ...base, error: "Use at least 8 characters" }, { status: 400 });
    if (!/[A-Za-z]/.test(pw) || !/\d/.test(pw)) return json<Data>({ ...base, error: "Use letters and numbers" }, { status: 400 });
    if (pw !== String(fd.get("confirm") ?? "")) return json<Data>({ ...base, error: "The two passwords don't match" }, { status: 400 });
    const u = await userFromResetTicket(ticket);
    if (!u) return json<Data>({ stage: "start", contact: "", error: "This reset link has expired. Start again." }, { status: 400 });
    await setPassword(u.id, pw);
    return startSession(request, { user: { ...u } }, "/dashboard");
  }

  const raw = String(fd.get("contact") ?? "").trim();
  const c = parseContact(raw);
  if (!c) return json<Data>({ stage: "start", contact: raw, error: raw.includes("@") ? "Enter a valid email address" : "Enter a valid 10-digit mobile number" }, { status: 400 });
  const user = await findOwner(c.channel, c.target);
  const widget = await ownerWidget(c);
  const phone = c.channel === "phone" ? c.target : undefined;

  if (intent === "send") {
    if (!user || !user.active) return json<Data>({ stage: "start", contact: raw, error: `No account found for ${showContact(c)}.` }, { status: 404 });
    const r = await sendOwnerOtp(c, "reset", clientIp(request));
    if (!r.ok && !r.resendIn) return json<Data>({ stage: "start", contact: raw, error: r.error }, { status: 400 });
    return json<Data>({ stage: "otp", contact: raw, shown: showContact(c), resendIn: r.resendIn, codeError: r.ok ? undefined : r.error, widget, phone });
  }

  const v = await verifyOwnerOtp(c, "reset", String(fd.get("code") ?? ""), String(fd.get("token") ?? "") || undefined);
  if (!v.ok || !user || !user.active) return json<Data>({ stage: "otp", contact: raw, shown: showContact(c), codeError: v.ok ? "This account is turned off. Contact Growpefy." : v.error, widget, phone }, { status: 400 });
  return json<Data>({ stage: "new", contact: raw, ticket: resetTicket(user) });
}

export default function ForgotPassword() {
  const data = useActionData<typeof action>();
  const [stage, setStage] = useState<Data["stage"]>(data?.stage ?? "start");
  const [mode, setMode] = useState<"phone" | "email">(data?.contact?.includes("@") ? "email" : "phone");
  useEffect(() => { if (data?.stage) setStage(data.stage); }, [data]);

  return (
    <AuthShell
      title={stage === "otp" ? "Enter your code" : stage === "new" ? "Set a new password" : "Forgot password?"}
      subtitle={stage === "otp" ? `We sent a code to ${data?.shown ?? "you"}.` : stage === "new" ? "Use at least 8 characters with letters and numbers." : "Enter the mobile number or email on your account. We'll send you a code."}
      footer={<>Remembered it? <Link to="/login" className="font-medium text-ink underline underline-offset-2">Log in</Link></>}
    >
      {stage === "start" && (
        <Form method="post" className="space-y-4" noValidate>
          <input type="hidden" name="intent" value="send" />
          {data?.error && <Notice tone="error">{data.error}</Notice>}
          <ContactInput mode={mode} setMode={setMode} defaultValue={data?.contact} />
          <SubmitButton className="btn-primary w-full py-3" busyText="Sending code">Send code</SubmitButton>
        </Form>
      )}
      {stage === "otp" && (
        <OtpStep hidden={{ contact: data?.contact ?? "" }} error={data?.codeError} resendIn={data?.resendIn} onChange={() => setStage("start")} submitLabel="Verify code" widget={data?.widget} phone={data?.phone} />
      )}
      {stage === "new" && (
        <Form method="post" className="space-y-4">
          <input type="hidden" name="intent" value="save" />
          <input type="hidden" name="ticket" value={data?.ticket ?? ""} />
          {data?.error && <Notice tone="error">{data.error}</Notice>}
          <TextField label="New password" name="password" type="password" autoComplete="new-password" minLength={8} required autoFocus />
          <TextField label="Confirm new password" name="confirm" type="password" autoComplete="new-password" minLength={8} required />
          <SubmitButton className="btn-primary w-full py-3" busyText="Saving">Save and log in</SubmitButton>
        </Form>
      )}
    </AuthShell>
  );
}
