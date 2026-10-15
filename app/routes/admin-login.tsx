import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { env } from "~/lib/env.server";
import { isAppHost, sameUrlOn } from "~/lib/urls.server";
import { Form, useActionData } from "@remix-run/react";
import { checkPassword, loginRedirect } from "~/lib/auth.server";

export const meta: MetaFunction = () => [{ title: "Admin login" }, { name: "robots", content: "noindex" }];

export function loader({ request }: LoaderFunctionArgs) {
  if (!isAppHost(request)) throw redirect(sameUrlOn(env.appUrl, request));
  return null;
}

export async function action({ request }: ActionFunctionArgs) {
  if (!isAppHost(request)) throw redirect(sameUrlOn(env.appUrl, request));
  const fd = await request.formData();
  if (!checkPassword(String(fd.get("password") ?? ""))) return json({ error: "Galat password" }, { status: 401 });
  return loginRedirect(request);
}

export default function AdminLogin() {
  const data = useActionData<typeof action>();
  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-4">
      <Form method="post" className="card space-y-4">
        <h1 className="text-lg font-bold">Checkout admin</h1>
        <input name="password" type="password" className="input" placeholder="Password" autoFocus required />
        {data?.error && <p className="text-sm text-red-600">{data.error}</p>}
        <button className="btn-primary w-full py-3">Login</button>
      </Form>
    </main>
  );
}
