// Store menus (Storefront → Menus): lists of links shown in the website header and footer.
import crypto from "node:crypto";
import { and, asc, eq } from "drizzle-orm";
import { catalogCategories, db, storeMenus, type MenuItem, type StoreMenu } from "~/db.server";
import { footerPages } from "./store-pages.server";
import { categoryPath, productPath } from "./storefront-paths";

const KINDS: MenuItem["kind"][] = ["home", "all", "category", "product", "page", "url"];
const newId = () => crypto.randomBytes(5).toString("hex");
const toHandle = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "menu";

/** Every menu of the store; the first time, a "Main menu" (header) and a "Footer menu" are made from what the site showed before. */
export async function listMenus(storeId: number) {
  let rows = await db.select().from(storeMenus).where(eq(storeMenus.storeId, storeId)).orderBy(asc(storeMenus.id));
  if (!rows.length) {
    const [cats, pages] = await Promise.all([
      db.select({ title: catalogCategories.title, handle: catalogCategories.handle }).from(catalogCategories).where(eq(catalogCategories.storeId, storeId)).orderBy(asc(catalogCategories.position), asc(catalogCategories.title)).limit(4),
      footerPages(storeId),
    ]);
    await db.insert(storeMenus).values([
      { storeId, title: "Main menu", handle: "main-menu", inHeader: true, items: [{ id: newId(), title: "Shop all", kind: "all" }, ...cats.map((c) => ({ id: newId(), title: c.title, kind: "category" as const, ref: c.handle }))] },
      { storeId, title: "Footer menu", handle: "footer", inFooter: true, items: [{ id: newId(), title: "All products", kind: "all" }, ...pages.map((p) => ({ id: newId(), title: p.title, kind: "page" as const, ref: p.handle }))] },
    ]).onConflictDoNothing();
    rows = await db.select().from(storeMenus).where(eq(storeMenus.storeId, storeId)).orderBy(asc(storeMenus.id));
  }
  return rows;
}

function cleanItems(raw: unknown, depth = 0): MenuItem[] {
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, 40).flatMap((x): MenuItem[] => {
    if (!x || typeof x !== "object") return [];
    const o = x as Record<string, unknown>;
    const kind = KINDS.includes(o.kind as MenuItem["kind"]) ? (o.kind as MenuItem["kind"]) : "url";
    const title = String(o.title ?? "").replace(/[<>]/g, "").trim().slice(0, 60);
    if (!title) return [];
    let url = kind === "url" ? String(o.url ?? "").trim().slice(0, 500) : undefined;
    if (url && !/^(https?:\/\/|\/|#|mailto:|tel:)/i.test(url)) url = `https://${url}`;
    if (url && /^javascript:/i.test(url)) url = "#";
    const item: MenuItem = { id: typeof o.id === "string" && /^[\w-]{4,20}$/.test(o.id) ? o.id : newId(), title, kind };
    if (["category", "product", "page"].includes(kind)) item.ref = String(o.ref ?? "").slice(0, 120);
    if (kind === "url") item.url = url || "#";
    if (depth === 0) { const kids = cleanItems(o.children, 1); if (kids.length) item.children = kids; }
    return [item];
  });
}

export async function saveMenu(storeId: number, input: { id?: number; title: string; items: unknown; inHeader: boolean; inFooter: boolean }) {
  const title = input.title.replace(/[<>]/g, "").trim().slice(0, 60);
  if (!title) return { error: "Give the menu a name." };
  const items = cleanItems(input.items);
  const now = new Date();
  // One header menu and one footer menu at a time
  if (input.inHeader) await db.update(storeMenus).set({ inHeader: false }).where(eq(storeMenus.storeId, storeId));
  if (input.inFooter) await db.update(storeMenus).set({ inFooter: false }).where(eq(storeMenus.storeId, storeId));
  if (input.id) {
    await db.update(storeMenus).set({ title, items, inHeader: input.inHeader, inFooter: input.inFooter, updatedAt: now }).where(and(eq(storeMenus.id, input.id), eq(storeMenus.storeId, storeId)));
    return { ok: "Menu saved.", id: input.id };
  }
  const taken = new Set((await db.select({ h: storeMenus.handle }).from(storeMenus).where(eq(storeMenus.storeId, storeId))).map((r) => r.h));
  let handle = toHandle(title), n = 2;
  while (taken.has(handle)) handle = `${toHandle(title)}-${n++}`;
  const [row] = await db.insert(storeMenus).values({ storeId, title, handle, items, inHeader: input.inHeader, inFooter: input.inFooter }).returning({ id: storeMenus.id });
  return { ok: "Menu created.", id: row.id };
}

export async function deleteMenu(storeId: number, id: number) {
  await db.delete(storeMenus).where(and(eq(storeMenus.id, id), eq(storeMenus.storeId, storeId)));
}

export type MenuLink = { title: string; url: string; links: MenuLink[] };
export type MenuDrop = { title: string; handle: string; links: MenuLink[] };

function linkUrl(root: string, i: MenuItem) {
  switch (i.kind) {
    case "home": return root || "/";
    case "all": return categoryPath(root, "all");
    case "category": return i.ref ? categoryPath(root, i.ref) : null;
    case "product": return i.ref ? productPath(root, i.ref) : null;
    case "page": return i.ref ? `${root}/pages/${i.ref}` : null;
    default: return i.url || null;
  }
}
const toLinks = (root: string, items: MenuItem[]): MenuLink[] =>
  items.flatMap((i) => { const url = linkUrl(root, i); return url ? [{ title: i.title, url, links: toLinks(root, i.children ?? []) }] : []; });

/** For the theme: `menus` by handle, plus `header_menu` / `footer_menu` (the ones set to show there). */
export async function menusForTheme(storeId: number, root: string) {
  const rows: StoreMenu[] = await db.select().from(storeMenus).where(eq(storeMenus.storeId, storeId)).orderBy(asc(storeMenus.id)).catch(() => []);
  const menus: Record<string, MenuDrop> = {};
  for (const r of rows) menus[r.handle] = { title: r.title, handle: r.handle, links: toLinks(root, r.items) };
  const header = rows.find((r) => r.inHeader), footer = rows.find((r) => r.inFooter);
  return { menus, header_menu: header ? menus[header.handle] : null, footer_menu: footer ? menus[footer.handle] : null, has_menus: rows.length > 0 };
}
