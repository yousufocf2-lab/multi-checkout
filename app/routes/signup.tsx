import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { Form, Link, useActionData } from "@remix-run/react";
import { eq } from "drizzle-orm";
import { AuthShell } from "~/components/AuthShell";
import { Notice, SubmitButton, TextField } from "~/components/ui";
import { db, users } from "~/db.server";
import { adminEmail, createUser, getViewer, signupOpen, startSession } from "~/lib/auth.server";
import { requireAppHost } from "~/lib/host.server";

export const meta: MetaFunction = () => [{ title: "Create account · Multi Checkout" }, { name: "robots", content: "noindex" }];

export async function loader({ request }: LoaderFunctionArgs) {
  requireAppHost(request);
  if (!signupOpen()) throw redirect("/login");
  if (await getViewer(request)) throw redirect("/dashboard");
  return null;
}

export async function action({ request }: ActionFunctionArgs) {
  requireAppHost(request);
  if (!signupOpen()) throw redirect("/login");
  const fd = await request.formData();
  const name = String(fd.get("name") ?? "").trim();
  const email = String(fd.get("email") ?? "").trim().toLowerCase();
  const password = String(fd.get("password") ?? "");
  const errors: Record<string, string> = {};
  if (!name) errors.name = "Enter your name";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email === adminEmail()) errors.email = "Enter a valid email address";
  if (password.length < 8) errors.password = "Use at least 8 characters";
  if (!errors.email) {
    const [u] = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
    if (u) errors.email = "An account with this email already exists. Log in instead.";
  }
  if (Object.keys(errors).length) return json({ errors, name, email }, { status: 400 });
  const user = await createUser({ name, email, password });
  return startSession(request, { user }, "/dashboard/stores/new");
}

export default function Signup() {
  const data = useActionData<typeof action>();
  const e = data?.errors ?? {};
  return (
    <AuthShell title="Create your account" subtitle="Connect your Shopify store and start taking orders on your own checkout."
      footer={<>Already have an account? <Link to="/login" className="font-medium text-ink underline underline-offset-2">Log in</Link></>}>
      <Form method="post" className="space-y-4" noValidate>
        {Object.keys(e).length > 0 && <Notice tone="error">Fix the highlighted fields to continue.</Notice>}
        <TextField label="Your name" name="name" autoComplete="name" defaultValue={data?.name} error={e.name} required autoFocus />
        <TextField label="Work email" name="email" type="email" autoComplete="email" defaultValue={data?.email} error={e.email} required />
        <TextField label="Password" name="password" type="password" autoComplete="new-password" hint="At least 8 characters" error={e.password} required />
        <SubmitButton className="btn-primary w-full py-3" busyText="Creating account">Create account</SubmitButton>
      </Form>
    </AuthShell>
  );
}
