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

/** A store owner's employees and collaborators. Grouped for the role editor. No point-of-sale access: Growpefy has no POS. */
export const OWNER_PERMS: (Perm & { group: "Sell" | "Grow" | "Manage" })[] = [
  { id: "orders", label: "Orders", description: "Orders, draft orders, abandoned checkouts and orders to ship.", group: "Sell" },
  { id: "products", label: "Products", description: "Products, collections, inventory and media.", group: "Sell" },
  { id: "inbox", label: "WhatsApp inbox", description: "Read and reply to customers on WhatsApp.", group: "Sell" },
  { id: "rto", label: "Shipping & RTO", description: "Shipping rates, couriers, shipments, RTO Shield and RTO suite.", group: "Sell" },
  { id: "ads", label: "Marketing & ads", description: "Meta and Google ad reports, profit share.", group: "Grow" },
  { id: "offers", label: "Discounts & offers", description: "Discounts, coupons, bank offers and free gifts.", group: "Grow" },
  { id: "analytics", label: "Analytics", description: "Checkout funnel and reports.", group: "Grow" },
  { id: "online_store", label: "Online store", description: "Themes, theme editor and pages of the website.", group: "Grow" },
  { id: "billing", label: "Plan & billing", description: "Plan, bills and receipts.", group: "Manage" },
  { id: "settings", label: "Store settings", description: "Store profile, payments, checkout, locations, domains and WhatsApp settings.", group: "Manage" },
  { id: "developer", label: "Developer tools", description: "Store connection, integrations and order webhooks.", group: "Manage" },
  { id: "team", label: "Manage team", description: "Add members, approve collaborators and change access.", group: "Manage" },
];

/** Older logins were given broader permissions; these keep them working after the split. */
const IMPLIES: Record<string, string[]> = { settings: ["products", "online_store", "developer"], orders: ["analytics"] };
export function effectivePerms(scope: Scope, perms: string[]) {
  if (scope === "platform") return perms;
  return [...new Set(perms.flatMap((p) => [p, ...(IMPLIES[p] ?? [])]))];
}

export type RolePreset = { id: string; label: string; perms: string[] };

export const PLATFORM_ROLES: RolePreset[] = [
  { id: "sales", label: "Sales", perms: ["leads", "support"] },
  { id: "support", label: "Support", perms: ["support", "clients", "stores"] },
  { id: "accounts", label: "Accounts", perms: ["billing"] },
  { id: "marketing", label: "Marketing", perms: ["marketing", "leads"] },
  { id: "manager", label: "Manager", perms: ["leads", "support", "clients", "marketing", "stores", "billing", "fulfilment"] },
];

export type OwnerRole = RolePreset & { description: string; group: "Store" | "Organization" };
export const OWNER_ROLES: OwnerRole[] = [
  { id: "admin", label: "Administrator", group: "Organization", description: "Everything, including the team. Give this to a partner or co-owner.", perms: ["orders", "products", "inbox", "rto", "ads", "offers", "analytics", "online_store", "billing", "settings", "developer", "team"] },
  { id: "manager", label: "Store manager", group: "Store", description: "Runs the store day to day. No billing or team changes.", perms: ["orders", "products", "inbox", "rto", "ads", "offers", "analytics", "online_store", "settings"] },
  { id: "orders", label: "Order & fulfilment", group: "Store", description: "Confirms, packs and ships orders, handles RTO.", perms: ["orders", "inbox", "rto"] },
  { id: "support", label: "Customer support", group: "Store", description: "Answers customers and looks up their orders.", perms: ["orders", "inbox"] },
  { id: "marketing", label: "Marketer", group: "Store", description: "Ads, discounts and the numbers behind them.", perms: ["ads", "offers", "analytics", "orders"] },
  { id: "merchandiser", label: "Merchandiser", group: "Store", description: "Adds products, prices and stock, runs product offers.", perms: ["products", "offers"] },
  { id: "editor", label: "Online store editor", group: "Store", description: "Designs the website: themes, pages and banners.", perms: ["online_store", "products"] },
  { id: "accounts", label: "Accounts", group: "Organization", description: "Bills, receipts and order value for bookkeeping.", perms: ["billing", "orders", "analytics"] },
  { id: "developer", label: "Developer", group: "Organization", description: "Connects the store, apps and webhooks. Good for agencies.", perms: ["developer", "settings"] },
];

export const permsFor = (scope: Scope) => (scope === "platform" ? PLATFORM_PERMS : OWNER_PERMS);
export const rolesFor = (scope: Scope) => (scope === "platform" ? PLATFORM_ROLES : OWNER_ROLES);
export const cleanPerms = (scope: Scope, list: string[]) => permsFor(scope).map((p) => p.id).filter((id) => list.includes(id));
export const roleLabel = (scope: Scope, id: string) => rolesFor(scope).find((r) => r.id === id)?.label ?? "Custom";

/** "open" = any member, a permission id = needs it, null = not for team members. */
type Need = "open" | string | null;

const STORE_SECTION: Record<string, string> = {
  orders: "orders", funnel: "analytics", diagnostics: "analytics", ads: "ads", google: "ads", inbox: "inbox", whatsapp: "settings",
  discounts: "offers", coupons: "offers", offers: "offers", gifts: "offers",
  logistics: "rto", shipping: "rto", rto: "rto", "rto-shield": "rto",
  wallet: "billing", settings: "settings", design: "settings", install: "developer", payments: "settings", locations: "settings", checkout: "settings", "payment-rules": "settings",
  products: "open",
  promotions: "offers", "to-ship": "orders", profit: "ads",
  catalog: "products", collections: "products", inventory: "products", media: "products", themes: "online_store", editor: "online_store",
  pages: "online_store", website: "settings", integrations: "developer", drafts: "orders",
};

function needFor(scope: Scope, path: string): Need {
  const p = path.replace(/\/+$/, "") || "/";
  if (p === "/dashboard" || p === "/dashboard/account" || p === "/dashboard/security" || p === "/dashboard/select") return "open";
  if (p === "/dashboard/team") return "team";
  const store = p.match(/^\/dashboard\/stores\/(\d+)(?:\/([^/]+))?/) ?? p.match(/^\/store\/([a-z0-9-]+)(?:\/([^/]+))?/);

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
  return need === "open" || (need != null && effectivePerms(scope, perms).includes(need));
}

