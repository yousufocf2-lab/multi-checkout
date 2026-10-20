/** Green "verified" seal used for mobile, email and business (GST) checks. */
export function VerifiedBadge({ label = "Verified" }: { label?: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 ring-1 ring-emerald-200">
      <svg viewBox="0 0 24 24" className="h-3 w-3" fill="currentColor" aria-hidden><path d="M12 2 9.5 4.3 6.1 4l-.7 3.3L2.6 9.2 4 12.3l-1.4 3.1 2.8 1.9.7 3.3 3.4-.3L12 22.6l2.5-2.3 3.4.3.7-3.3 2.8-1.9-1.4-3.1 1.4-3.1-2.8-1.9-.7-3.3-3.4.3z" /><path d="m8.5 12.2 2.3 2.3 4.7-4.8" stroke="#fff" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>
      {label}
    </span>
  );
}
