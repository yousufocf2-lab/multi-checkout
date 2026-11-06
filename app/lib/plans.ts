// Growpefy plans: the only three plans shown on the website and inside Growpefy.
// The transaction fee is charged on every order's value and billed on the monthly invoice.

export type PlanId = "starter" | "growth" | "pro";
export type Plan = { id: PlanId; name: string; monthlyRupees: number; feeBps: number; tagline: string; highlights: string[] };

export const PLANS: Plan[] = [
  { id: "starter", name: "Starter", monthlyRupees: 1000, feeBps: 200, tagline: "For new brands getting their first orders.",
    highlights: ["Online store and checkout", "COD, prepaid and all payment gateways", "Team logins and collaborators"] },
  { id: "growth", name: "Growth", monthlyRupees: 3000, feeBps: 100, tagline: "For brands running ads every day.",
    highlights: ["Everything in Starter", "Half the transaction fee", "Ads, funnel and profit reports"] },
  { id: "pro", name: "Pro", monthlyRupees: 10000, feeBps: 50, tagline: "For high-volume brands.",
    highlights: ["Everything in Growth", "Lowest transaction fee", "Priority support"] },
];

export const planById = (id: string | null | undefined) => PLANS.find((p) => p.id === id) ?? null;
export const feePct = (p: Pick<Plan, "feeBps">) => `${(p.feeBps / 100).toString()}%`;
export const rupeesLabel = (n: number) => `₹${n.toLocaleString("en-IN")}`;
