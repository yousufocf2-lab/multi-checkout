// Railway Usage (hosting bill): the resources a bill can have, and the sums. Shared by the super admin editor and the store page.
import type { UsageLine } from "~/db/schema";

export type UsageGroup = "compute" | "network" | "storage" | "plan" | "credit" | "other";
export type UsageResource = { key: string; label: string; unit: string; group: UsageGroup; hint: string };

/** What a hosting bill is made of (super admin fills quantity and price per unit). */
export const USAGE_RESOURCES: UsageResource[] = [
  { key: "vcpu", label: "Compute (vCPU)", unit: "vCPU-hour", group: "compute", hint: "Processor time used by the app server" },
  { key: "memory", label: "Memory (RAM)", unit: "GB-hour", group: "compute", hint: "RAM kept by the app server" },
  { key: "egress", label: "Network egress", unit: "GB", group: "network", hint: "Data sent out to shoppers and services" },
  { key: "volume", label: "Database storage", unit: "GB-month", group: "storage", hint: "Disk used by the database" },
  { key: "bucket", label: "Media storage", unit: "GB-month", group: "storage", hint: "Photos, videos and files" },
  { key: "bucket_ops", label: "Media requests", unit: "1,000 requests", group: "storage", hint: "Reads and uploads of media" },
  { key: "plan", label: "Plan fee", unit: "month", group: "plan", hint: "Fixed monthly fee" },
  { key: "credit", label: "Included usage", unit: "month", group: "credit", hint: "Usage included in the plan (enter as a minus price)" },
];

export const GROUP_LABEL: Record<UsageGroup, string> = {
  compute: "Compute", network: "Network", storage: "Storage", plan: "Plan", credit: "Credits", other: "Other",
};

export const resourceOf = (key: string): UsageResource =>
  USAGE_RESOURCES.find((r) => r.key === key) ?? { key, label: key, unit: "unit", group: "other", hint: "" };

/** Quantity × price per unit, in paise (a custom amount can be typed instead). */
export const lineAmount = (qty: number, ratePaise: number) => Math.round(qty * ratePaise);

export function usageTotals(lines: UsageLine[]) {
  const byGroup: Record<UsageGroup, number> = { compute: 0, network: 0, storage: 0, plan: 0, credit: 0, other: 0 };
  let usage = 0;
  for (const l of lines) {
    const g = resourceOf(l.key).group;
    byGroup[g] += l.amountPaise;
    if (g !== "plan" && g !== "credit") usage += l.amountPaise;
  }
  const total = lines.reduce((s, l) => s + l.amountPaise, 0);
  const egressGb = lines.filter((l) => l.key === "egress").reduce((s, l) => s + l.qty, 0);
  return { total: Math.max(0, total), usage, byGroup, egressGb };
}

export const STATUS_LABEL = { draft: "Draft", due: "Due", paid: "Paid" } as const;
