// Super admin → WhatsApp inbox: messages to Growpefy's own WhatsApp number (leads, signups, store owners,
// anyone else), with Growpefy's welcome / payment messages, and replies from here. Store order chats are not shown.
import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Link, useFetcher, useLoaderData, useRevalidator, useSearchParams } from "@remix-run/react";
import { asc, desc, eq, ilike, or } from "drizzle-orm";
import { useEffect, useRef, useState } from "react";
import { EmptyState, Notice, PageHeader, Spinner } from "~/components/ui";
import { adminWaConversations, adminWaMessages, db } from "~/db.server";
import { requireAdmin } from "~/lib/auth.server";
import { WINDOW_MS, adminFollowup, adminReply, whoIs, windowOpen } from "~/lib/admin-inbox.server";
import { messaging, waReady } from "~/lib/rto.server";

export const meta: MetaFunction = () => [{ title: "WhatsApp inbox · Growpefy" }];

async function requireSuperAdmin(request: Request) {
  const v = await requireAdmin(request);
  if (v.staff) throw new Response("Only the Super Admin can open Growpefy's WhatsApp inbox.", { status: 403 });
  return v;
}

export async function loader({ request }: LoaderFunctionArgs) {
  await requireSuperAdmin(request);
  const url = new URL(request.url);
  const q = (url.searchParams.get("q") ?? "").trim().replace(/[%_]/g, "").slice(0, 40);
  const filter = url.searchParams.get("f") === "unread" ? "unread" : "all";
  const cid = Number(url.searchParams.get("c")) || null;
  const [convs, m] = await Promise.all([
    db.select().from(adminWaConversations)
      .where(q ? or(ilike(adminWaConversations.phone, `%${q}%`), ilike(adminWaConversations.name, `%${q}%`)) : undefined)
      .orderBy(desc(adminWaConversations.lastMessageAt)).limit(150),
    messaging(),
  ]);
  const list = filter === "unread" ? convs.filter((c) => c.unread > 0 || c.id === cid) : convs;
  const previews = new Map<number, { body: string; direction: string }>();
  for (const c of list) {
    const [last] = await db.select({ body: adminWaMessages.body, direction: adminWaMessages.direction }).from(adminWaMessages).where(eq(adminWaMessages.conversationId, c.id)).orderBy(desc(adminWaMessages.createdAt)).limit(1);
    if (last) previews.set(c.id, last);
  }
  const who = await whoIs(list.map((c) => c.phone));

  let active = null as null | {
    id: number; name: string; phone: string; lastInboundAt: string | null; open: boolean; closesAt: string | null;
    who: { label: string; href: string; name: string } | null;
    messages: { id: number; direction: string; kind: string; body: string; status: string | null; sentBy: string | null; at: string }[];
  };
  if (cid) {
    const [c] = await db.select().from(adminWaConversations).where(eq(adminWaConversations.id, cid)).limit(1);
    if (c) {
      const msgs = await db.select().from(adminWaMessages).where(eq(adminWaMessages.conversationId, c.id)).orderBy(asc(adminWaMessages.createdAt)).limit(300);
      if (c.unread) await db.update(adminWaConversations).set({ unread: 0 }).where(eq(adminWaConversations.id, c.id));
      const w = who.get(c.phone) ?? (await whoIs([c.phone])).get(c.phone) ?? null;
      active = {
        id: c.id, name: c.name || w?.name || "", phone: c.phone, lastInboundAt: c.lastInboundAt?.toISOString() ?? null, open: windowOpen(c.lastInboundAt),
        closesAt: c.lastInboundAt ? new Date(c.lastInboundAt.getTime() + WINDOW_MS).toISOString() : null, who: w,
        messages: msgs.map((x) => ({ id: x.id, direction: x.direction, kind: x.kind, body: x.body, status: x.status, sentBy: x.sentBy, at: x.createdAt.toISOString() })),
      };
    }
  }
  return json({
    ready: waReady(m), followupReady: Boolean(m.waFollowupTemplate), filter,
    unreadTotal: convs.reduce((n, c) => n + (c.id === active?.id ? 0 : c.unread), 0),
    conversations: list.map((c) => {
      const w = who.get(c.phone);
      return { id: c.id, name: c.name || w?.name || "", phone: c.phone, tag: w?.label ?? null, unread: c.id === active?.id ? 0 : c.unread, at: c.lastMessageAt.toISOString(), open: windowOpen(c.lastInboundAt), replied: Boolean(c.lastInboundAt), preview: previews.get(c.id) ?? null };
    }),
    active,
  });
}

export async function action({ request }: ActionFunctionArgs) {
  await requireSuperAdmin(request);
  const fd = await request.formData();
  const conv = Number(fd.get("conversation"));
  const r = fd.get("intent") === "followup" ? await adminFollowup(conv, "Growpefy") : await adminReply(conv, String(fd.get("text") ?? ""), "Growpefy");
  return json(r, { status: r.ok ? 200 : 400 });
}

const time = (iso: string) => {
  const d = new Date(iso);
  const today = new Date().toDateString() === d.toDateString();
  return today ? d.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" }) : d.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
};
const fmt = (p: string) => `+91 ${p.slice(0, 5)} ${p.slice(5)}`;

export default function AdminInbox() {
  const d = useLoaderData<typeof loader>();
  const [params, setParams] = useSearchParams();
  const revalidator = useRevalidator();
  useEffect(() => {
    const t = setInterval(() => { if (document.visibilityState === "visible" && revalidator.state === "idle") revalidator.revalidate(); }, 8000);
    return () => clearInterval(t);
  }, [revalidator]);
  const set = (k: string, v: string | null) => { const p = new URLSearchParams(params); if (v) p.set(k, v); else p.delete(k); setParams(p, { preventScrollReset: true, replace: k !== "c" }); };

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader title="WhatsApp inbox" description="Messages to Growpefy's own WhatsApp number: leads, signups, store owners and anyone who writes to Growpefy. Store order chats stay in each store's inbox." />
      <div className="space-y-4">
        {!d.ready && <Notice tone="warning">WhatsApp isn't set up yet in Wallets → Messaging.</Notice>}
        <div className="panel grid h-[calc(100vh-240px)] min-h-[520px] overflow-hidden lg:grid-cols-[340px_minmax(0,1fr)]">
          <div className={`flex min-h-0 flex-col border-rule lg:border-r ${d.active ? "hidden lg:flex" : "flex"}`}>
            <div className="space-y-2 border-b border-rule p-3">
              <input type="search" defaultValue={params.get("q") ?? ""} placeholder="Search name or number" className="input py-2 text-sm" onChange={(e) => set("q", e.target.value || null)} />
              <div className="flex gap-1 text-xs font-medium">
                {([["all", "All"], ["unread", `Unread${d.unreadTotal ? ` (${d.unreadTotal})` : ""}`]] as const).map(([k, l]) => (
                  <button key={k} type="button" onClick={() => set("f", k === "all" ? null : k)} className={`rounded-full px-3 py-1 ${d.filter === k ? "bg-ink text-white" : "bg-paper-sunk text-ink-soft hover:text-ink"}`}>{l}</button>
                ))}
              </div>
            </div>
            <ul className="scroll-thin min-h-0 flex-1 overflow-y-auto">
              {d.conversations.length === 0 && (
                <li className="p-6"><EmptyState title={d.filter === "unread" ? "Nothing unread" : "No conversations yet"}>Messages people send to Growpefy's WhatsApp number show up here, with welcome and payment messages Growpefy sent them.</EmptyState></li>
              )}
              {d.conversations.map((c) => (
                <li key={c.id}>
                  <button type="button" onClick={() => set("c", String(c.id))}
                    className={`flex w-full items-start gap-3 border-b border-rule px-3.5 py-3 text-left transition hover:bg-paper ${d.active?.id === c.id ? "bg-pine-tint/50" : ""}`}>
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-sm font-semibold text-emerald-800">{(c.name || "#").slice(0, 1).toUpperCase()}</span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center justify-between gap-2">
                        <span className="truncate text-sm font-semibold">{c.name || fmt(c.phone)}</span>
                        <span className="shrink-0 text-[11px] text-ink-faint">{time(c.at)}</span>
                      </span>
                      <span className="flex items-center justify-between gap-2">
                        <span className={`truncate text-xs ${c.unread ? "font-medium text-ink" : "text-ink-soft"}`}>{c.preview ? `${c.preview.direction === "out" ? "Growpefy: " : ""}${c.preview.body.split("\n")[0]}` : ""}</span>
                        {c.unread > 0 && <span className="num flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-emerald-600 px-1.5 text-[11px] font-semibold text-white">{c.unread}</span>}
                      </span>
                      <span className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[10px] text-ink-faint">
                        {c.tag && <span className="rounded bg-paper-sunk px-1.5 py-px font-medium text-ink-soft">{c.tag}</span>}
                        {c.open ? "🟢 Chat open" : c.replied ? "24 h window closed" : "Waiting for them to reply"}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
          {d.active ? <Thread key={d.active.id} d={d} onBack={() => set("c", null)} /> : (
            <div className="hidden items-center justify-center bg-[#efeae2] lg:flex"><p className="rounded-lg bg-surface/90 px-4 py-2 text-sm text-ink-soft">Choose a conversation</p></div>
          )}
        </div>
        <p className="text-xs text-ink-faint">WhatsApp lets you reply freely for 24 hours after a person's last message. After that, send the follow-up template asking them to reply. Messages here aren't charged to any store wallet.</p>
      </div>
    </div>
  );
}

type D = ReturnType<typeof useLoaderData<typeof loader>>;

function Thread({ d, onBack }: { d: D; onBack: () => void }) {
  const a = d.active!;
  const send = useFetcher<{ ok: boolean; error?: string }>();
  const [text, setText] = useState("");
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => { end.current?.scrollIntoView({ block: "end" }); }, [a.messages.length]);
  useEffect(() => { if (send.state === "idle" && send.data?.ok) setText(""); }, [send.state, send.data]);
  const busy = send.state !== "idle";
  const hoursLeft = a.closesAt ? Math.max(0, Math.round((new Date(a.closesAt).getTime() - Date.now()) / 3600_000)) : 0;
  const submit = () => { if (text.trim()) send.submit({ intent: "reply", conversation: String(a.id), text }, { method: "post" }); };
  const label = (k: string) => (k === "template" ? "Sent by Growpefy" : k === "auto" ? "Automatic reply" : k === "followup" ? "Follow-up" : null);

  return (
    <div className="flex min-h-0 flex-col">
      <header className="flex items-center gap-3 border-b border-rule bg-surface px-4 py-3">
        <button type="button" onClick={onBack} className="text-ink-soft lg:hidden" aria-label="Back">←</button>
        <span className="flex h-9 w-9 items-center justify-center rounded-full bg-emerald-100 text-sm font-semibold text-emerald-800">{(a.name || "#").slice(0, 1).toUpperCase()}</span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">{a.name || fmt(a.phone)}</p>
          <p className="num text-xs text-ink-faint">{fmt(a.phone)}</p>
        </div>
        {a.who
          ? <Link to={a.who.href} className="shrink-0 text-xs font-medium text-pine hover:underline">{a.who.label} →</Link>
          : <span className="shrink-0 text-xs text-ink-faint">Not a lead yet</span>}
        <a href={`https://wa.me/91${a.phone}`} target="_blank" rel="noreferrer" className="hidden shrink-0 text-xs font-medium text-ink-soft hover:text-ink sm:inline">Open in WhatsApp ↗</a>
      </header>

      <div className="scroll-thin min-h-0 flex-1 space-y-2 overflow-y-auto bg-[#efeae2] px-4 py-4">
        {a.messages.map((m) => (
          <div key={m.id} className={`flex ${m.direction === "out" ? "justify-end" : "justify-start"}`}>
            <div className={`max-w-[78%] rounded-lg px-3 py-2 text-sm shadow-sm ${m.direction === "out" ? "bg-[#d9fdd3]" : "bg-white"}`}>
              {m.direction === "out" && label(m.kind) && <p className="mb-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-700">{label(m.kind)}</p>}
              <p className="whitespace-pre-wrap break-words text-ink">{m.body}</p>
              <p className="mt-1 flex items-center justify-end gap-1.5 text-[10px] text-ink-faint">
                {m.direction === "out" && m.sentBy && <span>{m.sentBy} ·</span>}
                {time(m.at)}
                {m.direction === "out" && <Ticks s={m.status} />}
              </p>
            </div>
          </div>
        ))}
        <div ref={end} />
      </div>

      <div className="border-t border-rule bg-surface p-3">
        {send.data && !send.data.ok && <p className="mb-2 text-xs font-medium text-bad" role="alert">{send.data.error}</p>}
        {!a.lastInboundAt ? (
          <p className="rounded-lg bg-paper px-3 py-2.5 text-center text-xs text-ink-soft">🔒 You can reply once they message Growpefy on WhatsApp.</p>
        ) : a.open ? (
          <div>
            <div className="flex items-end gap-2">
              <textarea value={text} onChange={(e) => setText(e.target.value.slice(0, 1000))} rows={1} placeholder="Type a reply"
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); } }}
                className="input max-h-32 min-h-[44px] flex-1 resize-y py-2.5" />
              <button type="button" onClick={submit} disabled={busy || !text.trim()} className="btn-primary h-11 shrink-0 px-5">{busy ? <Spinner /> : "Send"}</button>
            </div>
            <p className="mt-1.5 text-[11px] text-ink-faint">Chat open for about {hoursLeft} more hour{hoursLeft === 1 ? "" : "s"}</p>
          </div>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-paper px-3 py-2.5">
            <p className="text-xs text-ink-soft">More than 24 hours since their last message. WhatsApp only allows an approved follow-up now.</p>
            {d.followupReady
              ? <button type="button" disabled={busy} onClick={() => send.submit({ intent: "followup", conversation: String(a.id) }, { method: "post" })} className="btn-secondary shrink-0">{busy ? <Spinner /> : "Send follow-up"}</button>
              : <span className="text-[11px] text-ink-faint">Follow-up template isn't set up yet</span>}
          </div>
        )}
      </div>
    </div>
  );
}

function Ticks({ s }: { s: string | null }) {
  if (s === "failed") return <span className="font-semibold text-bad" title="Not delivered">!</span>;
  if (s === "read") return <span className="text-sky-500" title="Read">✓✓</span>;
  if (s === "delivered") return <span title="Delivered">✓✓</span>;
  if (s === "sent") return <span title="Sent">✓</span>;
  return null;
}
