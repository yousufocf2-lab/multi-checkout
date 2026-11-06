// Team & access: members with roles, collaborators (agencies, freelancers) through a request code, and the activity log.
// The super admin manages Growpefy staff here too (no collaborators on that side).
import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Form, Link, useActionData, useLoaderData, useNavigation, useSearchParams } from "@remix-run/react";
import { and, asc, eq } from "drizzle-orm";
import { useEffect, useMemo, useState } from "react";
import { Icon } from "~/components/Icons";
import { Card, Dialog, Field } from "~/components/settings-ui";
import { CopyField, Notice, SubmitButton } from "~/components/ui";
import { collaboratorRequests, db, stores, teamMembers, users } from "~/db.server";
import { hashPassword, isPrincipal, loginTaken, ownerContact, requireViewer, teamLogin, type Viewer } from "~/lib/auth.server";
import { collabCode, newCollabCode, requestsFor } from "~/lib/collaborators.server";
import { env } from "~/lib/env.server";
import { cleanPerms, OWNER_PERMS, permsFor, roleLabel, rolesFor, type Scope } from "~/lib/team";
import { logTeam, teamLog } from "~/lib/team-activity.server";

export const meta: MetaFunction = () => [{ title: "Team & access · Growpefy" }];

function scopeOf(v: Viewer): { scope: Scope; ownerId: number | null; selfId: number | null } {
  if (v.role === "admin") return { scope: "platform", ownerId: null, selfId: v.staff?.id ?? null };
  return { scope: "owner", ownerId: v.userId, selfId: v.member?.id ?? null };
}
const actorOf = (v: Viewer) => (v.role === "admin" ? v.staff?.name ?? "Super admin" : v.member?.name ?? v.name);

const mine = (scope: Scope, ownerId: number | null) =>
  scope === "platform" ? eq(teamMembers.scope, "platform") : and(eq(teamMembers.scope, "owner"), eq(teamMembers.ownerId, ownerId!));

export async function loader({ request }: LoaderFunctionArgs) {
  const v = await requireViewer(request); // the "team" permission is checked for team logins
  const { scope, ownerId, selfId } = scopeOf(v);
  const [list, storeRows, log, owner] = await Promise.all([
    db.select().from(teamMembers).where(mine(scope, ownerId)).orderBy(asc(teamMembers.name)),
    scope === "owner" ? db.select().from(stores).where(eq(stores.ownerId, ownerId!)).orderBy(asc(stores.name)) : Promise.resolve([]),
    teamLog(scope, ownerId, 120),
    scope === "owner" ? db.select().from(users).where(eq(users.id, ownerId!)).limit(1).then((r) => r[0] ?? null) : Promise.resolve(null),
  ]);
  const codes = scope === "owner" ? await Promise.all(storeRows.map(async (s) => ({ id: s.id, name: s.name, slug: s.slug, code: await collabCode(s), open: s.collabOpen }))) : [];
  const requests = scope === "owner" ? await requestsFor(storeRows.map((s) => s.id)) : [];
  return json({
    scope, selfId, principal: isPrincipal(v),
    myPerms: v.role === "admin" ? v.staff?.perms ?? null : v.member?.perms ?? null,
    owner: owner ? { name: owner.name, contact: ownerContact(owner) } : { name: "Super admin", contact: "Full access to the admin panel" },
    stores: storeRows.map((s) => ({ id: s.id, name: s.name })),
    codes, collabUrl: `${new URL(env.appUrl).host}/collaborate`,
    requests: requests.map((r) => ({ id: r.id, storeId: r.storeId, name: r.name, login: r.login, company: r.company, message: r.message, perms: r.perms, status: r.status, decidedBy: r.decidedBy, createdAt: r.createdAt.toISOString() })),
    members: list.map((m) => ({
      id: m.id, name: m.name, login: m.login, role: m.role, perms: m.perms, storeIds: m.storeIds, active: m.active, kind: m.kind, company: m.company,
      expiresAt: m.expiresAt?.toISOString() ?? null, lastLoginAt: m.lastLoginAt?.toISOString() ?? null, createdAt: m.createdAt.toISOString(),
    })),
    log: log.map((l) => ({ id: l.id, actor: l.actor, action: l.action, detail: l.detail, at: l.createdAt.toISOString() })),
  });
}

type Res = { ok?: string; error?: string; errors?: Record<string, string>; created?: { login: string; password: string } };
const expiryFrom = (days: string) => (Number(days) > 0 ? new Date(Date.now() + Number(days) * 86400_000) : null);

export async function action({ request }: ActionFunctionArgs) {
  const v = await requireViewer(request);
  const { scope, ownerId, selfId } = scopeOf(v);
  const actor = actorOf(v);
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
  const ownStores = async () => (scope === "owner" ? db.select().from(stores).where(eq(stores.ownerId, ownerId!)) : []);
  const storesIn = async () => {
    if (scope !== "owner" || s("storeAccess") !== "some") return null;
    const own = await ownStores();
    return fd.getAll("stores").map(Number).filter((n) => own.some((o) => o.id === n));
  };

  // ---- collaborators (store owners only) ----
  if (scope === "owner" && ["regenCode", "toggleOpen", "approve", "reject"].includes(intent)) {
    const own = await ownStores();
    if (intent === "regenCode" || intent === "toggleOpen") {
      const st = own.find((x) => x.id === Number(fd.get("storeId")));
      if (!st) return json<Res>({ error: "Store not found" }, { status: 404 });
      if (intent === "regenCode") {
        await db.update(stores).set({ collabCode: newCollabCode() }).where(eq(stores.id, st.id));
        await logTeam(scope, ownerId, actor, "Made a new collaborator code", st.name);
        return json<Res>({ ok: "New code ready. The old code no longer works." });
      }
      await db.update(stores).set({ collabOpen: !st.collabOpen }).where(eq(stores.id, st.id));
      await logTeam(scope, ownerId, actor, st.collabOpen ? "Stopped collaborator requests" : "Allowed collaborator requests", st.name);
      return json<Res>({ ok: st.collabOpen ? "Collaborator requests are off. Nobody can ask for access with the code." : "Collaborator requests are on." });
    }
    const [req] = await db.select().from(collaboratorRequests).where(eq(collaboratorRequests.id, id)).limit(1);
    const st = req ? own.find((x) => x.id === req.storeId) : undefined;
    if (!req || !st || req.status !== "pending") return json<Res>({ error: "This request is no longer waiting." }, { status: 404 });
    if (intent === "reject") {
      await db.update(collaboratorRequests).set({ status: "rejected", decidedBy: actor, decidedAt: new Date() }).where(eq(collaboratorRequests.id, req.id));
      await logTeam(scope, ownerId, actor, "Declined a collaborator", `${req.name}${req.company ? ` (${req.company})` : ""} for ${st.name}`);
      return json<Res>({ ok: `Declined ${req.name}'s request.` });
    }
    const perms = permsIn().filter((p) => p !== "team");
    if (!perms.length) return json<Res>({ errors: { [`perms-r${req.id}`]: "Give at least one permission" } }, { status: 400 });
    if (await loginTaken(req.login)) return json<Res>({ error: `${req.login} already has a Growpefy login. Ask them to request again with another email or number.` }, { status: 400 });
    const [m] = await db.insert(teamMembers).values({
      scope: "owner", ownerId, name: req.name, login: req.login, passwordHash: req.passwordHash, role: "collaborator", perms,
      storeIds: [st.id], kind: "collaborator", company: req.company, expiresAt: expiryFrom(s("expires")), createdBy: actor,
    }).returning({ id: teamMembers.id });
    await db.update(collaboratorRequests).set({ status: "approved", decidedBy: actor, decidedAt: new Date(), memberId: m.id }).where(eq(collaboratorRequests.id, req.id));
    await logTeam(scope, ownerId, actor, "Approved a collaborator", `${req.name}${req.company ? ` (${req.company})` : ""} for ${st.name}`);
    return json<Res>({ ok: `${req.name} can now log in with the email or number and password they chose.` });
  }

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
      role: s("role") || "custom", perms, storeIds, createdBy: actor,
    });
    await logTeam(scope, ownerId, actor, "Added a member", `${name} · ${roleLabel(scope, s("role") || "custom")}`);
    return json<Res>({ ok: `${name} can now log in.`, created: { login: key!.includes("@") ? key! : `+91 ${key}`, password } });
  }

  const [m] = await db.select().from(teamMembers).where(and(eq(teamMembers.id, id), mine(scope, ownerId))).limit(1);
  if (!m) return json<Res>({ error: "Team member not found" }, { status: 404 });
  if (m.id === selfId) return json<Res>({ error: "You can't change your own access. Ask the account owner." }, { status: 400 });
  if (!isPrincipal(v) && m.perms.includes("team")) return json<Res>({ error: "Only the account owner can change someone who manages the team." }, { status: 403 });

  if (intent === "update") {
    const perms = permsIn();
    const storeIds = m.kind === "collaborator" ? m.storeIds : await storesIn();
    if (!perms.length) return json<Res>({ errors: { [`perms${m.id}`]: "Give at least one permission" } }, { status: 400 });
    if (storeIds && !storeIds.length) return json<Res>({ errors: { [`stores${m.id}`]: "Pick at least one store" } }, { status: 400 });
    await db.update(teamMembers).set({
      name: s("name").slice(0, 80) || m.name, role: m.kind === "collaborator" ? "collaborator" : s("role") || "custom", perms, storeIds,
      ...(m.kind === "collaborator" && fd.has("expires") ? { expiresAt: s("expires") === "keep" ? m.expiresAt : expiryFrom(s("expires")) } : {}),
    }).where(eq(teamMembers.id, m.id));
    await logTeam(scope, ownerId, actor, "Changed access", m.name);
    return json<Res>({ ok: `Saved ${m.name}'s access. It applies on their next page load.` });
  }
  if (intent === "toggle") {
    await db.update(teamMembers).set({ active: !m.active }).where(eq(teamMembers.id, m.id));
    await logTeam(scope, ownerId, actor, m.active ? "Paused a member" : "Turned a member back on", m.name);
    return json<Res>({ ok: m.active ? `${m.name} is paused and can't log in.` : `${m.name} can log in again.` });
  }
  if (intent === "reset") {
    const password = String(fd.get("password") ?? "");
    if (password.length < 8) return json<Res>({ errors: { [`pw${m.id}`]: "Use at least 8 characters" } }, { status: 400 });
    await db.update(teamMembers).set({ passwordHash: await hashPassword(password) }).where(eq(teamMembers.id, m.id));
    await logTeam(scope, ownerId, actor, "Set a new password", m.name);
    return json<Res>({ ok: `New password set for ${m.name}.`, created: { login: m.login.includes("@") ? m.login : `+91 ${m.login}`, password } });
  }
  if (intent === "delete") {
    await db.delete(teamMembers).where(eq(teamMembers.id, m.id));
    await logTeam(scope, ownerId, actor, m.kind === "collaborator" ? "Removed a collaborator" : "Removed a member", m.name);
    return json<Res>({ ok: `${m.name} was removed.` });
  }
  return json<Res>({ error: "Unknown action" }, { status: 400 });
}

// ---------------- UI ----------------

const strongPassword = () => {
  const a = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789";
  return Array.from(globalThis.crypto.getRandomValues(new Uint32Array(10)), (n) => a[n % a.length]).join("");
};
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) : "Never");
const day = (iso: string) => new Date(iso).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", year: "numeric" });
const contact = (login: string) => (login.includes("@") ? login : `+91 ${login}`);

type Data = ReturnType<typeof useLoaderData<typeof loader>>;
type M = Data["members"][number];
type Tab = "members" | "roles" | "collaborators" | "activity";

function Avatar({ name, tone = "gray" }: { name: string; tone?: "gray" | "dark" | "violet" }) {
  const cls = tone === "dark" ? "bg-[#303030] text-white" : tone === "violet" ? "bg-[#ece6ff] text-[#5b3cc4]" : "bg-[#f1f1f1] text-ink-soft";
  return <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[12px] font-semibold uppercase ${cls}`}>{name.slice(0, 1)}</span>;
}

function Pill({ children, tone = "gray" }: { children: React.ReactNode; tone?: "gray" | "green" | "red" | "amber" | "violet" | "blue" }) {
  const cls = { gray: "bg-[#f1f1f1] text-ink-soft", green: "bg-[#cdfee1] text-[#0c5132]", red: "bg-[#fee9e8] text-[#8e1f0b]", amber: "bg-[#fff1e3] text-[#5e4200]", violet: "bg-[#ece6ff] text-[#5b3cc4]", blue: "bg-[#eaf4ff] text-[#00366c]" }[tone];
  return <span className={`inline-flex items-center whitespace-nowrap rounded-md px-1.5 py-px text-[11.5px] font-medium ${cls}`}>{children}</span>;
}

export default function Team() {
  const d = useLoaderData<typeof loader>();
  const r = useActionData<typeof action>() as Res | undefined;
  const nav = useNavigation();
  const [params, setParams] = useSearchParams();
  const owner = d.scope === "owner";
  const pending = d.requests.filter((x) => x.status === "pending");
  const tab = ((params.get("tab") as Tab) || "members");
  const [editing, setEditing] = useState<M | "new" | null>(null);
  useEffect(() => { if (nav.state === "idle" && r?.ok) setEditing(null); }, [nav.state, r]);
  const go = (t: Tab) => { const p = new URLSearchParams(params); if (t === "members") p.delete("tab"); else p.set("tab", t); setParams(p, { preventScrollReset: true, replace: true }); };
  const tabs: { id: Tab; label: string; badge?: number }[] = [
    { id: "members", label: "Members", badge: d.members.filter((m) => m.kind !== "collaborator").length + 1 },
    { id: "roles", label: "Roles" },
    ...(owner ? [{ id: "collaborators" as Tab, label: "Collaborators", badge: pending.length || undefined }] : []),
    { id: "activity", label: "Activity" },
  ];

  return (
    <div className="max-w-[920px] space-y-4">
      <div className="flex min-h-[32px] flex-wrap items-center gap-2">
        <Icon name="users" className="h-4 w-4" strokeWidth={1.9} />
        <h1 className="flex-1 text-[15px] font-semibold">Team & access</h1>
        {tab === "members" && <button type="button" onClick={() => setEditing("new")} className="btn-primary btn"><Icon name="plus" className="h-3.5 w-3.5" />Add member</button>}
      </div>

      <div className="flex gap-1 border-b border-[#e3e3e3]" role="tablist">
        {tabs.map((t) => (
          <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} onClick={() => go(t.id)}
            className={`-mb-px flex items-center gap-1.5 border-b-2 px-2.5 pb-2 pt-1 text-[13px] font-medium transition ${tab === t.id ? "border-[#303030] text-ink" : "border-transparent text-ink-soft hover:text-ink"}`}>
            {t.label}
            {t.badge != null && <span className={`num rounded-full px-1.5 text-[11px] ${t.id === "collaborators" ? "bg-[#303030] text-white" : "bg-[#e3e3e3] text-ink-soft"}`}>{t.badge}</span>}
          </button>
        ))}
      </div>

      {r?.ok && <Notice tone="success">{r.ok}</Notice>}
      {r?.error && <Notice tone="error">{r.error}</Notice>}
      {r?.created && (
        <section className="panel px-4 py-3">
          <p className="text-[13px] font-semibold">Share these login details privately</p>
          <p className="mt-0.5 text-[12.5px] text-ink-soft">They log in at <b className="text-ink">growpefy.com/login</b> with "Log in with password", then change the password from My account.</p>
          <p className="num mt-2 rounded-lg bg-[#f7f7f7] px-3 py-2 font-mono text-[12.5px]">Login: {r.created.login}<br />Password: {r.created.password}</p>
        </section>
      )}

      {tab === "members" && <Members d={d} onEdit={setEditing} />}
      {tab === "roles" && <Roles d={d} />}
      {tab === "collaborators" && owner && <Collaborators d={d} errors={r?.errors ?? {}} />}
      {tab === "activity" && <Activity log={d.log} />}

      <Dialog open={editing !== null} onClose={() => setEditing(null)} wide
        title={editing === "new" ? "Add member" : editing ? (editing.kind === "collaborator" ? `Collaborator: ${editing.name}` : editing.name) : ""}>
        {editing !== null && <MemberForm key={editing === "new" ? "new" : editing.id} d={d} member={editing === "new" ? undefined : editing} errors={r?.errors ?? {}} onCancel={() => setEditing(null)} />}
      </Dialog>
    </div>
  );
}

function Members({ d, onEdit }: { d: Data; onEdit: (m: M) => void }) {
  const owner = d.scope === "owner";
  const [q, setQ] = useState("");
  const rows = d.members.filter((m) => !q || `${m.name} ${m.login} ${m.company ?? ""}`.toLowerCase().includes(q.toLowerCase()));
  const storeName = (ids: number[] | null) => (ids ? d.stores.filter((s) => ids.includes(s.id)).map((s) => s.name).join(", ") || "No stores" : "All stores");
  const expired = (m: M) => Boolean(m.expiresAt && Date.parse(m.expiresAt) < Date.now());
  return (
    <Card flush>
      <div className="flex items-center gap-2 px-3 py-2">
        <label className="flex h-8 min-w-0 flex-1 items-center gap-2 rounded-lg px-2 text-ink-soft shadow-[inset_0_0_0_1px_#e3e3e3] focus-within:shadow-[inset_0_0_0_1px_#005bd3]">
          <Icon name="search" className="h-3.5 w-3.5" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by name, email or company" className="min-w-0 flex-1 bg-transparent text-[13px] text-ink outline-none" />
        </label>
      </div>
      <div className="overflow-x-auto border-t border-rule">
        <table className="w-full min-w-[640px] text-[13px]">
          <thead><tr className="bg-[#f7f7f7] text-left text-[12px] font-medium text-ink-soft">
            <th className="px-4 py-1.5 font-medium">User</th><th className="px-3 py-1.5 font-medium">Role</th>{owner && <th className="px-3 py-1.5 font-medium">Stores</th>}<th className="px-3 py-1.5 font-medium">Status</th><th className="px-4 py-1.5 text-right font-medium">Last login</th>
          </tr></thead>
          <tbody className="divide-y divide-rule">
            <tr>
              <td className="px-4 py-2.5"><div className="flex items-center gap-2.5"><Avatar name={d.owner.name} tone="dark" /><div className="min-w-0"><p className="truncate font-medium">{d.owner.name}</p><p className="truncate text-[12px] text-ink-faint">{d.owner.contact}</p></div></div></td>
              <td className="px-3 py-2.5">{owner ? "Account owner" : "Super admin"}</td>
              {owner && <td className="px-3 py-2.5 text-ink-soft">All stores</td>}
              <td className="px-3 py-2.5"><Pill tone="green">Active</Pill></td>
              <td className="px-4 py-2.5 text-right text-ink-faint">—</td>
            </tr>
            {rows.map((m) => (
              <tr key={m.id} className={m.id === d.selfId ? "" : "cursor-pointer hover:bg-[#fafafa]"} onClick={() => m.id !== d.selfId && onEdit(m)}>
                <td className="px-4 py-2.5"><div className="flex items-center gap-2.5"><Avatar name={m.name} tone={m.kind === "collaborator" ? "violet" : "gray"} /><div className="min-w-0">
                  <p className="flex items-center gap-1.5 truncate font-medium">{m.name}{m.id === d.selfId && <Pill tone="blue">You</Pill>}</p>
                  <p className="truncate text-[12px] text-ink-faint">{contact(m.login)}{m.company ? ` · ${m.company}` : ""}</p></div></div></td>
                <td className="px-3 py-2.5">{m.kind === "collaborator" ? <Pill tone="violet">Collaborator</Pill> : roleLabel(d.scope, m.role)}</td>
                {owner && <td className="max-w-[180px] truncate px-3 py-2.5 text-ink-soft">{storeName(m.storeIds)}</td>}
                <td className="px-3 py-2.5">
                  {expired(m) ? <Pill tone="red">Expired</Pill> : !m.active ? <Pill tone="amber">Paused</Pill> : <Pill tone="green">Active</Pill>}
                  {m.expiresAt && !expired(m) && <span className="ml-1.5 text-[11.5px] text-ink-faint">until {day(m.expiresAt)}</span>}
                </td>
                <td className="whitespace-nowrap px-4 py-2.5 text-right text-ink-soft">{when(m.lastLoginAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {d.members.length === 0 && (
        <p className="border-t border-rule px-4 py-6 text-center text-[12.5px] text-ink-soft">
          {owner ? "Give your staff their own login. Each one sees only what their role allows." : "Add Growpefy staff. Each one sees only the parts of the admin panel you allow."}
        </p>
      )}
    </Card>
  );
}

function Roles({ d }: { d: Data }) {
  const roles = rolesFor(d.scope) as { id: string; label: string; perms: string[]; description?: string; group?: string }[];
  const perms = permsFor(d.scope);
  const [open, setOpen] = useState<string | null>(null);
  const count = (id: string) => d.members.filter((m) => m.role === id).length;
  return (
    <Card title="Roles" description="Ready-made sets of permissions. Pick one when you add a member, then add or remove single permissions if you need to." flush>
      <div className="border-t border-rule">
        <div className="grid grid-cols-[minmax(0,1fr)_120px_70px] gap-3 bg-[#f7f7f7] px-4 py-1.5 text-[12px] font-medium text-ink-soft"><span>Role</span><span>Type</span><span className="text-right">Users</span></div>
        <ul className="divide-y divide-rule">
          {roles.map((r) => (
            <li key={r.id}>
              <button type="button" onClick={() => setOpen(open === r.id ? null : r.id)} className="grid w-full grid-cols-[minmax(0,1fr)_120px_70px] items-center gap-3 px-4 py-2.5 text-left hover:bg-[#fafafa]">
                <span className="min-w-0"><span className="flex items-center gap-1.5 text-[13px] font-medium"><Icon name="chevron" className={`h-3 w-3 text-ink-faint transition ${open === r.id ? "" : "-rotate-90"}`} />{r.label}</span>
                  {r.description && <span className="block truncate pl-[18px] text-[12px] text-ink-soft">{r.description}</span>}</span>
                <span className="text-[12.5px] text-ink-soft">{r.group ?? "Admin panel"}</span>
                <span className="num text-right text-[12.5px]">{count(r.id)}</span>
              </button>
              {open === r.id && (
                <div className="flex flex-wrap gap-1.5 px-4 pb-3 pl-[34px]">
                  {perms.map((p) => (
                    <span key={p.id} className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11.5px] ${r.perms.includes(p.id) ? "bg-[#cdfee1] text-[#0c5132]" : "bg-[#f7f7f7] text-ink-faint line-through"}`}>{p.label}</span>
                  ))}
                </div>
              )}
            </li>
          ))}
          {d.scope === "owner" && (
            <li className="grid grid-cols-[minmax(0,1fr)_120px_70px] items-center gap-3 px-4 py-2.5">
              <span className="min-w-0 pl-[18px]"><span className="block text-[13px] font-medium">Collaborator</span><span className="block truncate text-[12px] text-ink-soft">People outside your business. You approve their request and choose their access.</span></span>
              <span className="text-[12.5px] text-ink-soft">External</span>
              <span className="num text-right text-[12.5px]">{d.members.filter((m) => m.kind === "collaborator").length}</span>
            </li>
          )}
        </ul>
      </div>
    </Card>
  );
}

function PermPicker({ scope, allowed, picked, setPicked, error }: { scope: Scope; allowed: string[]; picked: string[]; setPicked: (f: (p: string[]) => string[]) => void; error?: string }) {
  const perms = permsFor(scope).filter((p) => allowed.includes(p.id)) as { id: string; label: string; description: string; group?: string }[];
  const groups = [...new Set(perms.map((p) => p.group ?? "Access"))];
  return (
    <fieldset>
      <legend className="label">Permissions</legend>
      <div className="space-y-3">
        {groups.map((g) => (
          <div key={g}>
            {groups.length > 1 && <p className="mb-1 text-[11.5px] font-medium uppercase tracking-wide text-ink-faint">{g}</p>}
            <div className="grid gap-1.5 sm:grid-cols-2">
              {perms.filter((p) => (p.group ?? "Access") === g).map((p) => (
                <label key={p.id} className={`flex cursor-pointer gap-2.5 rounded-lg px-2.5 py-2 transition ${picked.includes(p.id) ? "bg-[#f1f1f1] shadow-[inset_0_0_0_1px_#c9c9c9]" : "shadow-[inset_0_0_0_1px_#ebebeb] hover:bg-[#fafafa]"}`}>
                  <input type="checkbox" name="perms" value={p.id} checked={picked.includes(p.id)} onChange={() => setPicked((x) => (x.includes(p.id) ? x.filter((y) => y !== p.id) : [...x, p.id]))} className="mt-0.5 h-4 w-4" />
                  <span className="min-w-0"><span className="block text-[13px] font-medium">{p.label}</span><span className="block text-[12px] leading-snug text-ink-soft">{p.description}</span></span>
                </label>
              ))}
            </div>
          </div>
        ))}
      </div>
      {error && <p className="error-text mt-1">{error}</p>}
    </fieldset>
  );
}

const EXPIRY = [["7", "7 days"], ["30", "30 days"], ["90", "90 days"], ["0", "No end date"]] as const;

function MemberForm({ d, member, errors, onCancel }: { d: Data; member?: M; errors: Record<string, string>; onCancel: () => void }) {
  const scope = d.scope;
  const roles = rolesFor(scope) as { id: string; label: string; perms: string[]; description?: string }[];
  const collab = member?.kind === "collaborator";
  const allowed = permsFor(scope).map((p) => p.id).filter((id) => (d.principal || (id !== "team" && (d.myPerms ?? []).includes(id))) && !(collab && id === "team"));
  const startRole = member?.role ?? (scope === "owner" ? "support" : roles[0].id);
  const [role, setRole] = useState(startRole);
  const [picked, setPicked] = useState<string[]>(member?.perms ?? roles.find((r) => r.id === startRole)?.perms ?? []);
  const [access, setAccess] = useState<"all" | "some">(member?.storeIds ? "some" : "all");
  const [pw, setPw] = useState("");
  const k = member ? String(member.id) : "";
  const preset = roles.find((r) => r.id === role);
  const matches = preset && preset.perms.filter((p) => allowed.includes(p)).sort().join() === [...picked].sort().join();
  const pick = (id: string) => { setRole(id); const r = roles.find((x) => x.id === id); if (r) setPicked(r.perms.filter((p) => allowed.includes(p))); };
  const nav = useNavigation();
  const busy = nav.state !== "idle";

  return (
    <div className="space-y-4">
      <Form method="post" className="space-y-4">
        {member && <input type="hidden" name="id" value={member.id} />}
        <input type="hidden" name="role" value={collab ? "collaborator" : matches ? role : "custom"} />
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Name" error={errors.name}><input name="name" defaultValue={member?.name} className="input" placeholder="e.g. Riya Sharma" /></Field>
          {member
            ? <Field label="Login"><input value={contact(member.login)} readOnly className="input bg-[#f7f7f7] text-ink-soft" /></Field>
            : <Field label="Email or mobile number" error={errors.login}><input name="login" className="input" placeholder="riya@yourbrand.com or 98xxxxxxxx" autoComplete="off" /></Field>}
          {!member && (
            <Field className="sm:col-span-2" label="Temporary password" error={errors.password}
              hint={<button type="button" className="font-medium text-[#005bd3] hover:underline" onClick={() => setPw(strongPassword())}>Make a strong password</button>}>
              <input name="password" type="text" autoComplete="off" value={pw} onChange={(e) => setPw(e.target.value)} className="input font-mono" />
            </Field>
          )}
        </div>

        {!collab && (
          <Field label="Role" hint={preset?.description && matches ? preset.description : !matches ? "Custom permissions" : undefined}>
            <select value={matches ? role : "custom"} onChange={(e) => e.target.value !== "custom" && pick(e.target.value)} className="input">
              {roles.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
              {!matches && <option value="custom">Custom</option>}
            </select>
          </Field>
        )}
        {collab && (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Company"><input value={member?.company ?? "—"} readOnly className="input bg-[#f7f7f7] text-ink-soft" /></Field>
            <Field label="Access ends" hint={member?.expiresAt ? `Now: ${day(member.expiresAt)}` : "Now: no end date"}>
              <select name="expires" defaultValue="keep" className="input"><option value="keep">Keep as it is</option>{EXPIRY.map(([v, l]) => <option key={v} value={v}>{v === "0" ? l : `${l} from today`}</option>)}</select>
            </Field>
          </div>
        )}

        <PermPicker scope={scope} allowed={allowed} picked={picked} setPicked={setPicked} error={errors.perms || errors[`perms${k}`]} />

        {scope === "owner" && d.stores.length > 1 && !collab && (
          <fieldset>
            <legend className="label">Stores</legend>
            <div className="flex gap-1 rounded-lg bg-[#f1f1f1] p-0.5 text-[12.5px] sm:inline-flex">
              {([["all", "All stores"], ["some", "Only some stores"]] as const).map(([id, l]) => (
                <label key={id} className={`flex-1 cursor-pointer rounded-md px-2.5 py-1 text-center font-medium ${access === id ? "bg-white shadow-[0_0_0_1px_rgba(0,0,0,.08)]" : "text-ink-soft"}`}>
                  <input type="radio" name="storeAccess" value={id} checked={access === id} onChange={() => setAccess(id)} className="sr-only" />{l}
                </label>
              ))}
            </div>
            {access === "some" && (
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1.5">
                {d.stores.map((s) => <label key={s.id} className="flex items-center gap-2 text-[13px]"><input type="checkbox" name="stores" value={s.id} defaultChecked={member?.storeIds?.includes(s.id)} className="h-4 w-4" />{s.name}</label>)}
              </div>
            )}
            {(errors.stores || errors[`stores${k}`]) && <p className="error-text mt-1">{errors.stores || errors[`stores${k}`]}</p>}
          </fieldset>
        )}

        <div className="flex justify-end gap-2 border-t border-rule pt-3">
          <button type="button" onClick={onCancel} className="btn-secondary btn">Cancel</button>
          <SubmitButton intent={member ? "update" : "create"} className="btn-primary btn" busyText="Saving">{member ? "Save" : "Add member"}</SubmitButton>
        </div>
      </Form>

      {member && (
        <div className="space-y-3 border-t border-rule pt-4">
          {!collab && <ResetPassword id={member.id} error={errors[`pw${member.id}`]} />}
          <div className="flex flex-wrap gap-2">
            <Form method="post"><input type="hidden" name="id" value={member.id} /><button name="intent" value="toggle" className="btn-secondary btn" disabled={busy}>{member.active ? "Pause login" : "Turn login back on"}</button></Form>
            <Form method="post" onSubmit={(e) => { if (!confirm(`Remove ${member.name}? They won't be able to log in.`)) e.preventDefault(); }}>
              <input type="hidden" name="id" value={member.id} />
              <button name="intent" value="delete" className="btn-secondary btn text-[#8e1f0b]" disabled={busy}><Icon name="trash" className="h-3.5 w-3.5" />{collab ? "Remove collaborator" : "Remove member"}</button>
            </Form>
          </div>
        </div>
      )}
    </div>
  );
}

function ResetPassword({ id, error }: { id: number; error?: string }) {
  const [pw, setPw] = useState("");
  return (
    <Form method="post" className="flex items-end gap-2">
      <input type="hidden" name="id" value={id} />
      <Field className="min-w-0 flex-1" label="Set a new password" error={error}
        hint={<button type="button" className="font-medium text-[#005bd3] hover:underline" onClick={() => setPw(strongPassword())}>Make one</button>}>
        <input name="password" type="text" autoComplete="off" value={pw} onChange={(e) => setPw(e.target.value)} className="input font-mono" />
      </Field>
      <SubmitButton intent="reset" className="btn-secondary btn mb-[20px]" busyText="…">Set</SubmitButton>
    </Form>
  );
}

function Collaborators({ d, errors }: { d: Data; errors: Record<string, string> }) {
  const [approving, setApproving] = useState<Data["requests"][number] | null>(null);
  const nav = useNavigation();
  useEffect(() => { if (nav.state === "idle") setApproving(null); }, [nav.state]); // eslint-disable-line react-hooks/exhaustive-deps
  const pending = d.requests.filter((r) => r.status === "pending");
  const past = d.requests.filter((r) => r.status !== "pending").slice(0, 10);
  const collabs = d.members.filter((m) => m.kind === "collaborator");
  const storeName = (id: number) => d.stores.find((s) => s.id === id)?.name ?? "";
  const permLabel = (ids: string[]) => OWNER_PERMS.filter((p) => ids.includes(p.id)).map((p) => p.label).join(", ");

  return (
    <div className="space-y-4">
      <Card title="Request code" description={`Agencies, designers and developers ask for access at ${d.collabUrl} with your store ID and this code. Nothing opens until you approve. They don't count as your staff.`}>
        <div className="space-y-3">
          {d.codes.map((c) => (
            <div key={c.id} className="rounded-[10px] px-3 py-3 shadow-[0_0_0_1px_rgba(0,0,0,.08)]">
              <div className="flex flex-wrap items-center gap-2">
                <p className="min-w-0 flex-1 truncate text-[13px] font-medium">{c.name}<span className="font-normal text-ink-faint"> · store ID {c.slug}</span></p>
                {c.open ? <Pill tone="green">Accepting requests</Pill> : <Pill>Requests off</Pill>}
              </div>
              <div className="mt-2.5 grid gap-2 sm:grid-cols-[160px_minmax(0,1fr)]">
                <CopyField label="Code" value={c.code} />
                <CopyField label="Link to share" value={`https://${d.collabUrl}?store=${c.slug}`} />
              </div>
              <div className="mt-2.5 flex flex-wrap gap-2">
                <Form method="post"><input type="hidden" name="storeId" value={c.id} /><button name="intent" value="regenCode" className="btn-secondary btn">Make a new code</button></Form>
                <Form method="post"><input type="hidden" name="storeId" value={c.id} /><button name="intent" value="toggleOpen" className="btn-secondary btn">{c.open ? "Stop requests" : "Allow requests"}</button></Form>
              </div>
            </div>
          ))}
          {d.codes.length === 0 && <p className="text-[12.5px] text-ink-soft">Create a store first.</p>}
        </div>
      </Card>

      <Card title="Requests" description={pending.length ? `${pending.length} waiting for you` : "No requests waiting."} flush>
        {pending.length > 0 && (
          <ul className="divide-y divide-rule border-t border-rule">
            {pending.map((r) => (
              <li key={r.id} className="flex flex-wrap items-start gap-3 px-4 py-3">
                <Avatar name={r.name} tone="violet" />
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-medium">{r.name}{r.company && <span className="font-normal text-ink-soft"> · {r.company}</span>}</p>
                  <p className="text-[12px] text-ink-faint">{contact(r.login)} · {storeName(r.storeId)} · {when(r.createdAt)}</p>
                  <p className="mt-1 text-[12px] text-ink-soft">Asks for: {permLabel(r.perms)}</p>
                  {r.message && <p className="mt-1 rounded-lg bg-[#f7f7f7] px-2.5 py-1.5 text-[12.5px]">{r.message}</p>}
                </div>
                <div className="flex gap-2">
                  <Form method="post"><input type="hidden" name="id" value={r.id} /><button name="intent" value="reject" className="btn-secondary btn">Decline</button></Form>
                  <button type="button" className="btn-primary btn" onClick={() => setApproving(r)}>Review</button>
                </div>
              </li>
            ))}
          </ul>
        )}
        {past.length > 0 && (
          <details className="border-t border-rule px-4 py-2.5 text-[12.5px]">
            <summary className="cursor-pointer text-ink-soft">Earlier requests</summary>
            <ul className="mt-2 space-y-1">
              {past.map((r) => <li key={r.id} className="flex justify-between gap-3"><span className="truncate">{r.name}{r.company ? ` · ${r.company}` : ""} · {storeName(r.storeId)}</span><span className="shrink-0 text-ink-faint">{r.status === "approved" ? "Approved" : "Declined"}{r.decidedBy ? ` by ${r.decidedBy}` : ""}</span></li>)}
            </ul>
          </details>
        )}
      </Card>

      <Card title="Collaborators with access" flush>
        {collabs.length === 0 ? <p className="border-t border-rule px-4 py-5 text-center text-[12.5px] text-ink-soft">No collaborators yet.</p> : (
          <ul className="divide-y divide-rule border-t border-rule">
            {collabs.map((m) => {
              const ended = Boolean(m.expiresAt && Date.parse(m.expiresAt) < Date.now());
              return (
                <li key={m.id} className="flex items-center gap-3 px-4 py-2.5">
                  <Avatar name={m.name} tone="violet" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] font-medium">{m.name}{m.company && <span className="font-normal text-ink-soft"> · {m.company}</span>}</p>
                    <p className="truncate text-[12px] text-ink-faint">{(m.storeIds ?? []).map(storeName).join(", ")} · {permLabel(m.perms)}</p>
                  </div>
                  {ended ? <Pill tone="red">Ended {day(m.expiresAt!)}</Pill> : m.expiresAt ? <Pill tone="amber">Until {day(m.expiresAt)}</Pill> : <Pill>No end date</Pill>}
                  <Link to="?tab=members" className="text-[12.5px] font-medium text-[#005bd3] hover:underline">Manage</Link>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <Dialog open={approving !== null} onClose={() => setApproving(null)} title={approving ? `Approve ${approving.name}` : ""} wide>
        {approving && <ApproveForm r={approving} errors={errors} store={storeName(approving.storeId)} onCancel={() => setApproving(null)} />}
      </Dialog>
    </div>
  );
}

function ApproveForm({ r, errors, store, onCancel }: { r: { id: number; name: string; company: string | null; perms: string[] }; errors: Record<string, string>; store: string; onCancel: () => void }) {
  const allowed = useMemo(() => OWNER_PERMS.filter((p) => p.id !== "team").map((p) => p.id), []);
  const [picked, setPicked] = useState<string[]>(r.perms);
  return (
    <Form method="post" className="space-y-4">
      <input type="hidden" name="id" value={r.id} />
      <p className="text-[12.5px] text-ink-soft"><b className="text-ink">{r.name}</b>{r.company ? ` from ${r.company}` : ""} gets access to <b className="text-ink">{store}</b> only. Untick anything they don't need.</p>
      <Field label="Access ends"><select name="expires" defaultValue="30" className="input">{EXPIRY.map(([v, l]) => <option key={v} value={v}>{v === "0" ? l : `After ${l}`}</option>)}</select></Field>
      <PermPicker scope="owner" allowed={allowed} picked={picked} setPicked={setPicked} error={errors[`perms-r${r.id}`]} />
      <div className="flex justify-end gap-2 border-t border-rule pt-3">
        <button type="button" onClick={onCancel} className="btn-secondary btn">Cancel</button>
        <SubmitButton intent="approve" className="btn-primary btn" busyText="Approving">Approve access</SubmitButton>
      </div>
    </Form>
  );
}

function Activity({ log }: { log: Data["log"] }) {
  return (
    <Card title="Activity" description="Logins, access changes and collaborator requests from the last while." flush>
      {log.length === 0 ? <p className="border-t border-rule px-4 py-6 text-center text-[12.5px] text-ink-soft">Nothing yet. Team logins and changes will show here.</p> : (
        <ul className="divide-y divide-rule border-t border-rule">
          {log.map((l) => (
            <li key={l.id} className="flex items-start gap-3 px-4 py-2">
              <Avatar name={l.actor} />
              <p className="min-w-0 flex-1 text-[13px]"><b className="font-medium">{l.actor}</b> <span className="text-ink-soft">{l.action.charAt(0).toLowerCase() + l.action.slice(1)}</span>{l.detail && <span className="text-ink-soft"> · {l.detail}</span>}</p>
              <span className="shrink-0 whitespace-nowrap text-[12px] text-ink-faint">{when(l.at)}</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
