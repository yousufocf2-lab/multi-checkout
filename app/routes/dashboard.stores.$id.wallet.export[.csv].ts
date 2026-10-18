import type { LoaderFunctionArgs } from "@remix-run/node";
import { and, desc, eq, gte, lt, type SQL } from "drizzle-orm";
import { db, walletTransactions } from "~/db.server";
import { requireStore, requireViewer } from "~/lib/auth.server";
import { addDays, resolveRange } from "~/lib/dates";
import { TX_LABELS, type TxType } from "~/lib/wallet";
import { getWallet } from "~/lib/wallet.server";

/** Wallet ledger as CSV, same filters as the page. */
export async function loader({ request, params }: LoaderFunctionArgs) {
  const store = await requireStore(await requireViewer(request), params.id);
  const w = await getWallet(store.id);
  const url = new URL(request.url);
  const sp = new URLSearchParams(url.searchParams);
  if (!sp.get("range")) sp.set("range", "30d");
  const range = resolveRange(sp);
  const where: SQL[] = [
    eq(walletTransactions.walletId, w.id),
    gte(walletTransactions.createdAt, new Date(`${range.since}T00:00:00+05:30`)),
    lt(walletTransactions.createdAt, new Date(`${addDays(range.until, 1)}T00:00:00+05:30`)),
  ];
  const type = url.searchParams.get("type");
  if (type && type in TX_LABELS) where.push(eq(walletTransactions.type, type));
  const rows = await db.select().from(walletTransactions).where(and(...where)).orderBy(desc(walletTransactions.createdAt)).limit(50_000);
  const esc = (v: unknown) => { const s = String(v ?? ""); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const rs = (p: number) => (p / 100).toFixed(2);
  const head = ["Date (IST)", "Type", "Amount (₹)", "Balance after (₹)", "Reference", "Note", "By"];
  const lines = rows.map((t) => [
    t.createdAt.toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }), TX_LABELS[t.type as TxType] ?? t.type, rs(t.amountPaise), rs(t.balanceAfterPaise),
    `${t.refType}:${t.refId}`, t.note ?? "", t.createdBy ?? "",
  ].map(esc).join(","));
  return new Response("﻿" + [head.join(","), ...lines].join("\n"), {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="wallet-${store.slug}-${range.since}-to-${range.until}.csv"`, "Cache-Control": "no-store" },
  });
}
