// Courier catalog shared by the dashboard, website and checkout (no secrets here).

/**
 * api     – we log in to the courier and read live tracking
 * shopify – no login; we read delivery status from the Shopify fulfillment the courier app updates
 * push    – the courier sends status updates to our webhook
 */
export type CourierKind = "api" | "shopify" | "push";

export type CourierField = {
  name: "token" | "clientName" | "email" | "password" | "clientId" | "username" | "label";
  label: string;
  placeholder: string;
  type?: "text" | "password" | "email";
  hint?: string;
  optional?: boolean;
};

export type CourierInfo = {
  id: string;
  name: string;
  kind: CourierKind;
  /** Aggregators book on many couriers, so their AWBs can carry another courier's name. */
  aggregator?: boolean;
  logo?: string;
  color: string;
  tagline: string;
  /** Matched against the Shopify fulfillment tracking company + URL. */
  match: string;
  steps?: string[];
  link?: { label: string; href: string };
  fields?: CourierField[];
};

const SHOPIFY_STEPS = (name: string) => [
  `Keep shipping with ${name} the way you do today. Mark orders fulfilled in Shopify with the AWB (your ${name} app or panel usually does this for you).`,
  "Turn it on here. We match each order's AWB and courier name from Shopify.",
  `We read the delivery status Shopify gets from ${name} every hour. Delivered, failed and cancelled shipments count towards RTO Shield.`,
];

export const COURIERS: CourierInfo[] = [
  {
    id: "delhivery", name: "Delhivery", kind: "api", logo: "/logos/delhivery.webp", color: "#e11d27",
    tagline: "Direct API · live tracking", match: "delhivery",
    steps: [
      "Open Delhivery One and log in.",
      "Go to Settings → API Setup.",
      "Copy your live API token. No token yet? Click “Request Live API Token”. A new token replaces the old one, so update other apps that use it.",
      "Paste it here and connect. We check it with Delhivery straight away.",
    ],
    link: { label: "Open Delhivery One", href: "https://one.delhivery.com/" },
    fields: [
      { name: "token", label: "API token", placeholder: "Paste your Delhivery live API token" },
      { name: "clientName", label: "Client name", placeholder: "As shown in Delhivery One", hint: "Helps when you have more than one Delhivery account.", optional: true },
    ],
  },
  {
    id: "shiprocket", name: "Shiprocket", kind: "api", aggregator: true, logo: "/logos/shiprocket.webp", color: "#6d28d9",
    tagline: "All Shiprocket couriers · live tracking", match: "shiprocket",
    steps: [
      "Log in to Shiprocket and open Settings → API → Configure.",
      "Click “Create an API User”. Use a new email (it must be different from your Shiprocket login) and set a password.",
      "Enter that API user's email and password here. We log in for you and refresh the session automatically.",
    ],
    link: { label: "Open Shiprocket API settings", href: "https://app.shiprocket.in/api-user" },
    fields: [
      { name: "email", label: "API user email", placeholder: "api@yourbrand.com", type: "email" },
      { name: "password", label: "API user password", placeholder: "Password of the API user", type: "password" },
    ],
  },
  {
    id: "nimbuspost", name: "NimbusPost", kind: "api", aggregator: true, logo: "/logos/nimbuspost.webp", color: "#1e3a8a",
    tagline: "All NimbusPost couriers · live tracking", match: "nimbus",
    steps: [
      "Use the email and password of your NimbusPost account (or an API user your NimbusPost manager created for you).",
      "Enter them here. We log in for you and track every AWB booked through NimbusPost.",
    ],
    link: { label: "Open NimbusPost", href: "https://ship.nimbuspost.com/" },
    fields: [
      { name: "email", label: "NimbusPost email", placeholder: "you@yourbrand.com", type: "email" },
      { name: "password", label: "Password", placeholder: "NimbusPost password", type: "password" },
    ],
  },
  {
    id: "xpressbees", name: "Xpressbees", kind: "api", logo: "/logos/xpressbees.webp", color: "#f97316",
    tagline: "Direct API · live tracking", match: "xpress ?bees|xbees",
    steps: [
      "Ask your Xpressbees account manager for API access to the shipment portal (it's free).",
      "Enter the API email and password they share. We check them with Xpressbees straight away.",
      "Shipping Xpressbees through Shiprocket or NimbusPost? Connect that aggregator instead.",
    ],
    link: { label: "Open Xpressbees", href: "https://shipment.xpressbees.com/" },
    fields: [
      { name: "email", label: "API email", placeholder: "you@yourbrand.com", type: "email" },
      { name: "password", label: "API password", placeholder: "Xpressbees API password", type: "password" },
    ],
  },
  {
    id: "ekart", name: "Ekart", kind: "api", logo: "/logos/ekart.webp", color: "#2563eb",
    tagline: "Ekart Elite API · live tracking", match: "ekart|flipkart",
    steps: [
      "Log in to Ekart Elite (app.elite.ekartlogistics.in).",
      "Open Settings → API and copy your Client ID. Your API username and password are on the same page (ask your Ekart manager if you don't see them).",
      "Enter them here. We check them with Ekart straight away.",
    ],
    link: { label: "Open Ekart Elite", href: "https://app.elite.ekartlogistics.in/" },
    fields: [
      { name: "clientId", label: "Client ID", placeholder: "Ekart client ID" },
      { name: "username", label: "API username", placeholder: "Ekart API username" },
      { name: "password", label: "API password", placeholder: "Ekart API password", type: "password" },
    ],
  },
  ...([
    ["shadowfax", "Shadowfax", "#0f9d58", "shadow ?fax"],
    ["bluedart", "Blue Dart", "#1d4ed8", "blue ?dart"],
    ["dtdc", "DTDC", "#dc2626", "dtdc"],
    ["ecom", "Ecom Express", "#b91c1c", "ecom ?express"],
    ["amazon", "Amazon Shipping", "#f59e0b", "amazon|\\bats\\b"],
    ["indiapost", "India Post", "#c2410c", "india ?post|speed ?post"],
    ["ithink", "iThink Logistics", "#0ea5e9", "ithink"],
    ["shipway", "Shipway", "#4f46e5", "shipway"],
    ["smartr", "Smartr", "#7c3aed", "smartr"],
    ["shreemaruti", "Shree Maruti", "#be123c", "maruti"],
    ["trackon", "Trackon", "#0369a1", "trackon"],
    ["professional", "The Professional Couriers", "#475569", "professional"],
    ["gati", "Gati", "#ea580c", "\\bgati\\b"],
    ["dhl", "DHL", "#ca8a04", "\\bdhl\\b"],
    ["fedex", "FedEx", "#6d28d9", "fedex"],
  ] as const).map(([id, name, color, match]): CourierInfo => ({
    id, name, kind: "shopify", color, match, tagline: "Tracked from Shopify fulfillments", steps: SHOPIFY_STEPS(name),
  })),
  {
    id: "other", name: "Other courier", kind: "shopify", color: "#334155", match: "",
    tagline: "Any courier that updates Shopify", steps: [
      "Using a courier that isn't listed, or your own delivery team? Name it here.",
      "Mark orders fulfilled in Shopify with the AWB as you do today.",
      "We read the delivery status from Shopify every hour. Orders whose courier we don't recognise are tracked here.",
    ],
    fields: [{ name: "label", label: "Courier name", placeholder: "e.g. Local courier, Borzo, Porter", optional: true }],
  },
  {
    id: "shipnex", name: "Shipnex", kind: "push", color: "#0b5d4b",
    tagline: "Growpefy's own 3PL · live push updates", match: "shipnex",
    steps: [
      "Turn on Shipnex. We create a private webhook link for this store.",
      "Share the link and secret with your Shipnex manager. Shipnex sends every status change (picked up, delivered, RTO…) to it.",
      "Statuses show up here and in RTO Shield the moment they change.",
    ],
  },
];

export const courierById = (id: string) => COURIERS.find((c) => c.id === id);

/** Logos shown on the website and checkout. */
export const COURIER_LOGOS = COURIERS.filter((c) => c.logo).map((c) => ({ id: c.id, name: c.name, logo: c.logo! }));
