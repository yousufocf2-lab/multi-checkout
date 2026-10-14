// Date ranges in IST (Asia/Kolkata), as YYYY-MM-DD strings.

export const PRESETS = [
  { id: "today", label: "Today" },
  { id: "yesterday", label: "Yesterday" },
  { id: "7d", label: "7 days" },
  { id: "30d", label: "30 days" },
  { id: "this_month", label: "This month" },
  { id: "last_month", label: "Last month" },
  { id: "custom", label: "Custom" },
] as const;

export type PresetId = (typeof PRESETS)[number]["id"];

const ISO = /^\d{4}-\d{2}-\d{2}$/;

export function istToday(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(now); // YYYY-MM-DD
}

export function addDays(d: string, n: number) {
  const t = new Date(`${d}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
}

export function resolveRange(preset: string | null, since?: string | null, until?: string | null) {
  const t = istToday();
  const [y, m] = t.split("-").map(Number);
  const firstOfMonth = `${t.slice(0, 7)}-01`;
  const p = (PRESETS.some((x) => x.id === preset) ? preset : "7d") as PresetId;
  switch (p) {
    case "today": return { preset: p, since: t, until: t };
    case "yesterday": { const d = addDays(t, -1); return { preset: p, since: d, until: d }; }
    case "30d": return { preset: p, since: addDays(t, -29), until: t };
    case "this_month": return { preset: p, since: firstOfMonth, until: t };
    case "last_month": {
      const lmEnd = addDays(firstOfMonth, -1);
      const lmStart = `${lmEnd.slice(0, 7)}-01`;
      void y; void m;
      return { preset: p, since: lmStart, until: lmEnd };
    }
    case "custom": {
      if (since && until && ISO.test(since) && ISO.test(until) && since <= until && until <= t) {
        return { preset: p, since, until };
      }
      return { preset: "7d" as PresetId, since: addDays(t, -6), until: t };
    }
    default: return { preset: "7d" as PresetId, since: addDays(t, -6), until: t };
  }
}

export function eachDay(since: string, until: string) {
  const out: string[] = [];
  for (let d = since; d <= until && out.length < 400; d = addDays(d, 1)) out.push(d);
  return out;
}
