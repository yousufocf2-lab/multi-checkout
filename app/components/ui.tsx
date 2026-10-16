import { Form, useNavigation } from "@remix-run/react";
import { useState } from "react";

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
      <input className="input" aria-invalid={Boolean(error) || undefined} {...rest} />
    </Field>
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
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-rule px-5 py-4">
        <div>
          <h2 className="text-[15px] font-semibold">{title}</h2>
          {description && <p className="mt-0.5 max-w-prose text-sm text-ink-soft">{description}</p>}
        </div>
        {aside}
      </header>
      <div className="p-5">{children}</div>
    </section>
  );
}

export function PageHeader({ title, description, actions }: { title: string; description?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-[22px] font-semibold leading-tight tracking-tight">{title}</h1>
        {description && <p className="mt-1 text-sm text-ink-soft">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
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
    info: "border-rule bg-paper-raised text-ink-soft",
    success: "border-emerald-200 bg-emerald-50 text-emerald-900",
    error: "border-red-200 bg-red-50 text-red-900",
    warning: "border-amber-200 bg-amber-50 text-amber-900",
  }[tone];
  return <div role={tone === "error" ? "alert" : "status"} className={`break-words rounded-lg border px-4 py-3 text-sm ${cls}`}>{children}</div>;
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
