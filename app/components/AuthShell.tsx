import { BrandIcon, BrandLockup } from "./Brand";

export function AuthShell({ title, subtitle, children, footer }: { title: string; subtitle: string; children: React.ReactNode; footer?: React.ReactNode }) {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-4 py-10">
      <div className="w-full max-w-[400px]">
        <div className="mb-8"><BrandLockup className="h-9" /></div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        <p className="mt-1.5 text-sm text-ink-soft">{subtitle}</p>
        <div className="mt-6">{children}</div>
        {footer && <div className="mt-6 text-sm text-ink-soft">{footer}</div>}
      </div>
    </main>
  );
}

/** Small brand mark (kept for existing imports). */
export function Mark({ className = "h-7 w-7", tile = false }: { className?: string; tile?: boolean }) {
  return <BrandIcon className={className} tile={tile} />;
}
