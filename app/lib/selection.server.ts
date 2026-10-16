import { createCookie } from "@remix-run/node";
import type { Store } from "~/db/schema";
import { selectedStoreIds } from "~/components/StoreFilter";

/** Which store the dashboard is focused on: a store id, or null for "All stores". */
const storeCookie = createCookie("cx_store", { path: "/", httpOnly: true, sameSite: "lax", maxAge: 60 * 60 * 24 * 365 });

export async function selectedStore(request: Request): Promise<number | null> {
  const v = await storeCookie.parse(request.headers.get("Cookie"));
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
}

export function selectCookie(id: number | null) {
  return storeCookie.serialize(id ? String(id) : "all", { secure: process.env.NODE_ENV === "production" });
}

/**
 * Stores a dashboard page should show. ?s=1&s=2 in the URL wins (multi-store filter);
 * otherwise the store picked in the sidebar; otherwise every store.
 */
export async function dashboardScope(request: Request, all: Store[]) {
  const params = new URL(request.url).searchParams;
  const picked = selectedStoreIds(params).filter((id) => all.some((s) => s.id === id));
  if (picked.length) return { scope: all.filter((s) => picked.includes(s.id)), picked, locked: false };
  const sel = await selectedStore(request);
  const one = sel ? all.find((s) => s.id === sel) : undefined;
  if (one) return { scope: [one], picked: [one.id], locked: true };
  return { scope: all, picked: [] as number[], locked: false };
}
