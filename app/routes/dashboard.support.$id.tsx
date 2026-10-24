// One complaint: chat-style thread between the store owner and Growpefy support.
import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Form, Link, useActionData, useLoaderData, useNavigation } from "@remix-run/react";
import { useEffect, useRef } from "react";
import { Icon } from "~/components/Icons";
import { Notice } from "~/components/ui";
import { requireViewer } from "~/lib/auth.server";
import { TICKET_CHIP, TICKET_STATUS, reasonLabel } from "~/lib/support";
import { getTicket, replyTicket } from "~/lib/support.server";

export const meta: MetaFunction<typeof loader> = ({ data }) => [{ title: `${data ? `#${data.ticket.id} ${data.ticket.subject}` : "Complaint"} · Growpefy` }, { name: "robots", content: "noindex" }];

export async function loader({ request, params }: LoaderFunctionArgs) {
  const v = await requireViewer(request);
  const r = await getTicket(v, Number(params.id));
  if (!r) throw new Response("Complaint not found", { status: 404 });
  const t = r.ticket;
  return json({
    admin: v.role === "admin",
    ticket: { ...t, createdAt: t.createdAt.toISOString(), updatedAt: t.updatedAt.toISOString(), ownerSeenAt: null, adminSeenAt: null },
    messages: r.messages.map((m) => ({ id: m.id, by: m.by, author: m.authorName, body: m.body, at: m.createdAt.toISOString() })),
  });
}

export async function action({ request, params }: ActionFunctionArgs) {
  const v = await requireViewer(request);
  return json(await replyTicket(v, Number(params.id), await request.formData()));
}

const when = (iso: string) => new Date(iso).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

export default function Ticket() {
  const { admin, ticket: t, messages } = useLoaderData<typeof loader>();
  const a = useActionData<typeof action>();
  const nav = useNavigation();
  const busy = nav.state !== "idle";
  const form = useRef<HTMLFormElement>(null);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => { if (a?.ok) form.current?.reset(); }, [a]);
  useEffect(() => { end.current?.scrollIntoView({ block: "end" }); }, [messages.length]);
  const closed = t.status === "closed" || t.status === "resolved";
  const err = a && !a.ok ? a.errors : null;
  return (
    <div className="mx-auto max-w-3xl">
      <Link to={admin ? "/dashboard/support?tab=complaints" : "/dashboard/support"} className="inline-flex items-center gap-1 text-sm text-ink-soft hover:text-ink"><Icon name="chevron" className="h-4 w-4 rotate-90" />{admin ? "Support inbox" : "Help & support"}</Link>
      <div className="mt-3 flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="text-[22px] font-semibold leading-tight tracking-tight"><span className="num text-ink-faint">#{t.id}</span> {t.subject}</h1>
          <p className="mt-1 text-sm text-ink-soft">{reasonLabel(t.category)}{t.storeName ? ` · ${t.storeName}` : ""} · raised {when(t.createdAt)}</p>
          {admin && (
            <p className="mt-1 flex flex-wrap items-center gap-x-3 text-sm text-ink-soft">
              <span className="font-medium text-ink">{t.ownerName}</span>
              {t.ownerPhone && <a href={`tel:+91${t.ownerPhone}`} className="inline-flex items-center gap-1 text-pine hover:underline"><Icon name="phone" className="h-3.5 w-3.5" />+91 {t.ownerPhone}</a>}
              {t.ownerEmail && <a href={`mailto:${t.ownerEmail}`} className="inline-flex items-center gap-1 text-pine hover:underline"><Icon name="mail" className="h-3.5 w-3.5" />{t.ownerEmail}</a>}
            </p>
          )}
        </div>
        <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${TICKET_CHIP[t.status] ?? TICKET_CHIP.open}`}>{TICKET_STATUS[t.status as keyof typeof TICKET_STATUS] ?? t.status}</span>
      </div>

      <div className="panel mt-5 space-y-4 p-4 sm:p-5">
        {messages.map((m) => {
          const mine = admin ? m.by === "admin" : m.by === "owner";
          return (
            <div key={m.id} className={`flex animate-fadein gap-2.5 ${mine ? "flex-row-reverse" : ""}`}>
              <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${m.by === "admin" ? "bg-pine text-white" : "bg-sky-100 text-sky-800"}`}>
                {m.by === "admin" ? <Icon name="help" className="h-4 w-4" /> : m.author.slice(0, 1).toUpperCase()}
              </span>
              <div className={`max-w-[85%] ${mine ? "text-right" : ""}`}>
                <p className="text-[11px] text-ink-faint">{m.author} · {when(m.at)}</p>
                <div className={`mt-1 inline-block whitespace-pre-wrap break-words rounded-2xl px-3.5 py-2.5 text-left text-sm leading-relaxed ${mine ? "rounded-tr-md bg-ink text-white" : "rounded-tl-md bg-paper-sunk text-ink"}`}>{m.body}</div>
              </div>
            </div>
          );
        })}
        <div ref={end} />
      </div>

      {a?.ok && <div className="mt-3"><Notice tone="success">{a.message}</Notice></div>}
      {err?.form && <div className="mt-3"><Notice tone="error">{err.form}</Notice></div>}

      <Form method="post" ref={form} className="panel mt-3 space-y-3 p-4">
        {!admin && closed && <p className="text-xs text-ink-soft">This complaint is {t.status}. Writing a message opens it again.</p>}
        <textarea name="body" rows={3} className="input" maxLength={4000} placeholder={admin ? "Reply to the store…" : "Add details or reply…"} aria-invalid={Boolean(err?.body) || undefined} />
        {err?.body && <span className="error-text">{err.body}</span>}
        <div className="flex flex-wrap items-center justify-end gap-2">
          {admin ? (
            <label className="mr-auto flex items-center gap-2 text-sm text-ink-soft">Status
              <select name="status" defaultValue={t.status === "open" ? "in_progress" : t.status} key={t.status} className="input h-9 w-auto py-0 text-sm">
                {Object.entries(TICKET_STATUS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select>
            </label>
          ) : !closed && (
            <button name="status" value="closed" className="btn-quiet mr-auto h-9 px-3 text-sm" disabled={busy}><Icon name="check" className="h-4 w-4" />Problem solved, close it</button>
          )}
          <button className="btn-primary h-9 px-4 text-sm" disabled={busy}><Icon name="send" className="h-4 w-4" />{busy ? "Sending…" : admin ? "Send & update" : "Send"}</button>
        </div>
      </Form>
    </div>
  );
}
