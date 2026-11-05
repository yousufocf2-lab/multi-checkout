import { startPaymentRecheck } from "~/lib/gateways/index.server";
import { startAutoShip } from "~/lib/auto-ship.server";
import { logFunnelAudit } from "~/lib/diagnostics.server";

// Railway's health check (and the server itself) hits this right after every deploy: a good moment to start
// background jobs, so they run even when nobody opens the dashboard or a checkout.
export const loader = () => {
  startPaymentRecheck();
  startAutoShip();
  setTimeout(() => void logFunnelAudit(), 45_000).unref?.();
  return new Response("ok");
};
