// Shipnex pushes shipment status changes here.
// POST /api/shipnex/:storeId   header X-Growpefy-Secret: <secret>  (or ?secret=)
// Body: one update, a list, or { shipments: [...] }. Each: { awb, status, order_id?, updated_at? }
import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { timingSafeEqual } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { courierAccounts, db } from "~/db.server";
import { applyPushedStatuses } from "~/lib/logistics.server";

const same = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

export async function loader() {
  return json({ ok: false, error: "Send status updates with POST" }, { status: 405 });
}

export async function action({ request, params }: ActionFunctionArgs) {
  if (request.method !== "POST") return json({ ok: false, error: "POST only" }, { status: 405 });
  const storeId = Number(params.storeId);
  if (!Number.isInteger(storeId) || storeId <= 0) return json({ ok: false, error: "Unknown store" }, { status: 404 });
  const [acc] = await db.select().from(courierAccounts).where(and(eq(courierAccounts.storeId, storeId), eq(courierAccounts.courier, "shipnex"))).limit(1);
  const given = request.headers.get("x-growpefy-secret") ?? request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? new URL(request.url).searchParams.get("secret") ?? "";
  if (!acc?.creds.token || !same(given, acc.creds.token)) return json({ ok: false, error: "Wrong or missing secret" }, { status: 401 });

  const body = (await request.json().catch(() => null)) as unknown;
  const raw = Array.isArray(body) ? body : (body as { shipments?: unknown[]; data?: unknown[] })?.shipments ?? (body as { data?: unknown[] })?.data ?? [body];
  const items = (Array.isArray(raw) ? raw : [raw]).filter((x): x is Record<string, unknown> => Boolean(x) && typeof x === "object").map((x) => ({
    awb: String(x.awb ?? x.awb_number ?? x.waybill ?? x.tracking_number ?? ""),
    status: String(x.status ?? x.current_status ?? x.shipment_status ?? ""),
    ref: x.order_id ?? x.order_number ?? x.reference ? String(x.order_id ?? x.order_number ?? x.reference) : undefined,
    at: x.updated_at ?? x.status_time ? String(x.updated_at ?? x.status_time) : undefined,
  }));
  if (!items.some((i) => i.awb && i.status)) return json({ ok: false, error: "Send awb and status" }, { status: 400 });
  const r = await applyPushedStatuses(storeId, "shipnex", items);
  return json({ ok: true, received: items.length, ...r });
}
