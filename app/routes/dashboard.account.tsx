// A team login's own account: who they are, what they can access, and changing their password.
import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Form, useActionData, useLoaderData } from "@remix-run/react";
import { eq } from "drizzle-orm";
import { Notice, PageHeader, Section, SubmitButton, TextField } from "~/components/ui";
import { db, teamMembers } from "~/db.server";
import { hashPassword, requireViewer, verifyMemberPassword } from "~/lib/auth.server";
import { permsFor } from "~/lib/team";

export const meta: MetaFunction = () => [{ title: "My account · Growpefy" }];

function memberOf(v: Awaited<ReturnType<typeof requireViewer>>) {
  return v.role === "admin" ? (v.staff ? { id: v.staff.id, name: v.staff.name, perms: v.staff.perms, scope: "platform" as const } : null)
    : v.member ? { id: v.member.id, name: v.member.name, perms: v.member.perms, scope: "owner" as const } : null;
}

export async function loader({ request }: LoaderFunctionArgs) {
  const v = await requireViewer(request);
  const m = memberOf(v);
  if (!m) throw new Response("Not found", { status: 404 });
  return json({ name: m.name, login: v.email, team: v.role === "admin" ? "Growpefy" : v.name, access: permsFor(m.scope).filter((p) => m.perms.includes(p.id)).map((p) => p.label) });
}

export async function action({ request }: ActionFunctionArgs) {
  const v = await requireViewer(request);
  const m = memberOf(v);
  if (!m) throw new Response("Not found", { status: 404 });
  const fd = await request.formData();
  const current = String(fd.get("current") ?? "");
  const next = String(fd.get("password") ?? "");
  if (!(await verifyMemberPassword(m.id, current))) return json({ ok: null, errors: { current: "That's not your current password" } }, { status: 400 });
  if (next.length < 8) return json({ ok: null, errors: { password: "Use at least 8 characters" } }, { status: 400 });
  if (next !== String(fd.get("confirm") ?? "")) return json({ ok: null, errors: { confirm: "Passwords don't match" } }, { status: 400 });
  await db.update(teamMembers).set({ passwordHash: await hashPassword(next) }).where(eq(teamMembers.id, m.id));
  return json({ ok: "Password changed", errors: null });
}

export default function Account() {
  const d = useLoaderData<typeof loader>();
  const r = useActionData<typeof action>();
  const e = (r?.errors ?? {}) as Record<string, string>;
  return (
    <div className="max-w-2xl">
      <PageHeader title="My account" description={`${d.name} · ${d.login} · ${d.team} team`} />
      <div className="space-y-5">
        <Section title="Your access" description="Ask your admin if you need more.">
          <div className="flex flex-wrap gap-1.5">{d.access.map((a) => <span key={a} className="rounded-md bg-pine-tint px-2 py-0.5 text-xs font-medium text-pine">{a}</span>)}</div>
        </Section>
        <Section title="Change password">
          {r?.ok && <div className="mb-4"><Notice tone="success">{r.ok}</Notice></div>}
          <Form method="post" className="grid gap-4 sm:grid-cols-3" key={r?.ok ? "done" : "form"}>
            <TextField label="Current password" name="current" type="password" autoComplete="current-password" error={e.current} />
            <TextField label="New password" name="password" type="password" autoComplete="new-password" error={e.password} hint="At least 8 characters" />
            <TextField label="Repeat new password" name="confirm" type="password" autoComplete="new-password" error={e.confirm} />
            <div className="sm:col-span-3"><SubmitButton busyText="Saving">Change password</SubmitButton></div>
          </Form>
        </Section>
      </div>
    </div>
  );
}
