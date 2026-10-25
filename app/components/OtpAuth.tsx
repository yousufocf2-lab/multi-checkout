import { Form, useNavigation } from "@remix-run/react";
import { useEffect, useRef, useState } from "react";
import { Spinner } from "./ui";
import { codeLength, widgetRetry, widgetSend, widgetVerify, type WidgetConfig } from "./msg91-widget";

/** Mobile / Email switch with one input. Submits as "contact". */
export function ContactInput({ mode, setMode, defaultValue, error, phoneOnly }: { mode: "phone" | "email"; setMode: (m: "phone" | "email") => void; defaultValue?: string; error?: string; phoneOnly?: boolean }) {
  const [value, setValue] = useState(defaultValue && (defaultValue.includes("@") ? mode === "email" : mode === "phone") ? defaultValue : "");
  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <span className="label mb-0">{mode === "phone" ? "Mobile number" : "Email"}</span>
        {!phoneOnly && <div className="flex rounded-lg bg-paper-sunk p-0.5 text-xs font-medium" role="tablist" aria-label="Sign in with">
          {(["phone", "email"] as const).map((m) => (
            <button key={m} type="button" role="tab" aria-selected={mode === m} onClick={() => { setMode(m); setValue(""); }}
              className={`rounded-md px-3 py-1 transition ${mode === m ? "bg-surface text-ink shadow-sm" : "text-ink-soft hover:text-ink"}`}>
              {m === "phone" ? "Mobile" : "Email"}
            </button>
          ))}
        </div>}
      </div>
      {mode === "phone" || phoneOnly ? (
        <div className="flex">
          <span className="flex items-center rounded-l-lg border border-r-0 border-rule-strong bg-paper px-3 text-[15px] text-ink-soft">+91</span>
          <input name="contact" inputMode="numeric" autoComplete="tel-national" maxLength={10} className="input rounded-l-none" placeholder="10-digit mobile number"
            value={value} onChange={(e) => setValue(e.target.value.replace(/\D/g, "").slice(0, 10))} aria-invalid={Boolean(error) || undefined} aria-label="Mobile number" />
        </div>
      ) : (
        <input name="contact" type="email" autoComplete="email" className="input" placeholder="you@yourbrand.com"
          value={value} onChange={(e) => setValue(e.target.value)} aria-invalid={Boolean(error) || undefined} aria-label="Email" />
      )}
      {error && <span className="error-text">{error}</span>}
    </div>
  );
}

/** 6-digit code entry with resend timer. Posts intent=verify (or intent=send to resend). */
export function OtpStep({ hidden, error, resendIn = 30, onChange, submitLabel, widget, phone }: {
  hidden: Record<string, string>; error?: string; resendIn?: number; onChange: () => void; submitLabel: string;
  /** MSG91 widget mode (SMS without DLT): the browser sends and checks the code, the form posts the token */
  widget?: WidgetConfig | null; phone?: string;
}) {
  const nav = useNavigation();
  const [code, setCode] = useState("");
  const [wait, setWait] = useState(resendIn);
  const formRef = useRef<HTMLFormElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [w, setW] = useState<{ reqId: string | null; token: string; busy: boolean; error: string | null }>({ reqId: null, token: "", busy: false, error: null });
  const useWidget = Boolean(widget && phone);
  const len = useWidget ? codeLength(widget) : 6;
  useEffect(() => {
    if (!useWidget) return;
    setW((x) => ({ ...x, busy: true }));
    widgetSend(widget!, phone!).then((reqId) => setW((x) => ({ ...x, reqId, busy: false }))).catch((e: Error) => setW((x) => ({ ...x, busy: false, error: e.message })));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [useWidget, phone]);
  const verifyWithWidget = (v: string) => {
    if (!w.reqId) return;
    setW((x) => ({ ...x, busy: true, error: null }));
    widgetVerify(widget!, v, w.reqId, phone!)
      .then((token) => { setW((x) => ({ ...x, token, busy: false })); setTimeout(() => formRef.current?.requestSubmit(formRef.current.querySelector<HTMLButtonElement>("[data-verify]") ?? undefined), 0); })
      .catch((e: Error) => setW((x) => ({ ...x, busy: false, error: e.message })));
  };
  const resendWidget = () => {
    if (!w.reqId) return;
    setW((x) => ({ ...x, busy: true, error: null }));
    widgetRetry(widget!, w.reqId).then(() => { setW((x) => ({ ...x, busy: false })); setWait(30); }).catch((e: Error) => setW((x) => ({ ...x, busy: false, error: e.message })));
  };
  useEffect(() => { setWait(resendIn); }, [resendIn]);
  useEffect(() => { if (wait <= 0) return; const t = setTimeout(() => setWait((w) => w - 1), 1000); return () => clearTimeout(t); }, [wait]);
  useEffect(() => { if (error) { setCode(""); input.current?.focus(); } }, [error]);
  const busy = nav.state !== "idle";
  const verifying = busy && nav.formData?.get("intent") === "verify";
  const resending = busy && nav.formData?.get("intent") === "send";
  return (
    <Form method="post" ref={formRef} className="space-y-4" noValidate>
      {Object.entries(hidden).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
      <input ref={input} name="code" value={code} inputMode="numeric" autoComplete="one-time-code" maxLength={len} autoFocus aria-label={`${len}-digit code`}
        onChange={(e) => {
          const v = e.target.value.replace(/\D/g, "").slice(0, len);
          setCode(v);
          if (v.length === len) {
            if (useWidget) verifyWithWidget(v);
            else setTimeout(() => formRef.current?.requestSubmit(formRef.current.querySelector<HTMLButtonElement>("[data-verify]") ?? undefined), 0);
          }
        }}
        className="input num text-center text-2xl font-semibold tracking-[0.5em]" placeholder="••••••" aria-invalid={Boolean(error) || undefined} />
      {useWidget && <input type="hidden" name="token" value={w.token} />}
      {(w.error ?? error) && <p className="error-text" role="alert">{w.error ?? error}</p>}
      <button type={useWidget && !w.token ? "button" : "submit"} name="intent" value="verify" data-verify className="btn-primary w-full py-3" disabled={code.length !== len || verifying || w.busy}
        onClick={useWidget && !w.token ? () => verifyWithWidget(code) : undefined}>
        {verifying || (w.busy && w.reqId) ? <><Spinner /> Verifying</> : submitLabel}
      </button>
      <div className="flex items-center justify-between text-sm">
        <button type="button" onClick={onChange} className="text-ink-soft hover:text-ink">← Change details</button>
        <button type={useWidget ? "button" : "submit"} name="intent" value="send" formNoValidate disabled={wait > 0 || resending || w.busy} onClick={useWidget ? resendWidget : undefined} className="font-medium text-brand disabled:text-ink-faint">
          {resending ? "Sending…" : wait > 0 ? `Resend in ${wait}s` : "Resend code"}
        </button>
      </div>
    </Form>
  );
}
