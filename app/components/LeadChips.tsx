import { SOURCE_TAGS, statusOf, type SourceTag } from "~/lib/leads";

export function SourceTagChip({ s }: { s: SourceTag }) {
  const t = SOURCE_TAGS[s];
  return <span className="inline-flex items-center gap-1.5 rounded-full border border-rule bg-white px-2 py-0.5 text-[11px] font-semibold"><span className="h-2 w-2 rounded-full" style={{ background: t.color }} />{t.label}</span>;
}

export function StatusChip({ s }: { s: string }) {
  const t = statusOf(s);
  return <span className={`inline-flex whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium ${t.tone}`}>{t.label}</span>;
}
