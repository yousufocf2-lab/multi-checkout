// Browser side of the MSG91 OTP Widget (exposeMethods mode): we keep our own OTP UI and call the widget's
// sendOtp / verifyOtp / retryOtp. The access token from verifyOtp is then checked on our server.
/** length = digits the widget sends (MSG91 widgets default to 4) */
export type WidgetConfig = { widgetId: string; tokenAuth: string; length?: number };
export const codeLength = (cfg: WidgetConfig | null | undefined) => (cfg ? cfg.length ?? 4 : 6);

type Cb = (data: { type?: string; message?: string } | undefined) => void;
type W = Window & {
  initSendOTP?: (cfg: Record<string, unknown>) => void;
  sendOtp?: (identifier: string, ok: Cb, fail: Cb) => void;
  verifyOtp?: (otp: string, ok: Cb, fail: Cb, reqId?: string) => void;
  retryOtp?: (channel: string | null, ok: Cb, fail: Cb, reqId?: string) => void;
  __gpMsg91?: Promise<void>;
};

const SCRIPT = "https://verify.msg91.com/otp-provider.js";

function load(cfg: WidgetConfig): Promise<void> {
  const w = window as W;
  if (cfg.widgetId === "test") return Promise.resolve();
  w.__gpMsg91 ??= new Promise<void>((resolve, reject) => {
    const s = document.createElement("script");
    s.src = SCRIPT; s.async = true;
    s.onload = () => {
      try {
        w.initSendOTP?.({ widgetId: cfg.widgetId, tokenAuth: cfg.tokenAuth, exposeMethods: true, success: () => {}, failure: () => {} });
        // initSendOTP sets up the methods asynchronously
        let n = 0;
        const t = setInterval(() => { if (w.sendOtp && w.verifyOtp) { clearInterval(t); resolve(); } else if (++n > 50) { clearInterval(t); reject(new Error("OTP service didn't load")); } }, 100);
      } catch (e) { reject(e as Error); }
    };
    s.onerror = () => reject(new Error("OTP service didn't load"));
    document.head.appendChild(s);
  });
  return w.__gpMsg91;
}

const message = (d: { message?: string } | undefined, fallback: string) => (d?.message && !/^[a-f0-9-]{20,}$/i.test(d.message) ? d.message : fallback);

/** Sends an OTP to an Indian 10-digit mobile. Resolves with the request id. */
export async function widgetSend(cfg: WidgetConfig, phone: string): Promise<string> {
  if (cfg.widgetId === "test") return "test-req";
  await load(cfg);
  const w = window as W;
  return new Promise((resolve, reject) => w.sendOtp!(`91${phone}`, (d) => resolve(d?.message ?? ""), (e) => reject(new Error(message(e, "Couldn't send the OTP. Please try again.")))));
}

export async function widgetRetry(cfg: WidgetConfig, reqId: string): Promise<void> {
  if (cfg.widgetId === "test") return;
  await load(cfg);
  const w = window as W;
  return new Promise((resolve, reject) => w.retryOtp!(null, () => resolve(), (e) => reject(new Error(message(e, "Couldn't resend the OTP."))), reqId));
}

/** Verifies the code with MSG91. Resolves with the access token our server checks. */
export async function widgetVerify(cfg: WidgetConfig, code: string, reqId: string, phone: string): Promise<string> {
  if (cfg.widgetId === "test") {
    if (code !== "123456".slice(0, codeLength(cfg))) throw new Error("That OTP isn't right. Check and try again.");
    return `test:${phone}`;
  }
  await load(cfg);
  const w = window as W;
  return new Promise((resolve, reject) => w.verifyOtp!(code, (d) => resolve(d?.message ?? ""), (e) => reject(new Error(message(e, "That OTP isn't right. Check and try again."))), reqId));
}
