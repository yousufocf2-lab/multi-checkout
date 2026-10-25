// Feature landing pages (growpefy.com/features/…). Each one targets what merchants search for.
// Only claims that match what Growpefy does today.
import type { IconName } from "~/components/Icons";

export type Feature = {
  slug: string;
  nav: string; // short name for menus
  icon: IconName;
  title: string; // <title>
  description: string; // meta description
  eyebrow: string;
  h1: string;
  sub: string;
  points: { icon: IconName; title: string; text: string }[];
  steps: [string, string][];
  faq: [string, string][];
  visual: "cod" | "gateways" | "partial" | "recovery" | "ads" | "checkout";
};

export const FEATURES: Feature[] = [
  {
    slug: "cod-rto-protection",
    nav: "COD & RTO protection",
    icon: "shield",
    title: "Reduce RTO on COD orders · COD verification for Shopify & WooCommerce · Growpefy",
    description: "Cut fake and refused COD orders on Shopify and WooCommerce with OTP verification, COD wait time, block lists, WhatsApp order confirmation and courier-based RTO rules. Keep COD open for genuine buyers.",
    eyebrow: "COD & RTO protection",
    h1: "Keep COD for real buyers. Stop the parcels that come back.",
    sub: "Turning COD off loses genuine customers. Growpefy lets you keep it, and decides who sees it using OTP, your own block lists and each customer's delivery history.",
    points: [
      { icon: "lock", title: "OTP before COD", text: "Customers verify their mobile number before placing a COD order (or prepaid too, if you like). Fake numbers never reach your courier." },
      { icon: "clock", title: "COD wait time", text: "Set a gap between COD orders from the same customer, so one person can't flood you with COD orders." },
      { icon: "flag", title: "Block lists", text: "Block by phone, email, pincode, city or state. Upload a CSV of past RTO orders from Shopify or WooCommerce in one go." },
      { icon: "shipping", title: "RTO Shield", text: "Connect your courier and we track every AWB. Customers who keep refusing parcels get COD hidden or orders stopped, using tiers you set." },
      { icon: "chat", title: "WhatsApp order confirmation", text: "Every COD order gets a WhatsApp message with Confirm and Cancel buttons, so you ship only what customers still want." },
      { icon: "rupee", title: "Prepaid stays open", text: "Blocking COD doesn't have to block the sale. Risky customers can still pay online or with partial COD." },
    ],
    steps: [
      ["Turn on the rules you need", "OTP, wait time and block lists are switches in RTO Suite. Start with OTP on COD."],
      ["Connect your courier", "Delhivery, Shiprocket, NimbusPost, Xpressbees and Ekart connect directly; any other courier is tracked from your store orders."],
      ["Set your RTO tiers", "For example: 2 RTOs, hide COD; 5 RTOs, stop orders. You decide, and can keep prepaid open."],
    ],
    faq: [
      ["Will OTP reduce my conversion?", "OTP adds one short step only where you turn it on. Most stores use it on COD only, where fake orders are common, and leave prepaid without it."],
      ["Which couriers work with RTO Shield?", "Delhivery, Shiprocket, NimbusPost, Xpressbees and Ekart connect by API or login. Shadowfax, Blue Dart, DTDC, Ecom Express, India Post and others are tracked from your Shopify or WooCommerce orders, no API needed."],
      ["Can I upload my old RTO customers?", "Yes. Export orders from Shopify or WooCommerce as CSV, choose which columns to block on (phone, email, pincode) and upload."],
      ["What does OTP cost?", "OTPs are charged per OTP sent from your Growpefy wallet. See the pricing page for the current rate."],
    ],
    visual: "cod",
  },
  {
    slug: "multiple-payment-gateways",
    nav: "Multiple payment gateways",
    icon: "refresh",
    title: "Multiple payment gateways for Shopify & WooCommerce with automatic backup · Growpefy",
    description: "Connect up to 3 payment gateways (Razorpay, Cashfree, PayU, PhonePe, Paytm, Easebuzz, CCAvenue) to your Shopify or WooCommerce checkout. If one can't take a payment, Growpefy switches to the next automatically.",
    eyebrow: "Multiple payment gateways",
    h1: "Three payment gateways. One checkout that keeps taking payments.",
    sub: "Gateways go down, banks decline, limits get hit. Connect up to three of your own gateway accounts in priority order, and Growpefy moves to the next one when a payment can't go through.",
    points: [
      { icon: "layers", title: "Up to 3 gateways", text: "Choose a primary, a first backup and a second backup from Razorpay, Cashfree Payments, PayU, PhonePe, Paytm, Easebuzz and CCAvenue." },
      { icon: "refresh", title: "Automatic backup", text: "If the primary can't start a payment, the next gateway opens instead. If a payment fails, the customer's \"Try again\" uses the next one." },
      { icon: "rupee", title: "Money goes to your bank", text: "Every gateway is your own merchant account, so settlements go straight from the gateway to you. Growpefy never holds your money." },
      { icon: "check", title: "Verified on the server", text: "Every payment is confirmed with the gateway before an order is marked paid. One paid checkout creates exactly one order in your store." },
      { icon: "lock", title: "Keys stay private", text: "Gateway keys and secrets are stored on the server and never sent to the browser." },
      { icon: "trend", title: "Clear payment records", text: "Each order shows which gateway took the payment and its payment ID, so reconciliation is easy." },
    ],
    steps: [
      ["Add your gateways", "In store settings, pick up to three gateways and paste their keys from each gateway's dashboard."],
      ["Set the order", "Use the arrows to put them in priority: primary first, then backups. Turn any one off without deleting it."],
      ["Add webhooks", "Copy the webhook URL Growpefy shows for each gateway into its dashboard, so late payments are caught too."],
    ],
    faq: [
      ["Does the customer pay twice if a gateway fails?", "No. A new attempt only starts after the previous one failed or never started, and each order can be paid once. Growpefy checks every attempt with the gateway before marking the order paid."],
      ["Do I need accounts with all the gateways?", "No. One gateway works fine. Backups are optional and only used when you add them."],
      ["Can I use a gateway that's not in the list?", "Tell us which one through the contact page. We add gateways based on what merchants ask for."],
      ["Who pays the gateway fees?", "Gateway fees are charged by your gateway on your own account, as they are today. Growpefy charges only its own order fee."],
    ],
    visual: "gateways",
  },
  {
    slug: "partial-cod",
    nav: "Partial COD",
    icon: "wallet",
    title: "Partial COD for Shopify & WooCommerce · Collect an advance online · Growpefy",
    description: "Offer partial COD on your Shopify or WooCommerce store: customers pay a small advance online and the rest on delivery. Set a fixed amount or a percentage, with offers and rules you control.",
    eyebrow: "Partial COD",
    h1: "Collect a small advance online, the rest on delivery.",
    sub: "Partial COD sits between prepaid and COD. A customer who pays even ₹99 upfront is far more likely to accept the parcel, and you still give COD buyers a way to order.",
    points: [
      { icon: "rupee", title: "Fixed or percentage advance", text: "Ask for a fixed advance like ₹99 or a percentage of the order. The rest is collected on delivery." },
      { icon: "discounts", title: "Its own offer", text: "Give partial COD its own discount or fee, separate from prepaid and full COD." },
      { icon: "shield", title: "Use it for risky orders", text: "When RTO rules hide full COD for a customer, partial COD can stay available so you don't lose the sale." },
      { icon: "orders", title: "Clear in your store", text: "The order goes to Shopify or WooCommerce marked as Partial COD with the advance paid online, so you know exactly what to collect on delivery." },
    ],
    steps: [
      ["Turn on Partial COD", "In Payment methods, switch on Partial COD next to Prepaid and COD."],
      ["Set the advance", "Choose a fixed amount or a percentage, and add a discount or fee if you want."],
      ["Customers pick it at checkout", "They pay the advance through your gateway; the balance is printed as COD on the order."],
    ],
    faq: [
      ["Does partial COD use my payment gateway?", "Yes. The advance is paid through your own gateway, with the same automatic backup as prepaid orders."],
      ["Can coupons work with partial COD?", "Yes, you choose whether coupons apply to partial COD orders."],
      ["What if the customer refuses the parcel?", "The advance has already been paid online, which usually covers part of the return shipping. Refunds follow your store's policy."],
      ["Can I offer only partial COD and no full COD?", "Yes. Each payment method has its own switch."],
    ],
    visual: "partial",
  },
  {
    slug: "whatsapp-cart-recovery",
    nav: "WhatsApp cart recovery",
    icon: "chat",
    title: "Abandoned checkout recovery on WhatsApp for Shopify & WooCommerce · Growpefy",
    description: "Recover abandoned Shopify and WooCommerce checkouts with WhatsApp reminders. Choose one or two messages and when they go out. Plus WhatsApp order confirmation and a shared inbox for replies.",
    eyebrow: "WhatsApp cart recovery",
    h1: "Bring back abandoned checkouts on WhatsApp.",
    sub: "Customers who entered their number and left are your warmest leads. Growpefy reminds them on WhatsApp with a link straight back to their checkout.",
    points: [
      { icon: "chat", title: "1 or 2 reminders", text: "Send one or two WhatsApp reminders and choose when each goes out after the checkout is abandoned." },
      { icon: "cart", title: "Back to the same cart", text: "The link reopens their checkout with the same items, so they finish in a few taps." },
      { icon: "check", title: "Order confirmation too", text: "Confirm COD and prepaid orders on WhatsApp with Confirm and Cancel buttons." },
      { icon: "inbox", title: "Shared inbox", text: "See customer replies in your Growpefy WhatsApp inbox and answer from the dashboard." },
      { icon: "wallet", title: "Pay per message", text: "Each message is charged from your wallet only when it's sent. No monthly WhatsApp plan." },
      { icon: "shield", title: "Verified stores only", text: "Stores are checked before sending, which keeps the shared WhatsApp number trusted and messages delivered." },
    ],
    steps: [
      ["Get verified", "Send your store details and a short stock video from the dashboard. We review and turn WhatsApp on."],
      ["Choose your timing", "Pick one or two reminders and the delay for each."],
      ["Watch checkouts come back", "Customers who return and pay show up as normal orders in your dashboard and in your store."],
    ],
    faq: [
      ["Which customers get a reminder?", "Customers who reached checkout, entered their mobile number and didn't place an order within your chosen time."],
      ["What does a recovery message cost?", "Each recovery message is charged from your wallet when sent. The current rate is on the pricing page."],
      ["Do I need my own WhatsApp Business API account?", "No. Verified stores send through Growpefy's WhatsApp setup."],
      ["Will customers get spammed?", "No. At most the one or two reminders you choose, and none once they place the order."],
    ],
    visual: "recovery",
  },
  {
    slug: "meta-google-ads-analytics",
    nav: "Meta & Google ads analytics",
    icon: "ads",
    title: "Meta & Google Ads ROAS and cost per order dashboard · Growpefy",
    description: "See real cost per order and ROAS from Meta and Google Ads against orders on your checkout. Compare Meta vs Google, track Meta recharges with GST and send purchases back to both platforms.",
    eyebrow: "Meta & Google ads analytics",
    h1: "See what every order really costs on Meta and Google.",
    sub: "Ad platforms report their own numbers. Growpefy puts your Meta and Google spend next to the orders that actually landed on your checkout, so you know which one is making money.",
    points: [
      { icon: "target", title: "Actual cost per order", text: "Ad spend divided by real orders on your checkout, prepaid and COD, tagged Excellent, Good, Average or Poor." },
      { icon: "compare", title: "Meta vs Google", text: "Spend share, orders from each platform's ad clicks, cost per order, and which one is doing better this period." },
      { icon: "trend", title: "One chart for both", text: "Revenue with Meta and Google spend lines over time, for one store or all of them." },
      { icon: "wallet", title: "Meta recharges with GST", text: "We spot prepaid Meta recharges from balance changes and add GST back, so you see what you really paid." },
      { icon: "send", title: "Purchases sent back", text: "Purchases go to Meta through the Conversions API and to Google Ads as click conversions, so both platforms learn from real orders." },
      { icon: "stores", title: "Every store side by side", text: "Compare spend, ROAS and cost per order across all your stores in one table." },
    ],
    steps: [
      ["Connect Meta", "Add your ad account ID, a system user token and your pixel in store settings."],
      ["Connect Google Ads", "Click Connect with Google, pick your ad account, and let Growpefy create a purchase conversion."],
      ["Read the verdict", "Open Ads or Overview to see cost per order and which platform is winning."],
    ],
    faq: [
      ["How do you know which order came from which ad?", "Our checkout reads the click ID each platform adds to the link (fbclid for Meta, gclid for Google) and keeps it with the order. That's real checkout data, not the platforms' own attribution."],
      ["Does it replace Meta Ads Manager or Google Ads?", "No. You still run campaigns there. Growpefy shows results against your real orders and sends purchases back to help bidding."],
      ["Is my ad account safe?", "Growpefy reads reports and sends purchase events. Tokens are stored on the server and never shown in the browser."],
      ["Can I see Snapchat or other platforms?", "Meta and Google are supported today. Tell us which other platform you use through the contact page."],
    ],
    visual: "ads",
  },
  {
    slug: "one-page-checkout",
    nav: "One-page checkout",
    icon: "cart",
    title: "One-page checkout for Shopify & WooCommerce stores in India · Growpefy",
    description: "A fast one-page checkout for Shopify and WooCommerce that opens from Buy Now and the cart: mobile number first, saved addresses behind OTP, coupons, bank offers and free gifts, in your brand's colors.",
    eyebrow: "One-page checkout",
    h1: "A one-page checkout that feels like your brand.",
    sub: "Built for Indian shoppers on mobile: number first, address in one step, payment in one tap. It opens right from Buy Now and the cart, and every order goes back to Shopify or WooCommerce.",
    points: [
      { icon: "phone", title: "Mobile number first", text: "A clear phone box to start. Returning customers skip straight to payment with their saved address." },
      { icon: "lock", title: "Saved addresses behind OTP", text: "When customers agree, addresses are remembered across Growpefy stores and shown only after they verify their number." },
      { icon: "coupons", title: "Coupons that sell", text: "A rounded coupon box shows how many offers are available, with a small celebration when one applies." },
      { icon: "offers", title: "Bank offers & prepaid discounts", text: "Extra off for paying online, card and bank offers, and free gifts, applied automatically." },
      { icon: "design", title: "Your branding", text: "Your logo, colors and fonts. Opens as a smooth popup on mobile so shoppers never feel they left your store." },
      { icon: "orders", title: "Orders back in your store", text: "Every order is created in Shopify or WooCommerce with items, discounts and payment status, so your workflow doesn't change." },
    ],
    steps: [
      ["Connect your store", "Sign up, connect Shopify or WooCommerce and set your branding."],
      ["Add one script", "Paste one line in your theme. Checkout and Buy Now start opening Growpefy."],
      ["Go live", "Test an order, then switch it on for everyone."],
    ],
    faq: [
      ["Does it work with my theme?", "Yes. On Shopify, one script in your theme makes the Checkout and Buy Now buttons open Growpefy. On WooCommerce, our plugin sends the Checkout page to Growpefy. Nothing else in the theme changes."],
      ["Do products and inventory stay in my store?", "Yes. Products, prices and stock are read live from Shopify or WooCommerce, and orders are written back to it."],
      ["Can new customers check out quickly?", "New customers enter their PIN code first, then name, optional email and address on one screen, and can save it as Home or Work."],
      ["Does it support WooCommerce or custom sites?", "Shopify and WooCommerce are both live. Custom-built websites are coming soon."],
    ],
    visual: "checkout",
  },
];

export const featureBySlug = (slug: string | undefined) => FEATURES.find((f) => f.slug === slug) ?? null;
