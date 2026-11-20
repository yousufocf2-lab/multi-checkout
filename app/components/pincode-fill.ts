// Fills city and state from a 6-digit Indian pincode (Growpefy's /api/pincode lookup). Browser only.
import { useEffect, type RefObject } from "react";

const cache = new Map<string, Promise<{ city: string | null; state: string | null }>>();

export function lookupPincode(pin: string) {
  if (!/^[1-9]\d{5}$/.test(pin)) return Promise.resolve({ city: null, state: null });
  if (!cache.has(pin)) {
    cache.set(pin, fetch(`/api/pincode/${pin}`).then((r) => r.json() as Promise<{ city: string | null; state: string | null }>).catch(() => {
      cache.delete(pin);
      return { city: null, state: null };
    }));
  }
  return cache.get(pin)!;
}

/** For forms with plain inputs named pincode / city / state: typing a pincode fills the other two. */
export function usePincodeFormFill(form: RefObject<HTMLFormElement | null>) {
  useEffect(() => {
    const el = form.current;
    if (!el) return;
    const onInput = (e: Event) => {
      const t = e.target as HTMLInputElement;
      if (t?.name !== "pincode") return;
      const pin = t.value.replace(/\D/g, "");
      if (pin.length !== 6) return;
      void lookupPincode(pin).then(({ city, state }) => {
        if (t.value.replace(/\D/g, "") !== pin) return; // changed again meanwhile
        const c = el.elements.namedItem("city") as HTMLInputElement | null;
        const s = el.elements.namedItem("state") as HTMLSelectElement | HTMLInputElement | null;
        if (city && c) c.value = city;
        if (state && s) s.value = state;
      });
    };
    el.addEventListener("input", onInput);
    return () => el.removeEventListener("input", onInput);
  }, [form]);
}
