import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Link, useFetcher, useLoaderData, useRevalidator, useSearchParams } from "@remix-run/react";
import { and, asc, desc, eq, ilike, or } from "drizzle-orm";
import { useEffect, useRef, useState } from "react";
import { EmptyState, Notice, Spinner } from "~/components/ui";
import { db, waConversations, waMessages } from "~/db.server";
import { requireStore, requireViewer } from "~/lib/auth.server";
import { WINDOW_MS, sendFollowup, sendReply, storeConversation, windowOpen } from "~/lib/inbox.server";
import { messaging, waReady } from "~/lib/rto.server";
import { rupees } from "~/lib/wallet";
import { getWallet, ratesFor } from "~/lib/wallet.server";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const viewer = await requireViewer(request);
  const store = await requireStore(viewer, params.id);
  const url = new URL(request.url);
  const q = (url.searchParams.get("q") ?? "").trim().replace(/[%_]/g, "").slice(0, 40);
  const cid = Number(url.searchParams.get("c")) || null;
  const [convs, m, rates] = await Promise.all([
    db.select().from(waConversations)
      .where(and(eq(waConversations.storeId, store.id), q ? or(ilike(waConversations.phone, `%${q}%`), ilike(waConversations.name, `%${q}%`)) : undefined))
      .orderBy(desc(waConversations.lastMessageAt)).limit(100),
    messaging(), getWallet(store.id).then(ratesFor),
  ]);
  // Last message of each conversation, for the list
  const previews = new Map<number, { body: string; direction: string }>();
  for (const c of convs) {
    const [last] = await db.select({ body: waMessages.body, direction: waMessages.direction }).from(waMessages).where(eq(waMessages.conversationId, c.id)).orderBy(desc(waMessages.createdAt)).limit(1);
    if (last) previews.set(c.id, last);
  }
  let active = null as null | { id: number; name: string; phone: string; lastInboundAt: string | null; open: boolean; closesAt: string | null; messages: { id: number; direction: string; kind: string; body: string; status: string | null; sentBy: string | null; charged: number; at: string }[] };
  if (cid) {
    const c = await storeConversation(store.id, cid); // only this store's conversations
    if (c) {
      const msgs = await db.select().from(waMessages).where(eq(waMessages.conversationId, c.id)).orderBy(asc(waMessages.createdAt)).limit(300);
      if (c.unread) await db.update(waConversations).set({ unread: 0 }).where(eq(waConversations.id, c.id));
      active = {
        id: c.id, name: c.name, phone: c.phone, lastInboundAt: c.lastInboundAt?.toISOString() ?? null, open: windowOpen(c.lastInboundAt),
        closesAt: c.lastInboundAt ? new Date(c.lastInboundAt.getTime() + WINDOW_MS).toISOString() : null,
        messages: msgs.map((x) => ({ id: x.id, direction: x.direction, kind: x.kind, body: x.body, status: x.status, sentBy: x.sentBy, charged: x.chargedPaise, at: x.createdAt.toISOString() })),
      };
    }
  }
  return json({
    storeId: store.id, ready: waReady(m), followupReady: Boolean(m.waFollowupTemplate),
    price: { reply: rates.waReply ?? 7, followup: rates.waFollowup ?? 150 },
    conversations: convs.map((c) => ({ id: c.id, name: c.name, phone: c.phone, unread: c.id === active?.id ? 0 : c.unread, at: c.lastMessageAt.toISOString(), open: windowOpen(c.lastInboundAt), replied: Boolean(c.lastInboundAt), preview: previews.get(c.id) ?? null })),
    active,
  });
}

export async function action({ request, params }: ActionFunctionArgs) {
  const viewer = await requireViewer(request);
  const store = await requireStore(viewer, params.id);
  const fd = await request.formData();
  const conv = Number(fd.get("conversation"));
  const by = viewer.role === "admin" ? (viewer.staff ? `${viewer.staff.name} (Growpefy)` : "Growpefy admin") : (viewer.member?.name ?? viewer.name);
  const r = fd.get("intent") === "followup" ? await sendFollowup(store, conv, by) : await sendReply(store, conv, String(fd.get("text") ?? ""), by);
  return json(r, { status: r.ok ? 200 : 400 });
}

const time = (iso: string) => {
  const d = new Date(iso);
  const today = new Date().toDateString() === d.toDateString();
  return today ? d.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" }) : d.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
};
const masked = (p: string) => `+91 ${p.slice(0, 5)} ${p.slice(5)}`;

export default function Inbox() {
  const d = useLoaderData<typeof loader>();
  const [params, setParams] = useSearchParams();
  const revalidator = useRevalidator();
  // New messages arrive through the webhook: refresh every few seconds while the page is open
  useEffect(() => {
    const t = setInterval(() => { if (document.visibilityState === "visible" && revalidator.state === "idle") revalidator.revalidate(); }, 8000);
    return () => clearInterval(t);
  }, [revalidator]);
  const open = (id: number) => { const p = new URLSearchParams(params); p.set("c", String(id)); setParams(p, { preventScrollReset: true }); };

  return (
    <div className="space-y-4">
      {!d.ready && <Notice tone="warning">WhatsApp isn't set up yet, so no conversations will appear. It's switched on by Growpefy in Messaging settings.</Notice>}
      <div className="panel grid h-[calc(100vh-220px)] min-h-[520px] overflow-hidden lg:grid-cols-[340px_minmax(0,1fr)]">
        {/* Conversation list */}
        <div className={`flex min-h-0 flex-col border-rule lg:border-r ${d.active ? "hidden lg:flex" : "flex"}`}>
          <div className="border-b border-rule p-3">
            <input type="search" defaultValue={params.get("q") ?? ""} placeholder="Search name or number" className="input py-2 text-sm"
              onChange={(e) => { const p = new URLSearchParams(params); if (e.target.value) p.set("q", e.target.value); else p.delete("q"); setParams(p, { replace: true }); }} />
          </div>
          <ul className="scroll-thin min-h-0 flex-1 overflow-y-auto">
            {d.conversations.length === 0 && (
              <li className="p-6"><EmptyState title="No conversations yet">Chats appear here after customers get an order message on WhatsApp.</EmptyState></li>
            )}
            {d.conversations.map((c) => (
              <li key={c.id}>
                <button type="button" onClick={() => open(c.id)}
                  className={`flex w-full items-start gap-3 border-b border-rule px-3.5 py-3 text-left transition hover:bg-paper ${d.active?.id === c.id ? "bg-pine-tint/50" : ""}`}>
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-sm font-semibold text-emerald-800">{(c.name || "#").slice(0, 1).toUpperCase()}</span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center justify-between gap-2">
                      <span className="truncate text-sm font-semibold">{c.name || masked(c.phone)}</span>
                      <span className="shrink-0 text-[11px] text-ink-faint">{time(c.at)}</span>
                    </span>
                    <span className="flex items-center justify-between gap-2">
                      <span className={`truncate text-xs ${c.unread ? "font-medium text-ink" : "text-ink-soft"}`}>{c.preview ? `${c.preview.direction === "out" ? "You: " : ""}${c.preview.body.split("\n")[0]}` : ""}</span>
                      {c.unread > 0 && <span className="num flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-emerald-600 px-1.5 text-[11px] font-semibold text-white">{c.unread}</span>}
                    </span>
                    <span className="mt-0.5 block text-[10px] text-ink-faint">{c.open ? "🟢 Chat open" : c.replied ? "24 h window closed" : "Waiting for customer"}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>

        {/* Thread */}
        {d.active ? <Thread key={d.active.id} d={d} onBack={() => { const p = new URLSearchParams(params); p.delete("c"); setParams(p); }} /> : (
          <div className="hidden items-center justify-center bg-[#efeae2] lg:flex">
            <p className="rounded-lg bg-surface/90 px-4 py-2 text-sm text-ink-soft">Choose a conversation</p>
          </div>
        )}
      </div>
      <p className="text-xs text-ink-faint">
        Only customers who got an order message from your store show here. You can reply after the customer messages you:
        within 24 hours of their last message a reply costs {rupees(d.price.reply)}; after that you can send a follow-up asking them to reply ({rupees(d.price.followup)}). Charged from your wallet.
      </p>
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

  return (
    <div className="flex min-h-0 flex-col">
      <header className="flex items-center gap-3 border-b border-rule bg-surface px-4 py-3">
        <button type="button" onClick={onBack} className="text-ink-soft lg:hidden" aria-label="Back">←</button>
        <span className="flex h-9 w-9 items-center justify-center rounded-full bg-emerald-100 text-sm font-semibold text-emerald-800">{(a.name || "#").slice(0, 1).toUpperCase()}</span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">{a.name || masked(a.phone)}</p>
          <p className="num text-xs text-ink-faint">{masked(a.phone)}</p>
        </div>
        <Link to={`/dashboard/orders?q=${a.phone}`} className="text-xs font-medium text-pine hover:underline">Orders →</Link>
      </header>

      <div className="scroll-thin min-h-0 flex-1 space-y-2 overflow-y-auto bg-[#efeae2] px-4 py-4">
        {a.messages.map((m) => (
          <div key={m.id} className={`flex ${m.direction === "out" ? "justify-end" : "justify-start"}`}>
            <div className={`max-w-[78%] rounded-lg px-3 py-2 text-sm shadow-sm ${m.direction === "out" ? (m.kind === "template" || m.kind === "followup" ? "bg-[#d9fdd3] ring-1 ring-emerald-200" : "bg-[#d9fdd3]") : "bg-white"}`}>
              {(m.kind === "template" || m.kind === "auto" || m.kind === "followup") && (
                <p className="mb-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-700">{m.kind === "template" ? "Order message" : m.kind === "auto" ? "Automatic reply" : "Follow-up"}</p>
              )}
              <p className="whitespace-pre-wrap break-words text-ink">{m.body}</p>
              <p className="mt-1 flex items-center justify-end gap-1.5 text-[10px] text-ink-faint">
                {m.direction === "out" && m.sentBy && <span>{m.sentBy} ·</span>}
                {m.charged > 0 && <span>{rupees(m.charged)} ·</span>}
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
          <p className="rounded-lg bg-paper px-3 py-2.5 text-center text-xs text-ink-soft">🔒 You can reply once the customer messages you on WhatsApp.</p>
        ) : a.open ? (
          <div>
            <div className="flex items-end gap-2">
              <textarea value={text} onChange={(e) => setText(e.target.value.slice(0, 1000))} rows={1} placeholder="Type a reply"
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); } }}
                className="input max-h-32 min-h-[44px] flex-1 resize-y py-2.5" />
              <button type="button" onClick={submit} disabled={busy || !text.trim()} className="btn-primary h-11 shrink-0 px-5">{busy ? <Spinner /> : "Send"}</button>
            </div>
            <p className="mt-1.5 text-[11px] text-ink-faint">{rupees(d.price.reply)} per reply · chat open for about {hoursLeft} more hour{hoursLeft === 1 ? "" : "s"}</p>
          </div>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-paper px-3 py-2.5">
            <p className="text-xs text-ink-soft">More than 24 hours since the customer's last message. WhatsApp only allows an approved follow-up now.</p>
            {d.followupReady
              ? <button type="button" disabled={busy} onClick={() => send.submit({ intent: "followup", conversation: String(a.id) }, { method: "post" })} className="btn-secondary shrink-0">{busy ? <Spinner /> : `Send follow-up · ${rupees(d.price.followup)}`}</button>
              : <span className="text-[11px] text-ink-faint">Follow-up isn't set up yet</span>}
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
