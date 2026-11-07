import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { Form, Link, useActionData, useLoaderData, useNavigation, useSearchParams } from "@remix-run/react";
import { BusyOverlay } from "~/components/Brand";
import { AuthShell } from "~/components/AuthShell";
import { Notice, PasswordInput, SubmitButton, TextField } from "~/components/ui";
import { SocialLogin } from "~/components/SocialLogin";
import { socialProviders } from "~/lib/social-login.server";
import { getViewer, login, signupOpen, startSession } from "~/lib/auth.server";
import { requireAppHost } from "~/lib/host.server";

export const meta: MetaFunction = () => [{ title: "Log in · Growpefy" }, { name: "robots", content: "noindex" }];

export async function loader({ request }: LoaderFunctionArgs) {
  requireAppHost(request);
  if (await getViewer(request)) throw redirect("/dashboard");
  return json({ signup: signupOpen(), social: socialProviders(), oauthError: new URL(request.url).searchParams.get("oauth_error") });
}

export async function action({ request }: ActionFunctionArgs) {
  requireAppHost(request);
  const fd = await request.formData();
  const next = String(fd.get("next") ?? "/dashboard");
  const email = String(fd.get("email") ?? "").trim();
  const password = String(fd.get("password") ?? "");
  if (!email || !password) return json({ email, error: "Enter your email and password." }, { status: 400 });
  const who = await login(email, password);
  if (!who) return json({ email, error: "That email and password don't match an account." }, { status: 401 });
  return startSession(request, who, next);
}

export default function Login() {
  const { signup, social, oauthError } = useLoaderData<typeof loader>();
  const data = useActionData<typeof action>();
  const [params] = useSearchParams();
  const nav = useNavigation();
  const next = params.get("next") ?? "/dashboard";
  const notice = data?.error ? null
    : params.get("closed") === "1" ? "You were logged out because the dashboard tabs were closed. Please log in again."
    : params.get("expired") === "1" ? "Your login has ended. Please log in again."
    : null;
  const loggingIn = nav.state !== "idle" && (nav.formData?.get("password") != null || nav.location?.pathname.startsWith("/dashboard"));

  return (
    <>
      {loggingIn && !data?.error && <BusyOverlay title="Logging you in" note="Getting your dashboard ready." />}
      <AuthShell
        title="Welcome back"
        subtitle="Log in to manage your stores, checkout and orders."
        footer={<>
          {signup && <>New to Growpefy? <Link to="/signup" className="font-semibold text-ink underline-offset-2 hover:underline">Create an account</Link><br /></>}
          Working on someone's store? <Link to="/collaborate" className="font-medium text-ink underline-offset-2 hover:underline">Request collaborator access</Link>
        </>}
      >
        {notice && <div className="mb-4"><Notice>{notice}</Notice></div>}
        <SocialLogin google={social.google} next={next} error={oauthError} />
        <Form method="post" className="space-y-4">
          <input type="hidden" name="next" value={next} />
          {data?.error && <Notice tone="error">{data.error}</Notice>}
          <TextField label="Email" name="email" type="text" inputMode="email" autoComplete="username" placeholder="you@yourbrand.com" defaultValue={data?.email ?? ""} required autoFocus />
          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <label htmlFor="login-password" className="text-[13px] font-medium">Password</label>
              <Link to="/forgot-password" className="text-[12.5px] font-medium text-ink-soft underline-offset-2 hover:text-ink hover:underline">Forgot password?</Link>
            </div>
            <PasswordField />
          </div>
          <SubmitButton className="btn-primary w-full py-3" busyText="Logging in">Log in</SubmitButton>
        </Form>
      </AuthShell>
    </>
  );
}

/** Password box with show / hide (its label sits in the row above, next to "Forgot password?"). */
function PasswordField() {
  return <PasswordInput name="password" id="login-password" autoComplete="current-password" placeholder="Your password" required />;
}
