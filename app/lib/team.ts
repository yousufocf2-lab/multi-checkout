// Team logins: what each permission unlocks, role presets, and which dashboard pages a member may open.
// Shared by the server (access checks) and the browser (sidebar, team page). No secrets here.

export type Scope = "platform" | "owner";

export type Perm = { id: string; label: string; description: string };

/** Growpefy staff (super admin's team). */
export const PLATFORM_PERMS: Perm[] = [
  { id: "leads", label: "Leads & demos", description: "See every lead, call them, log notes and book demos." },
  { id: "support", label: "Support inbox", description: "Callback requests and complaints from stores." },
  { id: "clients", label: "Clients", description: "Signups, onboarding progress, KYC and WhatsApp approvals." },
  { id: "marketing", label: "Growpefy marketing", description: "Our own Meta and Google ad spend and cost per lead." },
  { id: "stores", label: "Open client stores", description: "Orders, ads and settings inside each client's store." },
  { id: "billing", label: "Wallets & billing", description: "All wallets, recharges, rate card and invoice settings." },
  { id: "fulfilment", label: "Fulfilment", description: "Fulfilment orders, SKU prices and charges." },
  { id: "team", label: "Manage team", description: "Add team members and change their access." },
];

/** A store owner's employees. */
export const OWNER_PERMS: Perm[] = [
  { id: "orders", label: "Orders", description: "Orders, abandoned checkouts and the overview numbers." },
  { id: "inbox", label: "WhatsApp inbox", description: "Read and reply to customers on WhatsApp." },
  { id: "ads", label: "Ads", description: "Meta and Google ad reports." },
  { id: "offers", label: "Discounts & offers", description: "Discounts, coupons, bank offers and free gifts." },
  { id: "rto", label: "Shipping & RTO", description: "Shipping rates, courier, RTO Shield and RTO suite." },
  { id: "billing", label: "Wallet", description: "Wallet balance, recharges and invoices." },
  { id: "settings", label: "Store settings", description: "Store, payment, WhatsApp, design and setup settings." },
  { id: "team", label: "Manage team", description: "Add employees and change their access." },
];

export type RolePreset = { id: string; label: string; perms: string[] };

export const PLATFORM_ROLES: RolePreset[] = [
  { id: "sales", label: "Sales", perms: ["leads", "support"] },
  { id: "support", label: "Support", perms: ["support", "clients", "stores"] },
  { id: "accounts", label: "Accounts", perms: ["billing"] },
  { id: "marketing", label: "Marketing", perms: ["marketing", "leads"] },
  { id: "manager", label: "Manager", perms: ["leads", "support", "clients", "marketing", "stores", "billing", "fulfilment"] },
];

export const OWNER_ROLES: RolePreset[] = [
  { id: "orders", label: "Order manager", perms: ["orders", "inbox", "rto"] },
  { id: "support", label: "Customer support", perms: ["orders", "inbox"] },
  { id: "marketing", label: "Marketing", perms: ["ads", "offers", "orders"] },
  { id: "accounts", label: "Accounts", perms: ["billing", "orders"] },
  { id: "manager", label: "Manager", perms: ["orders", "inbox", "ads", "offers", "rto", "billing", "settings"] },
];

export const permsFor = (scope: Scope) => (scope === "platform" ? PLATFORM_PERMS : OWNER_PERMS);
export const rolesFor = (scope: Scope) => (scope === "platform" ? PLATFORM_ROLES : OWNER_ROLES);
export const cleanPerms = (scope: Scope, list: string[]) => permsFor(scope).map((p) => p.id).filter((id) => list.includes(id));
export const roleLabel = (scope: Scope, id: string) => rolesFor(scope).find((r) => r.id === id)?.label ?? "Custom";

/** "open" = any member, a permission id = needs it, null = not for team members. */
type Need = "open" | string | null;

const STORE_SECTION: Record<string, string> = {
  orders: "orders", funnel: "orders", ads: "ads", google: "ads", inbox: "inbox", whatsapp: "settings",
  discounts: "offers", coupons: "offers", offers: "offers", gifts: "offers",
  logistics: "rto", shipping: "rto", rto: "rto", "rto-shield": "rto",
  wallet: "billing", settings: "settings", design: "settings", install: "settings", payments: "settings",
  products: "open",
};

function needFor(scope: Scope, path: string): Need {
  const p = path.replace(/\/+$/, "") || "/";
  if (p === "/dashboard" || p === "/dashboard/account" || p === "/dashboard/select") return "open";
  if (p === "/dashboard/team") return "team";
  const store = p.match(/^\/dashboard\/stores\/(\d+)(?:\/([^/]+))?/);

  if (scope === "platform") {
    if (p.startsWith("/dashboard/leads")) return "leads";
    if (p.startsWith("/dashboard/support")) return "support";
    if (p.startsWith("/dashboard/marketing")) return "marketing";
    if (p.startsWith("/dashboard/clients") || p.startsWith("/dashboard/owners") || p.startsWith("/dashboard/wa-verify") || p.startsWith("/dashboard/store-doc")) return "clients";
    if (p.startsWith("/dashboard/wallets") || p.startsWith("/dashboard/wallet/") || (store && store[2] === "wallet")) return "billing";
    if (p.startsWith("/dashboard/dropship")) return "fulfilment";
    if (store || p.startsWith("/dashboard/stores") || p.startsWith("/dashboard/connect-requests") || p.startsWith("/dashboard/orders") || p === "/dashboard/ads" || p === "/dashboard/compare") return "stores";
    return null;
  }

  if (p === "/dashboard/stores" || p.startsWith("/dashboard/support")) return "open";
  if (p === "/dashboard/stores/new" || p.startsWith("/dashboard/store-doc")) return "settings";
  if (p.startsWith("/dashboard/orders")) return "orders";
  if (p === "/dashboard/ads" || p === "/dashboard/compare") return "ads";
  if (p.startsWith("/dashboard/wallet/")) return "billing";
  if (store) return store[2] ? STORE_SECTION[store[2]] ?? null : "open";
  return null;
}

/** Whether a team member with these permissions may open this dashboard path. */
export function memberMayOpen(scope: Scope, perms: string[], path: string) {
  const need = needFor(scope, path);
  return need === "open" || (need != null && perms.includes(need));
}

