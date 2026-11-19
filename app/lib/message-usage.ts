// Messages & OTP charges: names and groups shared by the server and the page.
export type MsgKind = "otp" | "wa_confirm" | "wa_tracking" | "wa_followup" | "wa_reply" | "wa_promo" | "wa_recovery";
export type MsgGroup = "otp" | "transactional" | "service" | "promotional";

export const MSG_KINDS: { id: MsgKind; label: string; group: MsgGroup; rateKey: string }[] = [
  { id: "otp", label: "OTP", group: "otp", rateKey: "otp" },
  { id: "wa_confirm", label: "Order confirmation", group: "transactional", rateKey: "waConfirm" },
  { id: "wa_tracking", label: "Delivery update", group: "transactional", rateKey: "waTracking" },
  { id: "wa_followup", label: "Inbox follow-up", group: "transactional", rateKey: "waFollowup" },
  { id: "wa_reply", label: "Inbox reply", group: "service", rateKey: "waReply" },
  { id: "wa_promo", label: "Promotional message", group: "promotional", rateKey: "waPromo" },
  { id: "wa_recovery", label: "Abandoned checkout reminder", group: "promotional", rateKey: "waRecovery" },
];

export const GROUP_INFO: Record<MsgGroup, { label: string; text: string }> = {
  otp: { label: "OTP", text: "Phone verification codes at checkout and login" },
  transactional: { label: "WhatsApp · transactional", text: "Order confirmations, delivery updates, follow-ups" },
  service: { label: "WhatsApp · service", text: "Replies to customers from the inbox" },
  promotional: { label: "WhatsApp · promotional", text: "Offers and abandoned checkout reminders" },
};

export const kindOf = (type: string) => MSG_KINDS.find((k) => k.id === type) ?? { id: type as MsgKind, label: type.replace(/^wa_/, "WhatsApp ").replaceAll("_", " "), group: "transactional" as MsgGroup, rateKey: "" };
export const FILTERS = ["all", "otp", "whatsapp", "transactional", "service", "promotional"] as const;
export type MsgFilter = (typeof FILTERS)[number];
export const FILTER_LABEL: Record<MsgFilter, string> = { all: "All", otp: "OTP", whatsapp: "All WhatsApp", transactional: "Transactional", service: "Service", promotional: "Promotional" };

export const PAGE_SIZE = 50;
