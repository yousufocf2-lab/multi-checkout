// Team: the super admin adds Growpefy staff, a store owner adds employees. Each login sees only what its permissions allow.
import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Form, useActionData, useLoaderData, useNavigation } from "@remix-run/react";
import { and, asc, eq } from "drizzle-orm";
import { useEffect, useState } from "react";
import { Icon } from "~/components/Icons";
import { Notice, PageHeader, SubmitButton, TextField } from "~/components/ui";
import { db, stores, teamMembers } from "~/db.server";
import { hashPassword, isPrincipal, loginTaken, requireViewer, teamLogin, type Viewer } from "~/lib/auth.server";
import { cleanPerms, permsFor, roleLabel, rolesFor, type Scope } from "~/lib/team";

export const meta: MetaFunction = () => [{ title: "Team · Growpefy" }];

function scopeOf(v: Viewer): { scope: Scope; ownerId: number | null; selfId: number | null } {
  if (v.role === "admin") return { scope: "platform", ownerId: null, selfId: v.staff?.id ?? null };
  return { scope: "owner", ownerId: v.userId, selfId: v.member?.id ?? null };
}

const mine = (scope: Scope, ownerId: number | null) =>
  scope === "platform" ? eq(teamMembers.scope, "platform") : and(eq(teamMembers.scope, "owner"), eq(teamMembers.ownerId, ownerId!));

export async function loader({ request }: LoaderFunctionArgs) {
  const v = await requireViewer(request); // the "team" permission is checked for team logins
  const { scope, ownerId, selfId } = scopeOf(v);
  const [list, storeList] = await Promise.all([
    db.select().from(teamMembers).where(mine(scope, ownerId)).orderBy(asc(teamMembers.name)),
    scope === "owner" ? db.select({ id: stores.id, name: stores.name }).from(stores).where(eq(stores.ownerId, ownerId!)).orderBy(asc(stores.name)) : Promise.resolve([] as { id: number; name: string }[]),
  ]);
  return json({
    scope, selfId, principal: isPrincipal(v),
    myPerms: v.role === "admin" ? v.staff?.perms ?? null : v.member?.perms ?? null,
    stores: storeList,
    members: list.map((m) => ({
      id: m.id, name: m.name, login: m.login, role: m.role, perms: m.perms, storeIds: m.storeIds, active: m.active,
      lastLoginAt: m.lastLoginAt?.toISOString() ?? null, createdAt: m.createdAt.toISOString(),
    })),
  });
}

type Res = { ok?: string; error?: string; errors?: Record<string, string>; created?: { login: string; password: string } };

export async function action({ request }: ActionFunctionArgs) {
  const v = await requireViewer(request);
  const { scope, ownerId, selfId } = scopeOf(v);
  const fd = await request.formData();
  const intent = String(fd.get("intent") ?? "");
  const id = Number(fd.get("id"));
  const s = (k: string) => String(fd.get(k) ?? "").trim();

  // Only the super admin / store owner can hand out "Manage team"
  const permsIn = () => {
    const p = cleanPerms(scope, fd.getAll("perms").map(String));
    if (isPrincipal(v)) return p;
    // A team member who manages the team can only give access they have themselves
    const own = (v.role === "admin" ? v.staff?.perms : v.member?.perms) ?? [];
    return p.filter((x) => x !== "team" && own.includes(x));
  };
  const storesIn = async () => {
    if (scope !== "owner" || s("storeAccess") !== "some") return null;
    const own = await db.select({ id: stores.id }).from(stores).where(eq(stores.ownerId, ownerId!));
    return fd.getAll("stores").map(Number).filter((n) => own.some((o) => o.id === n));
  };
  const load = async () => {
    const [m] = await db.select().from(teamMembers).where(and(eq(teamMembers.id, id), mine(scope, ownerId))).limit(1);
    return m ?? null;
  };

  if (intent === "create") {
    const errors: Record<string, string> = {};
    const name = s("name").slice(0, 80);
    const key = teamLogin(s("login"));
    const password = String(fd.get("password") ?? "");
    const perms = permsIn();
    const storeIds = await storesIn();
    if (name.length < 2) errors.name = "Enter their name";
    if (!key) errors.login = "Enter a valid email or 10-digit mobile number";
    else if (await loginTaken(key)) errors.login = "This email or number already has a Growpefy login";
    if (password.length < 8) errors.password = "Use at least 8 characters";
    if (!perms.length) errors.perms = "Give at least one permission";
    if (storeIds && !storeIds.length) errors.stores = "Pick at least one store";
    if (Object.keys(errors).length) return json<Res>({ errors }, { status: 400 });
    await db.insert(teamMembers).values({
      scope, ownerId, name, login: key!, passwordHash: await hashPassword(password),
      role: s("role") || "custom", perms, storeIds, createdBy: v.role === "admin" ? v.staff?.name ?? "Super admin" : v.member?.name ?? v.name,
    });
    return json<Res>({ ok: `${name} can now log in.`, created: { login: key!.includes("@") ? key! : `+91 ${key}`, password } });
  }

  const m = await load();
  if (!m) return json<Res>({ error: "Team member not found" }, { status: 404 });
  if (m.id === selfId) return json<Res>({ error: "You can't change your own access. Ask the account owner." }, { status: 400 });
  if (!isPrincipal(v) && m.perms.includes("team")) return json<Res>({ error: "Only the account owner can change someone who manages the team." }, { status: 403 });

  if (intent === "update") {
    const perms = permsIn();
    const storeIds = await storesIn();
    if (!perms.length) return json<Res>({ errors: { [`perms${m.id}`]: "Give at least one permission" } }, { status: 400 });
    if (storeIds && !storeIds.length) return json<Res>({ errors: { [`stores${m.id}`]: "Pick at least one store" } }, { status: 400 });
    await db.update(teamMembers).set({ name: s("name").slice(0, 80) || m.name, role: s("role") || "custom", perms, storeIds }).where(eq(teamMembers.id, m.id));
    return json<Res>({ ok: `Saved ${m.name}'s access. It applies on their next page load.` });
  }
  if (intent === "toggle") {
    await db.update(teamMembers).set({ active: !m.active }).where(eq(teamMembers.id, m.id));
    return json<Res>({ ok: m.active ? `${m.name} is paused and can't log in.` : `${m.name} can log in again.` });
  }
  if (intent === "reset") {
    const password = String(fd.get("password") ?? "");
    if (password.length < 8) return json<Res>({ errors: { [`pw${m.id}`]: "Use at least 8 characters" } }, { status: 400 });
    await db.update(teamMembers).set({ passwordHash: await hashPassword(password) }).where(eq(teamMembers.id, m.id));
    return json<Res>({ ok: `New password set for ${m.name}.`, created: { login: m.login.includes("@") ? m.login : `+91 ${m.login}`, password } });
  }
  if (intent === "delete") {
    await db.delete(teamMembers).where(eq(teamMembers.id, m.id));
    return json<Res>({ ok: `${m.name} was removed.` });
  }
  return json<Res>({ error: "Unknown action" }, { status: 400 });
}

const strongPassword = () => {
  const a = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789";
  return Array.from(globalThis.crypto.getRandomValues(new Uint32Array(10)), (n) => a[n % a.length]).join("");
};
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) : "Never");

export default function Team() {
  const d = useLoaderData<typeof loader>();
  const r = useActionData<typeof action>() as Res | undefined;
  const nav = useNavigation();
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<number | null>(null);
  useEffect(() => { if (nav.state === "idle" && r?.ok) { setAdding(false); setEditing(null); } }, [nav.state, r]);
  const perms = permsFor(d.scope);
  const owner = d.scope === "owner";

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader title="Team"
        description={owner ? "Give your employees their own login. Each one sees only the pages you allow." : "Add Growpefy team members. Each one sees only the parts of the admin panel you allow."}
        actions={!adding && <button type="button" onClick={() => setAdding(true)} className="btn-primary"><Icon name="plus" className="h-4 w-4" />Add team member</button>} />

      <div className="space-y-4">
        {r?.ok && <Notice tone="success">{r.ok}</Notice>}
        {r?.error && <Notice tone="error">{r.error}</Notice>}
        {r?.created && (
          <div className="panel border-pine/30 bg-pine-tint/30 p-4 text-sm">
            <p className="font-semibold">Share these login details privately</p>
            <p className="mt-1 text-ink-soft">They log in at <b className="text-ink">growpefy.com/login</b> with “Log in with password”, then change the password from <b className="text-ink">My account</b>.</p>
            <p className="num mt-2 rounded-lg bg-surface px-3 py-2 font-mono text-[13px]">Login: {r.created.login}<br />Password: {r.created.password}</p>
          </div>
        )}

        {adding && (
          <section className="panel p-5">
            <h2 className="text-sm font-semibold">New team member</h2>
            <MemberForm scope={d.scope} stores={d.stores} principal={d.principal} myPerms={d.myPerms} errors={r?.errors} intent="create" onCancel={() => setAdding(false)} />
          </section>
        )}

        {d.members.length === 0 && !adding ? (
          <div className="panel px-6 py-12 text-center">
            <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-pine-tint text-pine"><Icon name="users" className="h-6 w-6" /></span>
            <h2 className="mt-3 font-semibold">No team members yet</h2>
            <p className="mx-auto mt-1 max-w-sm text-sm text-ink-soft">{owner ? "Add someone who handles orders, WhatsApp or ads. They get their own login and see only what you allow." : "Add someone from sales or support. For example, a caller who only needs Leads."}</p>
          </div>
        ) : (
          <ul className="space-y-3">
            {d.members.map((m) => (
              <li key={m.id} className="panel p-4">
                <div className="flex flex-wrap items-start gap-3">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-emerald-400 to-sky-500 font-semibold text-white">{m.name.slice(0, 1).toUpperCase()}</span>
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-2 font-semibold">
                      {m.name}
                      <span className="rounded-full bg-paper-sunk px-2 py-0.5 text-[11px] font-medium text-ink-soft">{roleLabel(d.scope, m.role)}</span>
                      {!m.active && <span className="rounded-full bg-red-50 px-2 py-0.5 text-[11px] font-medium text-bad">Paused</span>}
                      {m.id === d.selfId && <span className="rounded-full bg-sky-50 px-2 py-0.5 text-[11px] font-medium text-sky-800">You</span>}
                    </p>
                    <p className="text-xs text-ink-soft">{m.login.includes("@") ? m.login : `+91 ${m.login}`} · Last login {when(m.lastLoginAt)}</p>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {perms.filter((p) => m.perms.includes(p.id)).map((p) => <span key={p.id} className="rounded-md bg-pine-tint px-2 py-0.5 text-[11px] font-medium text-pine">{p.label}</span>)}
                      {owner && <span className="rounded-md bg-paper-sunk px-2 py-0.5 text-[11px] font-medium text-ink-soft">{m.storeIds ? d.stores.filter((s) => m.storeIds!.includes(s.id)).map((s) => s.name).join(", ") || "No stores" : "All stores"}</span>}
                    </div>
                  </div>
                  {m.id !== d.selfId && (
                    <div className="flex flex-wrap gap-1.5">
                      <button type="button" onClick={() => setEditing(editing === m.id ? null : m.id)} className="btn-secondary px-3 py-1.5 text-xs">{editing === m.id ? "Close" : "Edit"}</button>
                      <Form method="post"><input type="hidden" name="id" value={m.id} /><SubmitButton intent="toggle" className="btn-secondary px-3 py-1.5 text-xs" busyText="…">{m.active ? "Pause" : "Activate"}</SubmitButton></Form>
                    </div>
                  )}
                </div>
                {editing === m.id && (
                  <div className="mt-4 space-y-4 border-t border-rule pt-4">
                    <MemberForm scope={d.scope} stores={d.stores} principal={d.principal} myPerms={d.myPerms} errors={r?.errors} intent="update" member={m} onCancel={() => setEditing(null)} />
                    <div className="grid gap-3 border-t border-rule pt-4 sm:grid-cols-2">
                      <ResetPassword id={m.id} error={r?.errors?.[`pw${m.id}`]} />
                      <Form method="post" className="flex items-end justify-end" onSubmit={(e) => { if (!confirm(`Remove ${m.name}? They won't be able to log in.`)) e.preventDefault(); }}>
                        <input type="hidden" name="id" value={m.id} />
                        <SubmitButton intent="delete" className="btn-secondary px-3 py-2 text-xs text-bad" busyText="Removing"><Icon name="trash" className="h-3.5 w-3.5" />Remove from team</SubmitButton>
                      </Form>
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

type M = { id: number; name: string; role: string; perms: string[]; storeIds: number[] | null };

function MemberForm({ scope, stores, principal, myPerms, errors = {}, intent, member, onCancel }: {
  scope: Scope; stores: { id: number; name: string }[]; principal: boolean; myPerms: string[] | null; errors?: Record<string, string>; intent: "create" | "update"; member?: M; onCancel: () => void;
}) {
  const roles = rolesFor(scope);
  const all = permsFor(scope).filter((p) => principal || (p.id !== "team" && (myPerms ?? []).includes(p.id)));
  const [role, setRole] = useState(member?.role ?? roles[0].id);
  const [picked, setPicked] = useState<string[]>(member?.perms ?? roles[0].perms);
  const [access, setAccess] = useState<"all" | "some">(member?.storeIds ? "some" : "all");
  const [pw, setPw] = useState("");
  const k = member ? String(member.id) : "";
  const choose = (id: string) => { setRole(id); const r = roles.find((x) => x.id === id); if (r) setPicked(r.perms.filter((p) => all.some((a) => a.id === p))); };
  const flip = (id: string) => { setRole("custom"); setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id])); };

  return (
    <Form method="post" className="mt-3 space-y-4">
      {member && <input type="hidden" name="id" value={member.id} />}
      <input type="hidden" name="role" value={role} />
      <div className="grid gap-3 sm:grid-cols-2">
        <TextField label="Name" name="name" defaultValue={member?.name} error={errors.name} placeholder="e.g. Riya Sharma" required />
        {!member && <TextField label="Email or mobile number" name="login" error={errors.login} placeholder="riya@brand.com or 98xxxxxxxx" autoComplete="off" required />}
        {!member && (
          <div className="sm:col-span-2">
            <TextField label="Temporary password" name="password" type="text" autoComplete="off" error={errors.password} value={pw} onChange={(e) => setPw(e.target.value)}
              hint={<button type="button" className="font-medium text-pine hover:underline" onClick={() => setPw(strongPassword())}>Make a strong password</button>} />
          </div>
        )}
      </div>

      <div>
        <p className="label">Role</p>
        <div className="flex flex-wrap gap-1.5">
          {roles.map((r) => (
            <button key={r.id} type="button" onClick={() => choose(r.id)} aria-pressed={role === r.id}
              className={`rounded-full border px-3 py-1 text-xs font-medium ${role === r.id ? "border-ink bg-ink text-white" : "border-rule-strong text-ink-soft hover:border-ink"}`}>{r.label}</button>
          ))}
          <span className={`rounded-full border px-3 py-1 text-xs font-medium ${role === "custom" ? "border-ink bg-ink text-white" : "border-dashed border-rule-strong text-ink-faint"}`}>Custom</span>
        </div>
      </div>

      <fieldset>
        <legend className="label">What they can see and do</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {all.map((p) => (
            <label key={p.id} className={`flex cursor-pointer gap-2.5 rounded-lg border p-2.5 transition ${picked.includes(p.id) ? "border-pine bg-pine-tint/30" : "border-rule hover:border-rule-strong"}`}>
              <input type="checkbox" name="perms" value={p.id} checked={picked.includes(p.id)} onChange={() => flip(p.id)} className="mt-0.5 h-4 w-4 accent-[#0B5D4B]" />
              <span><span className="block text-sm font-medium">{p.label}</span><span className="block text-xs text-ink-soft">{p.description}</span></span>
            </label>
          ))}
        </div>
        {(errors.perms || errors[`perms${k}`]) && <p className="error-text mt-1">{errors.perms || errors[`perms${k}`]}</p>}
      </fieldset>

      {scope === "owner" && stores.length > 1 && (
        <fieldset>
          <legend className="label">Stores</legend>
          <div className="flex gap-1.5">
            {([["all", "All my stores"], ["some", "Only some stores"]] as const).map(([id, l]) => (
              <label key={id} className={`cursor-pointer rounded-full border px-3 py-1 text-xs font-medium ${access === id ? "border-ink bg-ink text-white" : "border-rule-strong text-ink-soft"}`}>
                <input type="radio" name="storeAccess" value={id} checked={access === id} onChange={() => setAccess(id)} className="sr-only" />{l}
              </label>
            ))}
          </div>
          {access === "some" && (
            <div className="mt-2 flex flex-wrap gap-3">
              {stores.map((s) => (
                <label key={s.id} className="flex items-center gap-2 text-sm"><input type="checkbox" name="stores" value={s.id} defaultChecked={member?.storeIds?.includes(s.id)} className="h-4 w-4 accent-[#0B5D4B]" />{s.name}</label>
              ))}
            </div>
          )}
          {(errors.stores || errors[`stores${k}`]) && <p className="error-text mt-1">{errors.stores || errors[`stores${k}`]}</p>}
        </fieldset>
      )}

      <div className="flex gap-2">
        <SubmitButton intent={intent} className="btn-primary" busyText="Saving">{member ? "Save access" : "Create login"}</SubmitButton>
        <button type="button" onClick={onCancel} className="btn-secondary">Cancel</button>
      </div>
    </Form>
  );
}

function ResetPassword({ id, error }: { id: number; error?: string }) {
  const [pw, setPw] = useState("");
  return (
    <Form method="post" className="flex items-end gap-2">
      <input type="hidden" name="id" value={id} />
      <div className="min-w-0 flex-1">
        <TextField label="New password" name="password" type="text" autoComplete="off" error={error} value={pw} onChange={(e) => setPw(e.target.value)}
          hint={<button type="button" className="font-medium text-pine hover:underline" onClick={() => setPw(strongPassword())}>Make one</button>} />
      </div>
      <SubmitButton intent="reset" className="btn-secondary mb-[22px] px-3 py-2 text-xs" busyText="…">Set</SubmitButton>
    </Form>
  );
}
