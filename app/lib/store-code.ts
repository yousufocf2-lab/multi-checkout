// Each store's admin address uses a short code instead of its number: growpefy.com/store/kqmzdx-pa/settings.
// The code is a scrambled form of the store id (a small Feistel cipher), so it works both ways without a lookup
// and looks random. It isn't a secret: every page still checks the viewer can open that store.
const KEYS = [0x5bd1, 0x2c7e, 0x9a13, 0x61f5];
const ALPHA = "abcdefghijklmnopqrstuvwxyz";
const LEN = 8;
const f = (x: number, k: number) => ((((x * 0x9e3b) ^ (x >>> 5) ^ k) + 0x3d) & 0xffff);

export function storeCode(id: number): string {
  let l = (id >>> 16) & 0xffff;
  let r = id & 0xffff;
  for (const k of KEYS) [l, r] = [r, l ^ f(r, k)];
  let n = l * 65536 + r;
  // 7 base-26 digits, each shifted by a salt letter (first character) so codes don't all start alike
  const salt = (n * 7 + 3) % 26;
  const d: number[] = [];
  for (let i = 0; i < LEN - 1; i++) { d.unshift(n % 26); n = Math.floor(n / 26); }
  const s = ALPHA[salt] + d.map((x, i) => ALPHA[(x + salt + i * 5) % 26]).join("");
  return `${s.slice(0, 6)}-${s.slice(6)}`;
}

/** Store id from a code (or a plain number, for old links). Null when it isn't a valid code. */
export function storeIdFromCode(code: string | number | null | undefined): number | null {
  if (code == null) return null;
  const raw = String(code).trim().toLowerCase();
  if (/^\d+$/.test(raw)) return Number(raw) || null;
  const s = raw.replace("-", "");
  if (!/^[a-z]{8}$/.test(s) || raw !== `${s.slice(0, 6)}-${s.slice(6)}`) return null;
  const salt = ALPHA.indexOf(s[0]);
  let n = 0;
  for (let i = 1; i < LEN; i++) n = n * 26 + ((ALPHA.indexOf(s[i]) - salt - (i - 1) * 5) % 26 + 52) % 26;
  if (n >= 2 ** 32) return null;
  let l = Math.floor(n / 65536);
  let r = n % 65536;
  for (let i = KEYS.length - 1; i >= 0; i--) [l, r] = [r ^ f(l, KEYS[i]), l];
  const id = l * 65536 + r;
  return id > 0 && storeCode(id) === raw ? id : null;
}

/** Admin address of a store page: storePath(8, "settings") → "/store/kqmzdx-pa/settings". */
export const storePath = (id: number | string | undefined, section?: string) => `/store/${typeof id === "number" || /^\d+$/.test(String(id)) ? storeCode(Number(id)) : id}${section ? `/${section}` : ""}`;
