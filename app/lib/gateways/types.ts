import type { Order, Store, StoreGateway } from "~/db/schema";

export type StartContext = {
  store: Store;
  order: Order;
  cfg: StoreGateway;
  txn: string; // our transaction id for this try (unique per try)
  amountPaise: number; // to collect now (advance for Partial COD)
  returnUrl: string; // customer comes back here (txn is in the query)
  notifyUrl: string; // server-to-server notification
};

/** How the pay page sends the customer to the gateway. */
export type StartResult =
  | { type: "form"; action: string; fields: Record<string, string>; ref?: string | null }
  | { type: "redirect"; url: string; ref?: string | null }
  | { type: "script"; src: string; code: string; ref?: string | null }; // a gateway JS checkout opened on our page

export type Verification = {
  status: "success" | "failure" | "pending" | "not_found";
  amountPaise: number | null; // amount the gateway says was paid
  debitedPaise?: number | null; // what the customer actually paid (after bank offers)
  ref: string | null; // gateway's payment id
  raw: unknown;
};

export interface GatewayAdapter {
  id: string;
  /** Creates the payment at the gateway. Throws when the gateway can't start one (then the next gateway is tried). */
  start(ctx: StartContext): Promise<StartResult>;
  /** Asks the gateway (server to server) what happened to a transaction. Never trust the browser. */
  verify(cfg: StoreGateway, txn: string, ref?: string | null): Promise<Verification>;
  /**
   * Reads what the gateway posted back to the return URL. Returns a result only when the gateway signs it
   * (hash / signature / encryption) and the signature checks out; otherwise null and verify() decides.
   */
  fromReturn?(cfg: StoreGateway, params: Record<string, string>, txn: string): Verification | null;
  /** Finds our transaction id in a webhook body. */
  webhookTxn?(body: Record<string, unknown>): string | null;
  /** Checks the keys work. Returns a short message or throws. */
  test(cfg: StoreGateway): Promise<string>;
}

export const rupees = (paise: number) => (paise / 100).toFixed(2);
export const toPaise = (v: unknown) => {
  const n = parseFloat(String(v ?? ""));
  return Number.isFinite(n) ? Math.round(n * 100) : null;
};
export const live = (cfg: StoreGateway) => cfg.mode === "live";

export async function readJson(res: Response) {
  const text = await res.text();
  try { return JSON.parse(text) as Record<string, unknown>; } catch { return { raw: text.slice(0, 500) } as Record<string, unknown>; }
}

/** Customer email for gateways that require one. */
export const emailFor = (order: Order) => order.customer.email || `customer${order.customer.phone}@noemail.in`;
export const nameFor = (order: Order) => `${order.customer.firstName} ${order.customer.lastName}`.trim() || "Customer";
