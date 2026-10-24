// Payment gateways a store can connect (up to 3, in priority order). Shared by server and browser.
// Field values marked secret are never sent to the browser.

export type GatewayField = { name: string; label: string; secret?: boolean; optional?: boolean; hint?: string; placeholder?: string };
export type GatewayInfo = {
  id: string;
  name: string;
  short: string; // for the checkout trust line
  fields: GatewayField[];
  /** Where the merchant finds the keys. */
  where: string;
  /** Webhook / S2S notification the merchant sets in the gateway's dashboard (if any). */
  webhook: boolean;
  /** Gateway checks the website the payment starts from (turn on "Start payments from your store's website"). */
  domainCheck?: boolean;
};

export const MAX_GATEWAYS = 3;

export const GATEWAYS: GatewayInfo[] = [
  {
    id: "payu", name: "PayU", short: "PayU",
    fields: [{ name: "key", label: "Merchant key" }, { name: "salt", label: "Salt (v1)", secret: true }],
    where: "PayU dashboard → Developers → API keys", webhook: true, domainCheck: true,
  },
  {
    id: "cashfree", name: "Cashfree Payments", short: "Cashfree",
    fields: [{ name: "appId", label: "App ID (x-client-id)" }, { name: "secret", label: "Secret key", secret: true }],
    where: "Cashfree dashboard → Developers → API keys. Also whitelist your checkout domain there.", webhook: true, domainCheck: true,
  },
  {
    id: "razorpay", name: "Razorpay", short: "Razorpay",
    fields: [{ name: "keyId", label: "Key ID", placeholder: "rzp_live_…" }, { name: "keySecret", label: "Key secret", secret: true }],
    where: "Razorpay dashboard → Account & Settings → API keys", webhook: true,
  },
  {
    id: "phonepe", name: "PhonePe Payment Gateway", short: "PhonePe",
    fields: [
      { name: "clientId", label: "Client ID" },
      { name: "clientSecret", label: "Client secret", secret: true },
      { name: "clientVersion", label: "Client version", placeholder: "1" },
    ],
    where: "PhonePe Business dashboard → Developer settings (Standard Checkout v2 keys)", webhook: true,
  },
  {
    id: "easebuzz", name: "Easebuzz", short: "Easebuzz",
    fields: [{ name: "key", label: "Merchant key" }, { name: "salt", label: "Salt", secret: true }],
    where: "Easebuzz dashboard → Settings → API keys", webhook: true,
  },
  {
    id: "paytm", name: "Paytm Payment Gateway", short: "Paytm",
    fields: [
      { name: "mid", label: "Merchant ID (MID)" },
      { name: "merchantKey", label: "Merchant key", secret: true },
      { name: "website", label: "Website name", optional: true, placeholder: "DEFAULT", hint: "Test mode uses WEBSTAGING automatically" },
    ],
    where: "Paytm Business dashboard → Developer settings → API keys", webhook: false,
  },
  {
    id: "ccavenue", name: "CCAvenue", short: "CCAvenue",
    fields: [
      { name: "merchantId", label: "Merchant ID" },
      { name: "accessCode", label: "Access code" },
      { name: "workingKey", label: "Working key", secret: true },
    ],
    where: "CCAvenue dashboard → Settings → API keys. Register your website/redirect domain there.", webhook: false, domainCheck: true,
  },
];

export const gatewayById = (id: string | null | undefined) => GATEWAYS.find((g) => g.id === id) ?? null;
export const gatewayName = (id: string | null | undefined) => gatewayById(id)?.name ?? (id ? id : "Online payment");

export const SLOT_LABELS = ["Primary", "Backup 1", "Backup 2"];
