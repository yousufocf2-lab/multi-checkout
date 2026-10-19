import { Form, useNavigation } from "@remix-run/react";
import { useEffect, useRef, useState } from "react";
import { Spinner } from "./ui";

/** Mobile / Email switch with one input. Submits as "contact". */
export function ContactInput({ mode, setMode, defaultValue, error }: { mode: "phone" | "email"; setMode: (m: "phone" | "email") => void; defaultValue?: string; error?: string }) {
  const [value, setValue] = useState(defaultValue && (defaultValue.includes("@") ? mode === "email" : mode === "phone") ? defaultValue : "");
  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <span className="label mb-0">{mode === "phone" ? "Mobile number" : "Email"}</span>
        <div className="flex rounded-lg bg-paper-sunk p-0.5 text-xs font-medium" role="tablist" aria-label="Sign in with">
          {(["phone", "email"] as const).map((m) => (
            <button key={m} type="button" role="tab" aria-selected={mode === m} onClick={() => { setMode(m); setValue(""); }}
              className={`rounded-md px-3 py-1 transition ${mode === m ? "bg-surface text-ink shadow-sm" : "text-ink-soft hover:text-ink"}`}>
              {m === "phone" ? "Mobile" : "Email"}
            </button>
          ))}
        </div>
      </div>
      {mode === "phone" ? (
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
export function OtpStep({ hidden, error, resendIn = 30, onChange, submitLabel }: {
  hidden: Record<string, string>; error?: string; resendIn?: number; onChange: () => void; submitLabel: string;
}) {
  const nav = useNavigation();
  const [code, setCode] = useState("");
  const [wait, setWait] = useState(resendIn);
  const formRef = useRef<HTMLFormElement>(null);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { setWait(resendIn); }, [resendIn]);
  useEffect(() => { if (wait <= 0) return; const t = setTimeout(() => setWait((w) => w - 1), 1000); return () => clearTimeout(t); }, [wait]);
  useEffect(() => { if (error) { setCode(""); input.current?.focus(); } }, [error]);
  const busy = nav.state !== "idle";
  const verifying = busy && nav.formData?.get("intent") === "verify";
  const resending = busy && nav.formData?.get("intent") === "send";
  return (
    <Form method="post" ref={formRef} className="space-y-4" noValidate>
      {Object.entries(hidden).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
      <input ref={input} name="code" value={code} inputMode="numeric" autoComplete="one-time-code" maxLength={6} autoFocus aria-label="6-digit code"
        onChange={(e) => {
          const v = e.target.value.replace(/\D/g, "").slice(0, 6);
          setCode(v);
          if (v.length === 6) setTimeout(() => formRef.current?.requestSubmit(formRef.current.querySelector<HTMLButtonElement>("[data-verify]") ?? undefined), 0);
        }}
        className="input num text-center text-2xl font-semibold tracking-[0.5em]" placeholder="••••••" aria-invalid={Boolean(error) || undefined} />
      {error && <p className="error-text" role="alert">{error}</p>}
      <button type="submit" name="intent" value="verify" data-verify className="btn-primary w-full py-3" disabled={code.length !== 6 || verifying}>
        {verifying ? <><Spinner /> Verifying</> : submitLabel}
      </button>
      <div className="flex items-center justify-between text-sm">
        <button type="button" onClick={onChange} className="text-ink-soft hover:text-ink">← Change details</button>
        <button type="submit" name="intent" value="send" formNoValidate disabled={wait > 0 || resending} className="font-medium text-brand disabled:text-ink-faint">
          {resending ? "Sending…" : wait > 0 ? `Resend in ${wait}s` : "Resend code"}
        </button>
      </div>
    </Form>
  );
}
