// Saved checkout addresses shared by the server and browser.

export type SavedAddressPreview = {
  id: number;
  name: string;
  line: string;
  city: string;
  state: string; // province code (full, needed for shipping and COD rules)
  pincode: string; // full (needed for shipping rules)
  label: "home" | "work";
};

/** Key to spot the same address saved twice. */
export function addressKey(address1: string, pincode: string) {
  return `${address1.toLowerCase().replace(/[^a-z0-9]/g, "")}|${pincode.replace(/\D/g, "")}`;
}
