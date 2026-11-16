export type PayFilter = "all" | "cod" | "prepaid";
export const PAY_FILTERS: { id: PayFilter; label: string }[] = [
  { id: "all", label: "All payments" }, { id: "cod", label: "Cash on Delivery" }, { id: "prepaid", label: "Prepaid" },
];
