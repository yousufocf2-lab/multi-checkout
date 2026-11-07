// The little icon in the browser tab for a store's website: the store's favicon, else its logo,
// else the first letter of the store name in the brand colour. Never Growpefy's own icon.
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export function letterIconSvg(name: string, color: string) {
  const letter = (name.trim().match(/[A-Za-z0-9]/)?.[0] ?? "S").toUpperCase();
  const bg = /^#[0-9a-f]{6}$/i.test(color) ? color : "#111827";
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="${bg}"/><text x="32" y="44" text-anchor="middle" font-family="Arial,Helvetica,sans-serif" font-size="36" font-weight="700" fill="#fff">${esc(letter)}</text></svg>`;
}

export const letterIconUri = (name: string, color: string) => `data:image/svg+xml,${encodeURIComponent(letterIconSvg(name, color))}`;

/** Icon address for the store, from its theme settings and store details. */
export function storeIcon(store: { name: string; logoUrl: string | null; primaryColor: string | null }, settings?: Record<string, unknown> | null) {
  const pick = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
  return pick(settings?.favicon) ?? pick(settings?.logo) ?? pick(store.logoUrl) ?? letterIconUri(store.name, store.primaryColor || "#111827");
}
