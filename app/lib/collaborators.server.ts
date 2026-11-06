// Collaborators: agencies and freelancers ask for access to one store with the store's request code; the owner approves.
import { randomInt } from "node:crypto";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { collaboratorRequests, db, stores, type Store } from "~/db.server";

export const newCollabCode = () => String(randomInt(100000, 1000000));

/** The store's request code, created on first use. */
export async function collabCode(store: Pick<Store, "id" | "collabCode">) {
  if (store.collabCode) return store.collabCode;
  const code = newCollabCode();
  await db.update(stores).set({ collabCode: code }).where(eq(stores.id, store.id));
  return code;
}

export async function requestsFor(storeIds: number[]) {
  if (!storeIds.length) return [];
  return db.select().from(collaboratorRequests)
    .where(inArray(collaboratorRequests.storeId, storeIds))
    .orderBy(desc(collaboratorRequests.createdAt)).limit(100);
}

export async function pendingCount(storeId: number, login: string) {
  const [r] = await db.select({ n: sql<number>`count(*)::int` }).from(collaboratorRequests)
    .where(and(eq(collaboratorRequests.storeId, storeId), eq(collaboratorRequests.login, login), eq(collaboratorRequests.status, "pending")));
  return r?.n ?? 0;
}

// Wrong codes per IP (in memory, resets on restart): slows down guessing.
const misses = new Map<string, { n: number; at: number }>();
export function tooManyMisses(ip: string) {
  const m = misses.get(ip);
  return Boolean(m && Date.now() - m.at < 3600_000 && m.n >= 8);
}
export function noteMiss(ip: string) {
  const m = misses.get(ip);
  misses.set(ip, m && Date.now() - m.at < 3600_000 ? { n: m.n + 1, at: m.at } : { n: 1, at: Date.now() });
}
