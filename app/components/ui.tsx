import { Form, Link, useNavigation } from "@remix-run/react";
import { useEffect, useState } from "react";
import { Icon, type IconName } from "~/components/Icons";
import { guideFor } from "~/lib/guides";
import { useBodyScrollLock } from "./useBodyScrollLock";

export function Spinner({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg className={`animate-spin ${className}`} viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity=".25" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

/** Submit button that shows a spinner while its own form (by intent) is submitting. */
export function SubmitButton({
  children, intent, className = "btn-primary", busyText, ...rest
}: { intent?: string; busyText?: string } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const nav = useNavigation();
  const busy = nav.state === "submitting" && (!intent || nav.formData?.get("intent") === intent);
  return (
    <button type="submit" name={intent ? "intent" : undefined} value={intent} className={className} disabled={busy || rest.disabled} {...rest}>
      {busy && <Spinner />}
      {busy && busyText ? busyText : children}
    </button>
  );
}

export function Field({ label, hint, error, className = "", children }: { label: string; hint?: React.ReactNode; error?: string; className?: string; children: React.ReactNode }) {
  return (
    <label className={`block ${className}`}>
      <span className="label">{label}</span>
      {children}
      {error ? <span className="error-text">{error}</span> : hint ? <span className="hint">{hint}</span> : null}
    </label>
  );
}

export function TextField({ label, hint, error, wrap, ...rest }: { label: string; hint?: React.ReactNode; error?: string; wrap?: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <Field label={label} hint={hint} error={error} className={wrap}>
      {rest.type === "password"
        ? <PasswordInput aria-invalid={Boolean(error) || undefined} {...rest} />
        : <input className="input" aria-invalid={Boolean(error) || undefined} {...rest} />}
    </Field>
  );
}

/** Password box with an eye button to show / hide what's typed. */
export function PasswordInput({ className = "input", ...rest }: Omit<React.InputHTMLAttributes<HTMLInputElement>, "type">) {
  const [show, setShow] = useState(false);
  return (
    <span className="relative block">
      <input {...rest} type={show ? "text" : "password"} className={`${className} pr-11`} />
      <button type="button" onClick={() => setShow((v) => !v)} aria-label={show ? "Hide password" : "Show password"} aria-pressed={show} title={show ? "Hide" : "Show"}
        className="absolute inset-y-0 right-0 flex w-11 items-center justify-center rounded-r-lg text-ink-faint transition hover:text-ink focus-visible:text-ink focus-visible:outline-none">
        <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          {show
            ? <path d="M3 3l18 18M10.6 5.1A10 10 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-3.2 4.2M6.6 6.6C3.8 8.4 2 12 2 12s3.5 7 10 7a9.7 9.7 0 0 0 5.4-1.6M9.9 9.9a3 3 0 0 0 4.2 4.2" />
            : <><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" /></>}
        </svg>
      </button>
    </span>
  );
}

export function SelectField({ label, hint, error, wrap, children, ...rest }: { label: string; hint?: string; error?: string; wrap?: string } & React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <Field label={label} hint={hint} error={error} className={wrap}>
      <select className="input" {...rest}>{children}</select>
    </Field>
  );
}

/** Accessible switch that submits "on" like a checkbox. */
export function Toggle({ name, label, description, defaultChecked }: { name: string; label: string; description?: string; defaultChecked?: boolean }) {
  const [on, setOn] = useState(Boolean(defaultChecked));
  return (
    <label className="flex cursor-pointer items-start justify-between gap-4 py-1">
      <span>
        <span className="block text-sm font-medium text-ink">{label}</span>
        {description && <span className="mt-0.5 block text-xs text-ink-faint">{description}</span>}
      </span>
      <input type="checkbox" name={name} checked={on} onChange={(e) => setOn(e.target.checked)} className="peer sr-only" />
      <span aria-hidden className={`relative mt-0.5 h-6 w-10 shrink-0 rounded-full transition peer-focus-visible:ring-2 peer-focus-visible:ring-brand ${on ? "bg-brand" : "bg-rule-strong"}`}>
        <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${on ? "left-[18px]" : "left-0.5"}`} />
      </span>
    </label>
  );
}

export function Section({ title, description, children, aside, id }: { title: string; description?: React.ReactNode; children: React.ReactNode; aside?: React.ReactNode; id?: string }) {
  return (
    <section className="panel scroll-mt-6" id={id}>
      <header className="flex flex-wrap items-start justify-between gap-3 px-4 pb-1 pt-4">
        <div>
          <h2 className="text-[13.5px] font-semibold">{title}</h2>
          {description && <p className="mt-0.5 max-w-prose text-[12.5px] text-ink-soft">{description}</p>}
        </div>
        {aside}
      </header>
      <div className="p-4">{children}</div>
    </section>
  );
}

export function PageHeader({ title, description, actions, icon, back, guide }: { title: string; description?: React.ReactNode; actions?: React.ReactNode; icon?: IconName; back?: string; guide?: string }) {
  return (
    <div className="mb-4 flex min-h-[32px] flex-wrap items-center gap-x-3 gap-y-2">
      <div className="flex min-w-0 flex-1 items-center gap-2">
        {back && <Link to={back} className="-ml-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-ink-soft hover:bg-black/5 hover:text-ink" aria-label="Back"><Icon name="arrow" className="h-4 w-4 rotate-180" /></Link>}
        {icon && !back && <Icon name={icon} className="h-4 w-4 shrink-0 text-ink" strokeWidth={1.9} />}
        <h1 className="truncate text-[15px] font-semibold leading-tight tracking-tight">{title}</h1>
        {description && <p className="hidden min-w-0 truncate text-[12.5px] text-ink-faint md:block">{description}</p>}
      </div>
      {(actions || guide) && <div className="flex flex-wrap items-center gap-2">{guide && <LearnMore topic={guide} />}{actions}</div>}
    </div>
  );
}

/** “Learn more”: opens a side panel with a short step-by-step guide for this page. */
export function LearnMore({ topic, label = "Learn more", className = "" }: { topic: string; label?: string; className?: string }) {
  const [open, setOpen] = useState(false);
  useBodyScrollLock(open);
  const g = guideFor(topic);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);
  if (!g) return null;
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={`inline-flex h-[30px] items-center gap-1.5 rounded-lg px-2.5 text-[12.5px] font-medium text-ink-soft hover:bg-black/5 hover:text-ink ${className}`}>
        <Icon name="book" className="h-4 w-4" />{label}
      </button>
      {open && (
        <div className="fixed inset-0 z-[80] flex justify-end" role="dialog" aria-modal="true" aria-labelledby="guide-title">
          <button type="button" className="absolute inset-0 animate-fadein bg-black/25" onClick={() => setOpen(false)} aria-label="Close guide" />
          <aside className="relative flex h-full w-full max-w-[420px] animate-fadein flex-col bg-white shadow-[0_0_0_1px_rgba(0,0,0,.06),-24px_0_48px_-24px_rgba(0,0,0,.35)]">
            <header className="flex items-center gap-2 border-b border-rule px-4 py-3">
              <Icon name="book" className="h-4 w-4 text-ink-soft" />
              <h2 id="guide-title" className="flex-1 text-[14px] font-semibold">{g.title}</h2>
              <button type="button" onClick={() => setOpen(false)} className="flex h-7 w-7 items-center justify-center rounded-lg text-ink-soft hover:bg-black/5" aria-label="Close"><Icon name="close" className="h-4 w-4" /></button>
            </header>
            <div className="flex-1 overflow-y-auto overscroll-contain px-5 py-4 text-[13px] leading-relaxed">
              <p className="text-ink-soft">{g.intro}</p>
              {g.steps && (
                <ol className="mt-5 space-y-4">
                  {g.steps.map((s, i) => (
                    <li key={s.title} className="flex gap-3">
                      <span className="num flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-paper-sunk text-[12px] font-semibold">{i + 1}</span>
                      <div><p className="font-semibold text-ink">{s.title}</p><p className="mt-0.5 text-ink-soft">{s.text}</p></div>
                    </li>
                  ))}
                </ol>
              )}
              {g.tips && (
                <div className="mt-6 rounded-xl bg-paper-sunk p-4">
                  <p className="text-[12px] font-semibold uppercase tracking-wide text-ink-faint">Tips</p>
                  <ul className="mt-2 space-y-2">{g.tips.map((t) => <li key={t} className="flex gap-2 text-ink-soft"><span aria-hidden className="text-ink-faint">•</span>{t}</li>)}</ul>
                </div>
              )}
              {g.links && (
                <div className="mt-6 space-y-1">
                  {g.links.map((l) => (
                    <a key={l.href} href={l.href} target="_blank" rel="noreferrer" className="flex items-center justify-between rounded-lg px-3 py-2 font-medium text-ink shadow-[inset_0_0_0_1px_rgb(var(--rule))] hover:bg-paper">
                      {l.label}<Icon name="external" className="h-4 w-4 text-ink-faint" />
                    </a>
                  ))}
                </div>
              )}
            </div>
            <footer className="border-t border-rule px-5 py-3 text-[12.5px] text-ink-soft">
              Still stuck? <Link to="/dashboard/support" className="font-medium text-ink underline underline-offset-2" onClick={() => setOpen(false)}>Ask Growpefy support</Link>
            </footer>
          </aside>
        </div>
      )}
    </>
  );
}

const STATUS: Record<string, { label: string; cls: string; icon: string }> = {
  paid: { label: "Paid", cls: "bg-emerald-50 text-good", icon: "✓" },
  cod_placed: { label: "COD", cls: "bg-orange-50 text-warn", icon: "₹" },
  pending_payment: { label: "Awaiting payment", cls: "bg-paper-sunk text-ink-soft", icon: "…" },
  cod_placing: { label: "Processing", cls: "bg-paper-sunk text-ink-soft", icon: "…" },
  failed: { label: "Payment failed", cls: "bg-red-50 text-bad", icon: "!" },
  live: { label: "Live", cls: "bg-emerald-50 text-good", icon: "●" },
  off: { label: "Off", cls: "bg-paper-sunk text-ink-soft", icon: "○" },
};

export function StatusBadge({ status, label }: { status: string; label?: string }) {
  const s = STATUS[status] ?? { label: status, cls: "bg-paper-sunk text-ink-soft", icon: "•" };
  return (
    <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${s.cls}`}>
      <span aria-hidden>{s.icon}</span>
      {label ?? s.label}
    </span>
  );
}

export function Notice({ tone = "info", children }: { tone?: "info" | "success" | "error" | "warning"; children: React.ReactNode }) {
  const cls = {
    info: "border-transparent bg-[#eaf4ff] text-[#00366c] shadow-[0_0_0_1px_rgba(0,91,211,.18)]",
    success: "border-transparent bg-[#e4f9ec] text-[#0c5132] shadow-[0_0_0_1px_rgba(12,81,50,.18)]",
    error: "border-transparent bg-[#fee9e8] text-[#8e1f0b] shadow-[0_0_0_1px_rgba(142,31,11,.18)]",
    warning: "border-transparent bg-[#fff1e3] text-[#5e4200] shadow-[0_0_0_1px_rgba(178,132,0,.25)]",
  }[tone];
  return <div role={tone === "error" ? "alert" : "status"} className={`break-words rounded-xl border px-4 py-2.5 text-sm ${cls}`}>{children}</div>;
}

export function EmptyState({ title, children, action }: { title: string; children?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="panel flex flex-col items-center px-6 py-12 text-center">
      <p className="font-semibold">{title}</p>
      {children && <p className="mt-1 max-w-sm text-sm text-ink-soft">{children}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

/** Small inline form for row actions (enable/disable/delete). */
export function RowAction({ intent, id, label, danger, confirm }: { intent: string; id: number | string; label: string; danger?: boolean; confirm?: string }) {
  return (
    <Form method="post" onSubmit={(e) => { if (confirm && !window.confirm(confirm)) e.preventDefault(); }}>
      <input type="hidden" name="id" value={id} />
      <button name="intent" value={intent} className={danger ? "btn-danger" : "btn-quiet"}>{label}</button>
    </Form>
  );
}

export function CopyField({ label, value }: { label: string; value: string }) {
  const [done, setDone] = useState(false);
  return (
    <div>
      <span className="label">{label}</span>
      <div className="flex items-stretch overflow-hidden rounded-lg border border-rule-strong bg-paper">
        <code className="min-w-0 flex-1 truncate px-3 py-2.5 text-[13px]">{value}</code>
        <button type="button" className="border-l border-rule-strong bg-white px-3 text-sm font-medium hover:bg-paper"
          onClick={() => { navigator.clipboard.writeText(value); setDone(true); setTimeout(() => setDone(false), 1400); }}>
          {done ? "Copied" : "Copy"}
        </button>
      </div>
    </div>
  );
}

/** Cost per order / purchase quality: under ₹35 excellent, ₹35–59 good, ₹60–99 average, ₹100+ poor. */
export function costQuality(v: number | null | undefined) {
  if (v == null || !Number.isFinite(v) || v <= 0) return null;
  if (v < 35) return { label: "Excellent", cls: "bg-emerald-100 text-emerald-800", arrow: "▲" };
  if (v < 60) return { label: "Good", cls: "bg-emerald-50 text-good", arrow: "" };
  if (v < 100) return { label: "Average", cls: "bg-amber-50 text-amber-700", arrow: "" };
  return { label: "Poor", cls: "bg-red-50 text-bad", arrow: "▼" };
}

export function CostTag({ value, className = "" }: { value: number | null | undefined; className?: string }) {
  const q = costQuality(value);
  if (!q) return null;
  return (
    <span className={`inline-flex items-center gap-0.5 whitespace-nowrap rounded px-1.5 py-px align-middle text-[10.5px] font-semibold leading-4 ${q.cls} ${className}`} title="Under ₹35 excellent · ₹35–59 good · ₹60–99 average · ₹100+ poor">
      {q.arrow && <span aria-hidden className="text-[9px]">{q.arrow}</span>}{q.label}
    </span>
  );
}
