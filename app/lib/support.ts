// Help & support: shared by the website, the store dashboard and the admin inbox.

export const CALLBACK_REASONS = [
  { id: "sales", label: "Sales · new account or demo" },
  { id: "onboarding", label: "Setup & onboarding" },
  { id: "account", label: "Account & login" },
  { id: "checkout", label: "Checkout not opening / not working" },
  { id: "payments", label: "Payment gateway & settlements" },
  { id: "orders", label: "Orders & Shopify sync" },
  { id: "rto", label: "RTO Suite & RTO Shield" },
  { id: "logistics", label: "Couriers & logistics" },
  { id: "wallet", label: "Wallet, recharge & GST invoice" },
  { id: "ads", label: "Meta ads & analytics" },
  { id: "whatsapp", label: "WhatsApp messages & recovery" },
  { id: "offers", label: "Discounts, coupons & offers" },
  { id: "partnership", label: "Partnership" },
  { id: "other", label: "Something else" },
] as const;

export type CallbackReason = (typeof CALLBACK_REASONS)[number]["id"];
export const reasonLabel = (id: string | null | undefined) => CALLBACK_REASONS.find((r) => r.id === id)?.label ?? (id || "Other");

export const CALL_TIMES = [
  { id: "anytime", label: "Any time (10 am – 7 pm)" },
  { id: "morning", label: "Morning (10 am – 1 pm)" },
  { id: "afternoon", label: "Afternoon (1 pm – 4 pm)" },
  { id: "evening", label: "Evening (4 pm – 7 pm)" },
] as const;
export const callTimeLabel = (id: string | null | undefined) => CALL_TIMES.find((t) => t.id === id)?.label ?? "Any time";

/** Complaint categories in the store dashboard (sales and partnership are callback-only). */
export const TICKET_CATEGORIES = CALLBACK_REASONS.filter((r) => r.id !== "sales" && r.id !== "partnership");

export const CALLBACK_STATUS = { new: "New", contacted: "Contacted", closed: "Closed" } as const;
export const TICKET_STATUS = { open: "Open", in_progress: "In progress", resolved: "Resolved", closed: "Closed" } as const;
export type TicketStatus = keyof typeof TICKET_STATUS;

export const SUPPORT_EMAIL = "support@growpefy.com";
export const SUPPORT_HOURS = "Mon – Sat, 10 am – 7 pm IST";
export const TICKET_CHIP: Record<string, string> = {
  open: "bg-sky-50 text-sky-800", in_progress: "bg-amber-50 text-amber-800", resolved: "bg-emerald-50 text-good", closed: "bg-paper-sunk text-ink-soft",
};
