import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { Form, Link, useActionData, useLoaderData, useNavigation, useSearchParams } from "@remix-run/react";
import { BusyOverlay } from "~/components/Brand";
import { AuthShell } from "~/components/AuthShell";
import { Notice, SubmitButton, TextField } from "~/components/ui";
import { getViewer, login, signupOpen, startSession } from "~/lib/auth.server";
import { requireAppHost } from "~/lib/host.server";

export const meta: MetaFunction = () => [{ title: "Log in · Growpefy" }, { name: "robots", content: "noindex" }];

export async function loader({ request }: LoaderFunctionArgs) {
  requireAppHost(request);
  if (await getViewer(request)) throw redirect("/dashboard");
  return json({ signup: signupOpen() });
}

export async function action({ request }: ActionFunctionArgs) {
  requireAppHost(request);
  const fd = await request.formData();
  const email = String(fd.get("email") ?? "");
  const who = await login(email, String(fd.get("password") ?? ""));
  if (!who) return json({ error: "That email and password don't match an account.", email }, { status: 401 });
  return startSession(request, who, String(fd.get("next") ?? "/dashboard"));
}

export default function Login() {
  const { signup } = useLoaderData<typeof loader>();
  const data = useActionData<typeof action>();
  const [params] = useSearchParams();
  const nav = useNavigation();
  const loggingIn = nav.state !== "idle" && (nav.formAction?.startsWith("/login") || nav.location?.pathname.startsWith("/dashboard"));
  const expired = params.get("expired") === "1" && !data?.error;
  return (
    <>
    {loggingIn && <BusyOverlay title="Logging you in" note="Getting your dashboard ready." />}
    <AuthShell title="Log in" subtitle="Manage your stores, discounts and orders."
      footer={signup && <>New here? <Link to="/signup" className="font-medium text-ink underline underline-offset-2">Create an account</Link></>}>
      <Form method="post" className="space-y-4">
        <input type="hidden" name="next" value={params.get("next") ?? "/dashboard"} />
        {expired && <Notice>You were logged out after 10 minutes of inactivity. Please log in again.</Notice>}
        {data?.error && <Notice tone="error">{data.error}</Notice>}
        <TextField label="Email" name="email" type="text" autoComplete="username" defaultValue={data?.email} required autoFocus />
        <TextField label="Password" name="password" type="password" autoComplete="current-password" required />
        <SubmitButton className="btn-primary w-full py-3" busyText="Logging in">Log in</SubmitButton>
      </Form>
    </AuthShell>
    </>
  );
}
