import { startPaymentRecheck } from "~/lib/gateways/index.server";

// Railway's health check hits this right after every deploy: a good moment to start the payment recheck job,
// so unpaid online orders are checked even when nobody opens the dashboard or a checkout.
export const loader = () => {
  startPaymentRecheck();
  return new Response("ok");
};
