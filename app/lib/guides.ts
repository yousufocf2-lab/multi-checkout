// "Learn more" guides shown in a side panel on dashboard pages: short, step-by-step help for each tool.
export type Guide = { title: string; intro: string; steps?: { title: string; text: string }[]; tips?: string[]; links?: { label: string; href: string }[] };

export const GUIDES: Record<string, Guide> = {
  ads: {
    title: "Connect your ad accounts",
    intro: "See spend, ROAS and cost per order for Meta and Google side by side, worked out from the real orders on your checkout.",
    steps: [
      { title: "Find your Meta ad account ID", text: "Open Meta Ads Manager. The number after “act_” in the address bar (or in the account menu) is your ad account ID. Copy only the digits." },
      { title: "Create a system user token", text: "In Meta Business Settings go to Users → System users. Add a system user (Admin), click “Add assets”, pick your ad account and pixel with full control, then “Generate new token” with ads_read, ads_management and business_management." },
      { title: "Paste them in Settings", text: "Go to Settings → General → Meta ads. Paste the ad account ID, the token and your Pixel ID, then save. Spend shows up here within a few minutes." },
      { title: "Connect Google Ads (optional)", text: "On this page click “Connect Google Ads”, sign in with the Google account that runs your ads and pick the ad account for this store." },
    ],
    tips: [
      "Cost per order under ₹35 is excellent, ₹35–59 good, ₹60–99 average and ₹100+ needs attention.",
      "Turn on “Count COD orders as purchases” so Meta learns from COD buyers too.",
      "Using both the Google tag and server uploads? Keep only one as “Primary” in Google Ads so an order isn't counted twice.",
    ],
    links: [
      { label: "Meta Business Settings", href: "https://business.facebook.com/settings" },
      { label: "Meta Ads Manager", href: "https://adsmanager.facebook.com" },
      { label: "Google Ads", href: "https://ads.google.com" },
    ],
  },
  payments: {
    title: "Payments",
    intro: "Choose how customers can pay (online, COD, Partial COD) and the discount or fee for each.",
    steps: [
      { title: "Connect a payment gateway", text: "In Settings → General → Payment gateways, add PayU, Razorpay, Cashfree or another gateway with the keys from its dashboard. Money goes straight to your bank account." },
      { title: "Turn methods on or off", text: "Switch on Prepaid, COD and Partial COD. Partial COD takes a small advance online and the rest on delivery." },
      { title: "Set a discount or fee", text: "Give an extra % off for paying online, or add a small COD fee. This nudges customers to prepay, which cuts RTO." },
    ],
    tips: ["Add a backup gateway: if the first one fails, the checkout switches to the next one automatically."],
  },
  whatsapp: {
    title: "WhatsApp messages",
    intro: "Order confirmations, COD confirmation and abandoned-cart messages go from a verified WhatsApp sender.",
    steps: [
      { title: "Submit your business details", text: "Upload the documents asked on this page (GST or shop proof) and a short video of your store or warehouse." },
      { title: "Wait for approval", text: "Growpefy checks the details, usually within a day. You'll see the status change here." },
      { title: "Messages start automatically", text: "Once approved, order and recovery messages go out on their own. Replies land in WhatsApp inbox." },
    ],
    tips: ["Each message is charged from your wallet. Keep a balance so messages never stop."],
  },
  inbox: {
    title: "WhatsApp inbox",
    intro: "Every customer who got a message from your store can reply here. You can answer from the dashboard.",
    tips: ["You can send free text within 24 hours of the customer's last message. After that, only an approved template can be sent."],
  },
  domains: {
    title: "Connect your own domain",
    intro: "Show your website on your own address, like www.yourbrand.com, with a free SSL certificate.",
    steps: [
      { title: "Type your domain", text: "Enter the address you own (for example www.yourbrand.com) and click Connect." },
      { title: "Add one DNS record", text: "Where you bought the domain (GoDaddy, Hostinger, Namecheap…), open DNS settings and add: Type CNAME, Name www, Value connect.growpefy.com. Remove any old A or CNAME record for www." },
      { title: "Forward the bare domain", text: "Set yourbrand.com to forward (301) to https://www.yourbrand.com in the same DNS panel." },
      { title: "Wait for SSL", text: "It usually takes 5 to 30 minutes. This page turns green when your site is live on the new address." },
    ],
    tips: ["DNS changes can take up to a few hours with some providers. Click “Check again” any time."],
  },
  discounts: {
    title: "Discounts",
    intro: "Create offers that appear at checkout. Pick the type that fits what you want to do.",
    steps: [
      { title: "Amount off products", text: "A % or ₹ off on selected products, with a separate value for online payment and COD." },
      { title: "Discount codes", text: "Codes customers type at checkout, like WELCOME10. Set a minimum cart, maximum discount, dates and usage limit." },
      { title: "Bank & card offers", text: "Show offers like “10% off on Kotak cards”. They're applied by your payment gateway's offer engine." },
      { title: "Free gifts & bundles", text: "Buy X get Y free, Buy 2 get 1, and Mix & Match deals." },
      { title: "Online payment discount", text: "A store-wide extra discount for paying online, set in Settings → Payments." },
    ],
    tips: ["If a product has more than one discount, the newest product discount wins. A code adds on top of the online / COD discount only if “Combine with the online / COD discount” is on."],
  },
  shipping: {
    title: "Shipping and delivery",
    intro: "Charge delivery by location, order value and payment method.",
    steps: [
      { title: "Set a default rate", text: "For example ₹0 above ₹499 and ₹49 below." },
      { title: "Add special rates", text: "Charge more for far pincodes or states, or add a fee only for COD." },
    ],
  },
  logistics: {
    title: "Connect a courier",
    intro: "Link your courier account to track every shipment here and unlock RTO Shield.",
    steps: [
      { title: "Pick your courier", text: "Choose Delhivery, Shiprocket, Ekart or another listed courier." },
      { title: "Add the API login", text: "Paste the API token from the courier's panel, or for Shiprocket the email and password of an API user (Settings → API → Create an API user). Shipments start syncing within minutes." },
    ],
  },
  "rto-shield": {
    title: "RTO Shield",
    intro: "Stop COD for customers who often refuse parcels, using delivery history from your connected couriers.",
    tips: ["Start with “Ask for prepaid” instead of blocking: most customers still buy when COD is hidden."],
  },
  rto: {
    title: "RTO Suite",
    intro: "Rules that cut return-to-origin on COD orders.",
    steps: [
      { title: "OTP on COD", text: "Ask for a one-time password before a COD order is placed, so fake numbers can't order." },
      { title: "Confirm on WhatsApp", text: "Customers confirm COD orders with one tap. Unconfirmed orders can be held." },
      { title: "Block customers", text: "Block phone numbers or pincodes that keep refusing orders." },
    ],
  },
  wallet: {
    title: "Plan & billing",
    intro: "Choose a monthly plan, review usage and pay GST invoices through PayU. A previous wallet balance can be applied as credit to future invoices.",
    tips: ["Dropshipping stores keep their separate fulfilment wallet. An overdue monthly invoice pauses checkout after the 7-day grace period."],
  },
  general: {
    title: "Store settings",
    intro: "Your store's name, support phone, payment gateways and ad connections.",
    tips: ["Turning “Checkout is live” off sends shoppers to your normal store checkout instead."],
  },
  checkout: {
    title: "Checkout design",
    intro: "Match the checkout to your brand: logo, colors, fonts and layout. Changes show on the preview right away.",
  },
  install: {
    title: "Connect your store",
    intro: "Link your Shopify store so products, orders and the checkout button work together.",
    steps: [
      { title: "Install the app", text: "Click Connect, approve the app in Shopify and you'll come back here connected." },
      { title: "Add the checkout button", text: "Turn on the Growpefy app embed in your theme (Online Store → Themes → Customize → App embeds)." },
    ],
  },
  integrations: {
    title: "Integrations",
    intro: "Send every new order to another system (ERP, warehouse, your own app) and book shipments automatically.",
    steps: [
      { title: "Order webhook", text: "Paste a URL. Each confirmed order is sent there as JSON, signed with your secret in the X-Growpefy-Signature header." },
      { title: "Auto-ship with Delhivery", text: "Turn on auto-booking: prepaid orders are booked after 10 minutes, COD after the customer confirms on WhatsApp." },
    ],
  },
  themes: {
    title: "Themes",
    intro: "Design your website without code. Click Customize to change sections, colors, fonts and text with a live preview.",
    steps: [
      { title: "Customize", text: "Click any part of the preview to edit it. Add sections from the left panel and drag them to reorder." },
      { title: "Publish", text: "Changes save as a draft. Shoppers see them only after you click Publish." },
    ],
    tips: ["Every publish keeps the previous design, so you can restore it any time."],
  },
  catalog: {
    title: "Products",
    intro: "Add what you sell with photos, videos, variants and stock.",
    tips: ["Videos play muted on a loop on your website, which helps shoppers see the product."],
  },
  pages: {
    title: "Pages",
    intro: "Shipping, returns, privacy and terms pages. Payment gateways need these before approving your website.",
  },
  drafts: {
    title: "Draft orders",
    intro: "Make an order yourself for a customer who ordered on phone, WhatsApp or Instagram.",
    steps: [
      { title: "Add products", text: "Search your products, or add a custom item with your own name and price (own website only)." },
      { title: "Add the customer", text: "Mobile number, name and delivery address. Add a discount or shipping charge if needed." },
      { title: "Send a checkout link", text: "The customer opens it with everything filled in and pays online or picks COD." },
      { title: "Or create the order now", text: "Choose “Create COD order” or “Mark as paid” (UPI, bank transfer, cash). It becomes a normal order and ships like any other." },
    ],
  },
  abandoned: {
    title: "Abandoned checkouts",
    intro: "Shoppers who started checkout, left their phone number, but didn't place the order. Each has a link that reopens their cart.",
    steps: [
      { title: "Automatic reminders", text: "If WhatsApp is set up, Growpefy sends the recovery link on its own. Turn it on in Settings → WhatsApp." },
      { title: "Reach out yourself", text: "Use WhatsApp or Call on a row. Big carts are worth a personal message." },
    ],
    tips: ["Most carts are recovered in the first hour. Reply quickly."],
  },
  funnel: {
    title: "Checkout funnel",
    intro: "Where shoppers drop off between opening checkout, entering their phone, address and paying.",
  },
};

export const guideFor = (key: string | undefined | null) => (key ? GUIDES[key] ?? null : null);
