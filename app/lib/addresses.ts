// Saved checkout addresses: masking rules shared by server and browser.

export type MaskedAddress = {
  id: number;
  name: string; // "Rahul S***"
  line: string; // masked address1, address2
  city: string;
  state: string; // province code (full, needed for shipping and COD rules)
  pincode: string; // full (needed for shipping rules)
  label: "home" | "work";
};

/** Masks the second half of each longer word: "Green Park Apartments" → "Gre** Pa** Apart*****". Short words stay. */
export function maskText(text: string) {
  return text
    .split(/(\s+|,)/)
    .map((w) => {
      if (/^\s+$|^,$/.test(w) || w.length <= 3) return w;
      const keep = Math.ceil(w.length / 2);
      return w.slice(0, keep) + "*".repeat(w.length - keep);
    })
    .join("");
}

export function maskName(first: string, last: string) {
  const l = last.trim();
  return [first.trim(), l ? `${l[0]}***` : ""].filter(Boolean).join(" ");
}

/** Key to spot the same address saved twice. */
export function addressKey(address1: string, pincode: string) {
  return `${address1.toLowerCase().replace(/[^a-z0-9]/g, "")}|${pincode.replace(/\D/g, "")}`;
}
