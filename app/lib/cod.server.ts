import { and, eq, sql } from "drizzle-orm";
import { customerFlags, db, type Store } from "~/db.server";

export type CodStatus = { allowed: boolean; reason: "disabled" | "paid_online_before" | "cooldown" | null; until: string | null };

export const MAX_COOLDOWN_HOURS = 8760; // 1 year

export function normalizePhone(v: string) {
  return v.replace(/\D/g, "").replace(/^(91|0)(?=\d{10}$)/, "");
}

/** Can this phone number use Cash on Delivery right now? Prepaid is never blocked. */
/** `partial`: for Partial COD, which follows the COD rules but not the COD on/off switch. */
export async function codEligibility(store: Store, phoneRaw: string, opts?: { partial?: boolean }): Promise<CodStatus> {
  if (!store.codEnabled && !opts?.partial) return { allowed: false, reason: "disabled", until: null };
  const phone = normalizePhone(phoneRaw);
  if (!/^\d{10}$/.test(phone)) return { allowed: true, reason: null, until: null };

  const [f] = await db
    .select()
    .from(customerFlags)
    .where(and(eq(customerFlags.storeId, store.id), eq(customerFlags.phone, phone)))
    .limit(1);
  if (!f) return { allowed: true, reason: null, until: null };

  if (store.codBlockAfterPrepaid && f.prepaidAt) return { allowed: false, reason: "paid_online_before", until: null };

  if (store.codCooldownEnabled && f.lastCodAt) {
    const hours = Math.max(0, Math.min(MAX_COOLDOWN_HOURS, store.codCooldownHours));
    const until = new Date(f.lastCodAt.getTime() + hours * 3600_000);
    if (until > new Date()) return { allowed: false, reason: "cooldown", until: until.toISOString() };
  }
  return { allowed: true, reason: null, until: null };
}

export async function recordOrderForCod(storeId: number, phoneRaw: string, kind: "prepaid" | "cod") {
  const phone = normalizePhone(phoneRaw);
  if (!/^\d{10}$/.test(phone)) return;
  const now = new Date();
  await db
    .insert(customerFlags)
    .values({ storeId, phone, prepaidAt: kind === "prepaid" ? now : null, lastCodAt: kind === "cod" ? now : null })
    .onConflictDoUpdate({
      target: [customerFlags.storeId, customerFlags.phone],
      set: kind === "prepaid" ? { prepaidAt: sql`coalesce(${customerFlags.prepaidAt}, now())` } : { lastCodAt: now },
    });
}

export function codBlockedMessage(s: CodStatus) {
  if (s.reason === "disabled") return "Cash on Delivery is not available for this store.";
  if (s.reason === "paid_online_before") return "Cash on Delivery isn't available for this number. Pay online to place your order.";
  if (s.reason === "cooldown" && s.until) {
    const t = new Date(s.until).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
    return `You recently placed a Cash on Delivery order. COD opens again on ${t}. You can pay online right now.`;
  }
  return "Cash on Delivery isn't available right now.";
}
