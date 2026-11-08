// Welcome messages for Growpefy's own leads and signups: default texts and the WhatsApp templates to create. Browser-safe.
import type { WelcomeSettings } from "~/db/schema";

export const WELCOME_DEFAULTS: Required<Omit<WelcomeSettings, "autoFrom">> = {
  auto: false,
  whatsapp: true,
  email: true,
  waLeadTemplate: "growpefy_lead_welcome",
  waSignupTemplate: "growpefy_signup_welcome",
  waLang: "en",
  // Header image of each template (both templates have one in WhatsApp Manager). "none" = template without an image.
  waLeadImage: "/wa/lead-welcome.jpg",
  waSignupImage: "/wa/signup-welcome.jpg",
  // App service leads (Meta forms / campaigns with "App" in the name)
  waAppTemplate: "growpefy_app_welcome",
  waAppImage: "none",
  appSubject: "Thanks for your app enquiry, {{name}}",
  appBody: `Thanks for telling us about your business. We build custom Android apps for businesses, with your brand name and logo, orders and payments, push notifications, and full setup until it's live on the Play Store.

Our team will call you within 24 hours to understand what you need and share the cost and timeline.

Want to talk sooner? Message us on WhatsApp or reply to this email.`,
  leadSubject: "Thanks for your interest in Growpefy, {{name}}",
  leadBody: `Thanks for reaching out to Growpefy. Our team will call you shortly to understand your store and show you how the checkout works for your products.

If you'd like to get started right away, create your free account. It takes about a minute, and you can connect your store whenever you're ready.`,
  signupSubject: "Welcome to Growpefy, {{name}} 🎉",
  signupBody: `Your Growpefy account is ready. Finish the three steps below and your new checkout goes live on your store.

Stuck anywhere? Reply to this email or message us on WhatsApp and we'll set it up with you.`,
  fromName: "Growpefy",
  fromEmail: "hello@growpefy.com",
  replyTo: "hello@growpefy.com",
  whatsappNumber: "",
};

/** Text to paste when creating the two WhatsApp templates in WhatsApp Manager ({{1}} = the person's name). */
export const WA_TEMPLATE_TEXT = {
  lead: `Hi {{1}}, thanks for your interest in Growpefy! 🙌

We help D2C brands get more prepaid orders, cut RTO and confirm COD orders on WhatsApp, all from one checkout.

Our team will call you shortly. Want to start right away? Create your free account at growpefy.com/signup

Reply here if you have any questions.`,
  signup: `Hi {{1}}, welcome to Growpefy! 🎉

Your account is ready. To go live:
1. Finish your business details
2. Connect your store
3. Choose your plan and switch on the checkout

Log in at growpefy.com/login. Need help? Reply to this message and our team will set it up with you.`,
  app: `Hi {{1}}, thanks for your app enquiry! 📱

We build custom Android apps for businesses: your brand and logo, orders and payments, push notifications, and full setup until it's live on the Play Store.

Our team will call you within 24 hours to understand your needs and share the cost and timeline.

Reply here if you'd like to talk sooner.`,
};

export const MSG_LABEL = { lead: "Lead welcome", signup: "Signup welcome", app: "App lead welcome" } as const;
export const STATUS_LABEL: Record<string, { label: string; tone: string }> = {
  queued: { label: "Waiting to send", tone: "bg-sky-50 text-sky-800" },
  sent: { label: "Sent", tone: "bg-emerald-50 text-good" },
  retry: { label: "Will retry", tone: "bg-amber-50 text-amber-800" },
  failed: { label: "Failed", tone: "bg-red-50 text-bad" },
  skipped: { label: "Skipped", tone: "bg-paper-sunk text-ink-soft" },
};

export const fillName = (text: string, name: string) => text.replace(/\{\{\s*name\s*\}\}/gi, name);
/** First name to greet with, or "there". */
export function greetName(raw: string | null | undefined) {
  const n = (raw ?? "").trim();
  if (!n || /^meta lead$/i.test(n)) return "there";
  return n.split(/\s+/)[0].slice(0, 40);
}
