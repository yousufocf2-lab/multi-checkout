// Team activity log: logins, access changes and collaborator requests, newest first.
import { and, desc, eq, isNull } from "drizzle-orm";
import { db, teamActivity } from "~/db.server";
import type { Scope } from "./team";

export async function logTeam(scope: Scope, ownerId: number | null, actor: string, action: string, detail?: string | null) {
  try {
    await db.insert(teamActivity).values({ scope, ownerId, actor: actor.slice(0, 80), action: action.slice(0, 80), detail: detail?.slice(0, 300) ?? null });
  } catch (e) {
    console.error("[team-activity]", e instanceof Error ? e.message : e);
  }
}

export async function teamLog(scope: Scope, ownerId: number | null, limit = 100) {
  return db.select().from(teamActivity)
    .where(and(eq(teamActivity.scope, scope), ownerId == null ? isNull(teamActivity.ownerId) : eq(teamActivity.ownerId, ownerId)))
    .orderBy(desc(teamActivity.createdAt)).limit(limit);
}
