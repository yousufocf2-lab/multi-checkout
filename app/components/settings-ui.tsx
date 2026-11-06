// Building blocks for settings pages: page header, cards with rows, and a modal dialog.
import { useEffect, useRef } from "react";
import { Icon, type IconName } from "./Icons";

export function SettingsHeader({ icon, title, children }: { icon: IconName; title: string; children?: React.ReactNode }) {
  return (
    <div className="mb-4 flex min-h-[32px] flex-wrap items-center gap-2">
      <Icon name={icon} className="h-4 w-4" strokeWidth={1.9} />
      <h1 className="flex-1 text-[15px] font-semibold">{title}</h1>
      {children}
    </div>
  );
}

export function Card({ title, description, action, children, className = "", flush }: {
  title?: string; description?: React.ReactNode; action?: React.ReactNode; children?: React.ReactNode; className?: string; flush?: boolean;
}) {
  return (
    <section className={`panel overflow-hidden ${className}`}>
      {(title || action) && (
        <header className="flex items-start gap-3 px-4 pb-2 pt-3.5">
          <div className="min-w-0 flex-1">
            {title && <h2 className="text-[13.5px] font-semibold">{title}</h2>}
            {description && <p className="mt-0.5 text-[12.5px] text-ink-soft">{description}</p>}
          </div>
          {action}
        </header>
      )}
      {children && <div className={flush ? "" : "px-4 pb-4"}>{children}</div>}
    </section>
  );
}

/** A clickable summary row inside a card (icon, title, detail, chevron). */
export function RowButton({ icon, title, detail, onClick, trailing }: { icon?: React.ReactNode; title: React.ReactNode; detail?: React.ReactNode; onClick?: () => void; trailing?: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} className="flex w-full items-center gap-3 rounded-[10px] px-3 py-2.5 text-left shadow-[0_0_0_1px_rgba(0,0,0,.08)] transition hover:bg-[#f7f7f7]">
      {icon && <span className="flex h-8 w-8 shrink-0 items-center justify-center text-[18px] text-ink-soft">{icon}</span>}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-medium">{title}</span>
        {detail && <span className="block truncate text-[12px] text-ink-soft">{detail}</span>}
      </span>
      {trailing}
      <Icon name="chevron" className="h-3.5 w-3.5 -rotate-90 text-ink-faint" />
    </button>
  );
}

/** Centered modal. Children usually hold a <Form>; footer buttons can submit it with form="...". */
export function Dialog({ open, onClose, title, children, footer, wide }: { open: boolean; onClose: () => void; title: string; children: React.ReactNode; footer?: React.ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", esc);
    const first = ref.current?.querySelector<HTMLElement>("input:not([type=hidden]), select, textarea");
    first?.focus();
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", esc); document.body.style.overflow = prev; };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={ref} role="dialog" aria-modal="true" aria-label={title}
        className={`flex max-h-[92vh] w-full flex-col overflow-hidden rounded-t-2xl bg-white shadow-[0_0_0_1px_rgba(0,0,0,.08),0_24px_48px_-12px_rgba(0,0,0,.35)] sm:rounded-2xl ${wide ? "sm:max-w-[680px]" : "sm:max-w-[520px]"}`}>
        <div className="flex items-center gap-2 border-b border-rule bg-[#f7f7f7] px-4 py-3">
          <h2 className="flex-1 text-[13.5px] font-semibold">{title}</h2>
          <button type="button" onClick={onClose} className="flex h-7 w-7 items-center justify-center rounded-lg text-ink-soft hover:bg-black/5" aria-label="Close"><Icon name="close" className="h-4 w-4" /></button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">{children}</div>
        {footer && <div className="flex items-center justify-end gap-2 border-t border-rule px-4 py-3">{footer}</div>}
      </div>
    </div>
  );
}

/** Compact label + control used inside dialogs. */
export function Field({ label, hint, error, children, className = "" }: { label: string; hint?: React.ReactNode; error?: string; children: React.ReactNode; className?: string }) {
  return (
    <label className={`block ${className}`}>
      <span className="label block">{label}</span>
      {children}
      {hint && !error && <span className="hint mt-1 block text-ink-faint">{hint}</span>}
      {error && <span className="error-text mt-1 block">{error}</span>}
    </label>
  );
}
