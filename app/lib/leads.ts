// Growpefy's own sales leads (admin only): statuses, demo slot rules. Safe for the browser.

export const LEAD_STATUSES = [
  { id: "new", label: "New", tone: "bg-sky-50 text-sky-800" },
  { id: "no_answer", label: "Didn't pick up", tone: "bg-amber-50 text-amber-800" },
  { id: "busy", label: "Busy", tone: "bg-amber-50 text-amber-800" },
  { id: "not_reachable", label: "Switched off / not reachable", tone: "bg-amber-50 text-amber-800" },
  { id: "call_back", label: "Call back later", tone: "bg-violet-50 text-violet-800" },
  { id: "demo_scheduled", label: "Demo scheduled", tone: "bg-emerald-50 text-good" },
  { id: "demo_done", label: "Demo done", tone: "bg-emerald-50 text-good" },
  { id: "customer", label: "Became a customer", tone: "bg-pine text-white" },
  { id: "not_interested", label: "Not interested", tone: "bg-paper-sunk text-ink-soft" },
  { id: "wrong_number", label: "Wrong number", tone: "bg-red-50 text-bad" },
] as const;
export type LeadStatus = (typeof LEAD_STATUSES)[number]["id"];
export const statusOf = (id: string | null | undefined) => LEAD_STATUSES.find((s) => s.id === id) ?? LEAD_STATUSES[0];
export const isLeadStatus = (v: string): v is LeadStatus => LEAD_STATUSES.some((s) => s.id === v);

/** A demo takes 30 minutes; no other demo may start within 30 minutes of it (4:00 booked → 3:31–4:30 blocked). */
export const DEMO_MINUTES = 30;
export const slotsClash = (a: Date, b: Date) => Math.abs(a.getTime() - b.getTime()) <= DEMO_MINUTES * 60_000;

export type LeadKind = "meta" | "callback" | "signup";
export const KIND_LABEL: Record<LeadKind, string> = { meta: "Meta lead form", callback: "Website callback", signup: "Signup" };

/** "meta-123", "callback-45", "signup-7" ⇄ kind + id */
export const leadKey = (kind: LeadKind, id: string | number) => `${kind}-${id}`;
export function parseLeadKey(key: string): { kind: LeadKind; id: string } | null {
  const m = /^(meta|callback|signup)-([\w.-]{1,64})$/.exec(key);
  return m ? { kind: m[1] as LeadKind, id: m[2] } : null;
}

export const SOURCE_TAGS = {
  meta: { label: "Meta", color: "#0866FF" },
  google: { label: "Google", color: "#F2A900" },
  organic: { label: "Organic", color: "#1BAF7A" },
  direct: { label: "Direct", color: "#64748B" },
  other: { label: "Other", color: "#8B5CF6" },
} as const;
export type SourceTag = keyof typeof SOURCE_TAGS;

const IST = { timeZone: "Asia/Kolkata" } as const;
/** "Today 4:00 pm", "Tomorrow 11:30 am", "Wed 29 Oct, 4:00 pm" */
export function demoLabel(iso: string, now = new Date()) {
  const d = new Date(iso);
  const day = (x: Date) => new Intl.DateTimeFormat("en-CA", IST).format(x);
  const time = d.toLocaleTimeString("en-IN", { ...IST, hour: "numeric", minute: "2-digit" });
  const tomorrow = new Date(now.getTime() + 86_400_000);
  if (day(d) === day(now)) return `Today ${time}`;
  if (day(d) === day(tomorrow)) return `Tomorrow ${time}`;
  return `${d.toLocaleDateString("en-IN", { ...IST, weekday: "short", day: "numeric", month: "short" })}, ${time}`;
}

/** Work queues on the Leads page, so leads someone already handled don't keep coming back. */
export const LEAD_TABS = [
  { id: "new", label: "New", hint: "Nobody has worked on these yet" },
  { id: "followup", label: "Follow-up", hint: "Call back, not reachable, demos" },
  { id: "done", label: "Done", hint: "Customer, not interested, wrong number" },
  { id: "all", label: "All", hint: "Every lead" },
] as const;
export type LeadTab = (typeof LEAD_TABS)[number]["id"];
const DONE = ["customer", "not_interested", "wrong_number"];
export function leadTab(l: { status: string; notesCount: number }): Exclude<LeadTab, "all"> {
  if (DONE.includes(l.status)) return "done";
  if (l.status === "new" && l.notesCount === 0) return "new";
  return "followup";
}

export type LeadFilter = { tab: LeadTab; st: string; src: string; k: string; q: string };
export function readLeadFilter(sp: URLSearchParams): LeadFilter {
  const tab = sp.get("tab");
  return {
    tab: LEAD_TABS.some((t) => t.id === tab) ? (tab as LeadTab) : "new",
    st: sp.get("st") ?? "all", src: sp.get("src") ?? "all", k: sp.get("k") ?? "all", q: (sp.get("q") ?? "").trim().toLowerCase(),
  };
}
export function matchLead(l: { status: string; notesCount: number; source: string; kind: string; name: string; phone: string | null; email: string | null }, f: LeadFilter, ignoreTab = false) {
  return (ignoreTab || f.tab === "all" || leadTab(l) === f.tab) &&
    (f.st === "all" || l.status === f.st) &&
    (f.src === "all" || l.source === f.src) &&
    (f.k === "all" || l.kind === f.k) &&
    (!f.q || `${l.name} ${l.phone ?? ""} ${l.email ?? ""}`.toLowerCase().includes(f.q));
}

/** "2h ago", "3d ago" */
export function agoLabel(iso: string, now = Date.now()) {
  const m = Math.max(1, Math.round((now - new Date(iso).getTime()) / 60_000));
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  return h < 24 ? `${h}h ago` : `${Math.round(h / 24)}d ago`;
}
