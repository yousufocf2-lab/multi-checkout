import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Link, Outlet, useLoaderData, useLocation } from "@remix-run/react";
import { Icon, type IconName } from "~/components/Icons";
import { DiscountPicker } from "~/components/DiscountPicker";
import { LearnMore, StatusBadge } from "~/components/ui";
import { can, requireStore, requireViewer } from "~/lib/auth.server";
import { storeBaseUrl } from "~/lib/urls.server";
import { storePath } from "~/lib/store-code";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const viewer = await requireViewer(request);
  const s = await requireStore(viewer, params.id);
  return json({ canSettings: can(viewer, "settings"), store: { id: s.id, name: s.name, active: s.active, logoUrl: s.logoUrl, checkout: storeBaseUrl(s), connected: s.platform === "woocommerce" ? Boolean(s.wooSecret) : s.platform === "growpefy" ? true : Boolean(s.adminToken), platform: s.platform === "woocommerce" ? "WooCommerce" : s.platform === "growpefy" ? "Growpefy" : "Shopify" } });
}

const TITLES: Record<string, { title: string; description: string; icon: IconName; guide?: string; back?: string }> = {
  ads: { title: "Ads", description: "Meta and Google Ads: spend, cost per order and ROAS.", icon: "ads", guide: "ads" },
  inbox: { title: "WhatsApp inbox", description: "Chats with customers who got a message from your store.", icon: "inbox", guide: "inbox" },
  whatsapp: { title: "WhatsApp", description: "Sender verification and automatic messages.", icon: "chat", guide: "whatsapp" },
  payments: { title: "Payments", description: "Payment gateways and the methods customers can choose.", icon: "rupee", guide: "payments" },
  checkout: { title: "Checkout experience", description: "Customer details, payment methods and checkout preferences.", icon: "cart", guide: "checkout" },
  "payment-rules": { title: "Payment offers & fees", description: "Discount or fee per payment method, Partial COD and when each shows.", icon: "rupee", guide: "payments", back: "checkout" },
  promotions: { title: "Offers", description: "", icon: "discounts", guide: "discounts" },
  discounts: { title: "Amount off products", description: "Product discounts by payment method and checkout recommendations.", icon: "discounts", guide: "discounts", back: "promotions" },
  coupons: { title: "Discount codes", description: "Codes customers can apply at checkout.", icon: "coupons", guide: "discounts", back: "promotions" },
  offers: { title: "Bank & card offers", description: "Shown at checkout, applied by your gateway's offer engine.", icon: "offers", guide: "discounts", back: "promotions" },
  gifts: { title: "Free gifts & bundles", description: "Mix & Match, Buy 1 get 1, Buy 2 get 1 and more.", icon: "gift", guide: "discounts", back: "promotions" },
  shipping: { title: "Delivery setup", description: "Delivery charges by location, order value and payment method.", icon: "shipping", guide: "shipping" },
  settings: { title: "Business profile", description: "Business details, contact, store defaults and order IDs.", icon: "stores", guide: "general" },
  locations: { title: "Locations", description: "Where you keep stock, ship from and offer pickup.", icon: "box" },
  website: { title: "Domains", description: "Your own domain and the free Growpefy address.", icon: "globe", guide: "domains" },
  design: { title: "Checkout design", description: "Colors, fonts, logo and layout of your checkout.", icon: "cart", guide: "checkout", back: "checkout" },
  rto: { title: "RTO Suite", description: "COD rules, OTP, blocked customers and order confirmation.", icon: "shield", guide: "rto" },
  "customer-accounts": { title: "Customer accounts", description: "Shopper login on your website: what to ask for and how they verify.", icon: "users" },
  calls: { title: "Order confirmation", description: "Call customers to confirm new orders.", icon: "phone" },
  widgets: { title: "Widgets", description: "Add-ons for your website: product reviews and more.", icon: "sparkle" },
  menus: { title: "Menus", description: "Links in your website's header and footer.", icon: "menu" },
  files: { title: "Files", description: "Photos, videos and documents for your website.", icon: "layers" },
  live: { title: "Live view", description: "Who's on your website and checkout right now.", icon: "eye" },
  "meta-catalog": { title: "Facebook & Instagram", description: "Your products in Meta's catalog, kept up to date automatically.", icon: "ads" },
  logistics: { title: "Shipments", description: "Connect couriers to track shipments and unlock RTO Shield.", icon: "shipping", guide: "logistics" },
  funnel: { title: "Analytics", description: "Store visits, checkout conversion and orders.", icon: "chart", guide: "analytics" },
  "rto-shield": { title: "RTO Shield", description: "Block COD based on a customer's delivery history.", icon: "shield", guide: "rto-shield" },
  wallet: { title: "Plan & billing", description: "Plans, monthly invoices and payment history.", icon: "wallet", guide: "wallet" },
  install: { title: "Store connection", description: "Connect your store, payments, webhooks and the checkout button.", icon: "setup", guide: "install" },
};


/** Store pages share a slim header; the section menu lives in the sidebar. */
export default function StoreLayout() {
  const { store, canSettings } = useLoaderData<typeof loader>();
  const section = useLocation().pathname.split("/")[3] ?? "";
  const t = TITLES[section];
  return (
    <>
      {t && (
        <div className="mb-4 flex min-h-[32px] flex-wrap items-center gap-x-3 gap-y-2">
          <div className="flex min-w-0 flex-1 items-center gap-2">
            {t.back
              ? <Link to={`${storePath(store.id)}/${t.back}`} className="-ml-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-ink-soft hover:bg-black/5 hover:text-ink" aria-label="Back"><Icon name="arrow" className="h-4 w-4 rotate-180" /></Link>
              : <Icon name={t.icon} className="h-4 w-4 shrink-0" strokeWidth={1.9} />}
            <h1 className="truncate text-[15px] font-semibold leading-tight tracking-tight">{t.title}</h1>
            {!store.active && <StatusBadge status="off" label="Checkout off" />}
            {!store.connected && store.platform !== "Growpefy" && <StatusBadge status="pending_payment" label={`${store.platform} not connected`} />}
            {t.description && <span className="hidden min-w-0 truncate text-[12.5px] text-ink-faint lg:inline">{t.description}</span>}
          </div>
          <div className="flex items-center gap-2">
            {t.guide && <LearnMore topic={t.guide} />}
            {section === "promotions" && <DiscountPicker storeId={store.id} />}
            {section === "inbox" && canSettings && (
              <Link to={`${storePath(store.id)}/whatsapp`} className="btn-secondary"><Icon name="settings" className="h-4 w-4" />WhatsApp settings</Link>
            )}
            {section === "whatsapp" && (
              <Link to={`${storePath(store.id)}/inbox`} className="btn-secondary"><Icon name="chat" className="h-4 w-4" />Open inbox</Link>
            )}
          </div>
        </div>
      )}
      {/* keyed by store: switching stores must not carry one store's form values into the other */}
      <Outlet key={store.id} />
    </>
  );
}
