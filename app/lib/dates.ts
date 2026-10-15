// Date ranges in IST (Asia/Kolkata), as YYYY-MM-DD strings.

export const PRESETS = [
  { id: "today", label: "Today" },
  { id: "yesterday", label: "Yesterday" },
  { id: "7d", label: "Last 7 days" },
  { id: "30d", label: "Last 30 days" },
  { id: "this_month", label: "This month" },
  { id: "last_month", label: "Last month" },
  { id: "max", label: "All time" },
] as const;

export type PresetId = (typeof PRESETS)[number]["id"] | "custom";
export type Range = { preset: PresetId; since: string; until: string };
export type Granularity = "hour" | "day" | "month";

const ISO = /^\d{4}-\d{2}-\d{2}$/;

export function istToday(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(now);
}

export function addDays(d: string, n: number) {
  const t = new Date(`${d}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
}

export function daysBetween(a: string, b: string) {
  return Math.round((new Date(`${b}T00:00:00Z`).getTime() - new Date(`${a}T00:00:00Z`).getTime()) / 86400_000) + 1;
}

/** Default is today. `earliest` is used for "All time". */
export function resolveRange(params: URLSearchParams, earliest?: string): Range {
  const t = istToday();
  const preset = params.get("range") ?? "today";
  const since = params.get("from");
  const until = params.get("to");
  const firstOfMonth = `${t.slice(0, 7)}-01`;
  switch (preset) {
    case "yesterday": { const d = addDays(t, -1); return { preset, since: d, until: d }; }
    case "7d": return { preset, since: addDays(t, -6), until: t };
    case "30d": return { preset, since: addDays(t, -29), until: t };
    case "this_month": return { preset, since: firstOfMonth, until: t };
    case "last_month": { const end = addDays(firstOfMonth, -1); return { preset, since: `${end.slice(0, 7)}-01`, until: end }; }
    case "max": return { preset, since: earliest && earliest < t ? earliest : t, until: t };
    case "custom":
      if (since && until && ISO.test(since) && ISO.test(until) && since <= until && until <= t) return { preset, since, until };
      return { preset: "today", since: t, until: t };
    default: return { preset: "today", since: t, until: t };
  }
}

export function granularityFor(r: Range): Granularity {
  const days = daysBetween(r.since, r.until);
  if (days <= 2) return "hour";
  if (days <= 92) return "day";
  return "month";
}

/** Bucket keys in IST: hour "YYYY-MM-DD HH", day "YYYY-MM-DD", month "YYYY-MM". */
export function bucketKeys(r: Range, g: Granularity) {
  const out: string[] = [];
  if (g === "hour") {
    for (let d = r.since; d <= r.until; d = addDays(d, 1)) for (let h = 0; h < 24; h++) out.push(`${d} ${String(h).padStart(2, "0")}`);
  } else if (g === "day") {
    for (let d = r.since; d <= r.until && out.length < 400; d = addDays(d, 1)) out.push(d);
  } else {
    let [y, m] = r.since.split("-").map(Number);
    const [ey, em] = r.until.split("-").map(Number);
    while ((y < ey || (y === ey && m <= em)) && out.length < 240) {
      out.push(`${y}-${String(m).padStart(2, "0")}`);
      m++; if (m > 12) { m = 1; y++; }
    }
  }
  return out;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function bucketLabel(key: string, g: Granularity, long = false) {
  if (g === "hour") {
    const [d, h] = key.split(" ");
    const hr = Number(h);
    const t = `${((hr + 11) % 12) + 1}${hr < 12 ? "am" : "pm"}`;
    return long ? `${dayLabel(d)}, ${t}` : t;
  }
  if (g === "day") return dayLabel(key);
  const [y, m] = key.split("-").map(Number);
  return `${MONTHS[m - 1]} ${long ? y : String(y).slice(2)}`;
}

function dayLabel(d: string) {
  const [, m, day] = d.split("-").map(Number);
  return `${day} ${MONTHS[m - 1]}`;
}

export function rangeLabel(r: Range) {
  const p = PRESETS.find((x) => x.id === r.preset);
  if (p) return p.label;
  if (r.since === r.until) return dayLabel(r.since) + " " + r.since.slice(0, 4);
  return `${dayLabel(r.since)} ${r.since.slice(0, 4)} – ${dayLabel(r.until)} ${r.until.slice(0, 4)}`;
}
