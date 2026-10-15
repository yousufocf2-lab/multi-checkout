import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Form, useActionData, useLoaderData } from "@remix-run/react";
import { asc, eq, sql } from "drizzle-orm";
import { EmptyState, Notice, PageHeader, RowAction, Section, StatusBadge, SubmitButton, TextField } from "~/components/ui";
import { db, stores, users } from "~/db.server";
import { adminEmail, createUser, hashPassword, requireAdmin, signupOpen } from "~/lib/auth.server";

export async function loader({ request }: LoaderFunctionArgs) {
  await requireAdmin(request);
  const rows = await db
    .select({ id: users.id, name: users.name, email: users.email, active: users.active, createdAt: users.createdAt, stores: sql<number>`(select count(*)::int from ${stores} where ${stores.ownerId} = ${users.id})` })
    .from(users)
    .orderBy(asc(users.name));
  return json({ owners: rows, signupOpen: signupOpen() });
}

export async function action({ request }: ActionFunctionArgs) {
  await requireAdmin(request);
  const fd = await request.formData();
  const intent = fd.get("intent");
  const id = Number(fd.get("id"));
  if (intent === "create") {
    const name = String(fd.get("name") ?? "").trim();
    const email = String(fd.get("email") ?? "").trim().toLowerCase();
    const password = String(fd.get("password") ?? "");
    const errors: Record<string, string> = {};
    if (!name) errors.name = "Enter a name";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email === adminEmail()) errors.email = "Enter a valid email";
    if (password.length < 8) errors.password = "Use at least 8 characters";
    if (!errors.email) {
      const [u] = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
      if (u) errors.email = "This email already has an account";
    }
    if (Object.keys(errors).length) return json({ ok: null, errors }, { status: 400 });
    await createUser({ name, email, password });
    return json({ ok: `Account created for ${email}. Share the password with them securely.`, errors: null });
  }
  if (intent === "toggle") {
    const [u] = await db.select().from(users).where(eq(users.id, id));
    if (u) await db.update(users).set({ active: !u.active }).where(eq(users.id, id));
    return json({ ok: u?.active ? "Account paused. They can't log in." : "Account active again.", errors: null });
  }
  if (intent === "reset") {
    const password = String(fd.get("password") ?? "");
    if (password.length < 8) return json({ ok: null, errors: { [`reset${id}`]: "Use at least 8 characters" } }, { status: 400 });
    await db.update(users).set({ passwordHash: await hashPassword(password) }).where(eq(users.id, id));
    return json({ ok: "Password updated", errors: null });
  }
  return json({ ok: null, errors: null });
}

export default function Owners() {
  const { owners, signupOpen } = useLoaderData<typeof loader>();
  const res = useActionData<typeof action>();
  const errors = (res?.errors ?? {}) as Record<string, string>;
  return (
    <>
      <PageHeader title="Store owners" description={signupOpen ? "Owners can also sign up themselves at /signup. Set ALLOW_SIGNUP=false to turn that off." : "Self sign-up is off. Create owner accounts here."} />
      <div className="space-y-5">
        {res?.ok && <Notice tone="success">{res.ok}</Notice>}
        <Section title="Add an owner">
          <Form method="post" className="grid gap-4 sm:grid-cols-[1fr_1fr_1fr_auto] sm:items-start" key={owners.length}>
            <TextField label="Name" name="name" error={errors.name} />
            <TextField label="Email" name="email" type="email" error={errors.email} />
            <TextField label="Temporary password" name="password" type="text" autoComplete="off" error={errors.password} hint="At least 8 characters" />
            <SubmitButton intent="create" className="btn-primary sm:mt-[26px]" busyText="Creating">Create account</SubmitButton>
          </Form>
        </Section>
        {owners.length === 0 ? (
          <EmptyState title="No store owners yet">Owners you add can log in and manage only their own stores.</EmptyState>
        ) : (
          <div className="panel overflow-x-auto">
            <table className="table min-w-[720px]">
              <thead><tr><th>Owner</th><th className="text-right">Stores</th><th>Status</th><th>Set new password</th><th /></tr></thead>
              <tbody>
                {owners.map((o) => (
                  <tr key={o.id}>
                    <td><p className="font-medium">{o.name}</p><p className="text-xs text-ink-faint">{o.email}</p></td>
                    <td className="num text-right">{o.stores}</td>
                    <td><StatusBadge status={o.active ? "live" : "off"} label={o.active ? "Active" : "Paused"} /></td>
                    <td>
                      <Form method="post" className="flex gap-2">
                        <input type="hidden" name="id" value={o.id} />
                        <input name="password" placeholder="New password" className="input w-40 py-1.5 text-sm" autoComplete="off" />
                        <SubmitButton intent="reset" className="btn-secondary px-3 py-1.5" busyText="Saving">Save</SubmitButton>
                      </Form>
                      {errors[`reset${o.id}`] && <span className="error-text">{errors[`reset${o.id}`]}</span>}
                    </td>
                    <td><div className="flex justify-end"><RowAction intent="toggle" id={o.id} label={o.active ? "Pause" : "Activate"} /></div></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
