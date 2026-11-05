// Business packs: one engine, different words and fields for each kind of business.
// The signup question "What do you sell?" sets stores.businessType; menus and catalog pages read their labels from here.
import type { BusinessType } from "~/db/schema";

export type BusinessPack = {
  id: BusinessType;
  name: string;
  examples: string;
  /** Sidebar / page words */
  items: string; // "Products"
  item: string; // "product"
  orders: string; // "Orders"
  categories: string; // "Categories"
  /** Option names suggested when adding variants */
  optionHints: string[];
  /** Live today, or still being built */
  ready: boolean;
};

export const BUSINESS_PACKS: Record<BusinessType, BusinessPack> = {
  store: { id: "store", name: "Online store", examples: "Clothes, gadgets, beauty, home goods", items: "Products", item: "product", orders: "Orders", categories: "Categories", optionHints: ["Size", "Colour", "Material"], ready: true },
  restaurant: { id: "restaurant", name: "Restaurant or cloud kitchen", examples: "Delivery, pickup, dine-in with table QR", items: "Menu", item: "dish", orders: "Food orders", categories: "Menu sections", optionHints: ["Portion", "Spice level"], ready: false },
  coaching: { id: "coaching", name: "Coaching or courses", examples: "Live classes, recorded courses, test series", items: "Courses", item: "course", orders: "Admissions", categories: "Subjects", optionHints: ["Batch", "Language"], ready: false },
  hotel: { id: "hotel", name: "Hotel or homestay", examples: "Rooms, villas, guest houses", items: "Rooms", item: "room", orders: "Bookings", categories: "Properties", optionHints: ["Meal plan", "Occupancy"], ready: false },
  services: { id: "services", name: "Services", examples: "Salon, clinic, repair, consultant", items: "Services", item: "service", orders: "Appointments", categories: "Service groups", optionHints: ["Duration", "Staff"], ready: false },
  events: { id: "events", name: "Events", examples: "Workshops, concerts, meetups", items: "Events", item: "event", orders: "Tickets", categories: "Event types", optionHints: ["Ticket type"], ready: false },
};

export const packOf = (t: string | null | undefined): BusinessPack => BUSINESS_PACKS[(t as BusinessType) ?? "store"] ?? BUSINESS_PACKS.store;

/** URL-safe handle from a title: "Fusion Watch Pro 2" -> "fusion-watch-pro-2". */
export function toHandle(title: string) {
  return title.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "item";
}
