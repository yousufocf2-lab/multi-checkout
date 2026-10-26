// Super admin → Clients: every signup with how far along onboarding they are.
import { desc, eq, sql } from "drizzle-orm";
import { db, leadCrm, users } from "~/db.server";
import { kycIncomplete } from "./kyc";
import { STEPS, type StepId } from "./clients";
import { tagOf } from "./leads.server";
import { touchSummary } from "./attribution";

export type ClientRow = Awaited<ReturnType<typeof listClients>>[number];

export async function listClients(onlyId?: number) {
  const rows = await db.select({
    u: users,
    stores: sql<number>`(select count(*)::int from stores s where s.owner_id = ${users.id})`,
    firstStoreAt: sql<string | null>`(select min(s.created_at) from stores s where s.owner_id = ${users.id})`,
    connected: sql<number>`(select count(*)::int from stores s where s.owner_id = ${users.id} and (s.admin_token is not null or s.woo_secret is not null))`,
    live: sql<string | null>`(select min(c.created_at) from checkout_sessions c join stores s on s.id = c.store_id where s.owner_id = ${users.id})`,
    orders: sql<number>`(select count(*)::int from orders o join stores s on s.id = o.store_id where s.owner_id = ${users.id} and o.status in ('paid','cod_placed'))`,
    firstOrderAt: sql<string | null>`(select min(o.created_at) from orders o join stores s on s.id = o.store_id where s.owner_id = ${users.id} and o.status in ('paid','cod_placed'))`,
    recharged: sql<string | null>`(select coalesce(sum(r.credit_paise), 0)::text from wallet_recharges r join wallets w on w.id = r.wallet_id join stores s on s.id = w.store_id where s.owner_id = ${users.id} and r.status = 'paid')`,
    firstRechargeAt: sql<string | null>`(select min(r.paid_at) from wallet_recharges r join wallets w on w.id = r.wallet_id join stores s on s.id = w.store_id where s.owner_id = ${users.id} and r.status = 'paid')`,
    crmStatus: leadCrm.status,
  })
    .from(users)
    .leftJoin(leadCrm, sql`${leadCrm.kind} = 'signup' and ${leadCrm.refId} = ${users.id}::text`)
    .where(onlyId ? eq(users.id, onlyId) : undefined)
    .orderBy(desc(users.createdAt));

  return rows.map((r) => {
    const u = r.u;
    const kycDone = !kycIncomplete(u);
    const at = (v: string | Date | null | undefined) => (v ? new Date(v).toISOString() : null);
    const done: Record<StepId, string | null> = {
      signup: u.createdAt.toISOString(),
      kyc: kycDone ? at(u.kycSubmittedAt) ?? u.createdAt.toISOString() : null,
      store: at(r.firstStoreAt),
      connected: r.connected > 0 ? at(r.firstStoreAt) : null,
      live: at(r.live),
      order: at(r.firstOrderAt),
      recharge: Number(r.recharged ?? 0) > 0 ? at(r.firstRechargeAt) : null,
    };
    // Furthest step reached (later steps can happen out of order, e.g. order before recharge)
    let reached = 0;
    STEPS.forEach((s, i) => { if (done[s.id]) reached = i; });
    const next = STEPS.find((s) => !done[s.id]) ?? null;
    return {
      id: u.id, name: u.name, phone: u.phone, email: u.email, active: u.active,
      createdAt: u.createdAt.toISOString(),
      contactName: u.kyc.contactName ?? null, kycStatus: u.kycStatus,
      signup: u.signup ?? null,
      source: tagOf(u.attribution), via: touchSummary(u.attribution?.last ?? u.attribution?.first),
      stores: r.stores, orders: r.orders, rechargedPaise: Number(r.recharged ?? 0),
      steps: done, reached, next: next ? { id: next.id, label: next.label } : null,
      crmStatus: r.crmStatus ?? "new",
    };
  });
}

/** Counts per step for the overview funnel: how many clients reached each step. */
export function funnel(list: ClientRow[]) {
  return STEPS.map((s) => ({ id: s.id, label: s.short, n: list.filter((c) => c.steps[s.id]).length }));
}
