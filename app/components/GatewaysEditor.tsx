// Store settings: up to 3 payment gateways in priority order (Primary, Backup 1, Backup 2).
import { useState } from "react";
import { GATEWAYS, MAX_GATEWAYS, SLOT_LABELS, gatewayById } from "~/lib/gateways/catalog";
import { PasswordInput } from "./ui";

/** What the browser gets about a saved gateway: public fields only; secrets as "saved" flags. */
export type GatewayView = { id: string; mode: "test" | "live"; on: boolean; values: Record<string, string>; saved: Record<string, boolean> };

type Row = GatewayView & { key: number };

export function GatewaysEditor({ initial, errors = {}, webhookBase }: { initial: GatewayView[]; errors?: Record<string, string>; webhookBase?: string }) {
  const [rows, setRows] = useState<Row[]>(() => initial.slice(0, MAX_GATEWAYS).map((g, i) => ({ ...g, key: i })));
  const used = new Set(rows.map((r) => r.id));
  const add = () => {
    const next = GATEWAYS.find((g) => !used.has(g.id));
    if (!next || rows.length >= MAX_GATEWAYS) return;
    setRows((r) => [...r, { id: next.id, mode: "test", on: true, values: {}, saved: {}, key: Date.now() }]);
  };
  const move = (i: number, d: -1 | 1) => setRows((r) => {
    const j = i + d;
    if (j < 0 || j >= r.length) return r;
    const n = [...r];
    [n[i], n[j]] = [n[j], n[i]];
    return n;
  });
  const update = (i: number, patch: Partial<Row>) => setRows((r) => r.map((x, k) => (k === i ? { ...x, ...patch } : x)));
  const remove = (i: number) => setRows((r) => r.filter((_, k) => k !== i));

  return (
    <div className="space-y-3">
      <input type="hidden" name="gwCount" value={rows.length} />
      {rows.length === 0 && <p className="rounded-xl border border-dashed border-rule-strong px-4 py-5 text-center text-sm text-ink-soft">No payment gateway yet. Add one to take online payments.</p>}
      {rows.map((r, i) => {
        const info = gatewayById(r.id)!;
        return (
          <div key={r.key} className={`rounded-xl border p-4 ${r.on ? "border-rule" : "border-dashed border-rule-strong bg-paper"}`}>
            <div className="flex flex-wrap items-center gap-2">
              <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${i === 0 ? "bg-pine text-white" : "bg-paper-sunk text-ink-soft"}`}>{SLOT_LABELS[i]}</span>
              <select name={`gw${i}_id`} value={r.id} onChange={(e) => update(i, { id: e.target.value, values: {}, saved: {} })} className="input h-9 w-auto py-0 pr-8 text-sm font-medium" aria-label={`${SLOT_LABELS[i]} gateway`}>
                {GATEWAYS.filter((g) => g.id === r.id || !used.has(g.id)).map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
              </select>
              <select name={`gw${i}_mode`} value={r.mode} onChange={(e) => update(i, { mode: e.target.value === "live" ? "live" : "test" })} className="input h-9 w-auto py-0 pr-8 text-sm" aria-label="Mode">
                <option value="test">Test mode</option>
                <option value="live">Live</option>
              </select>
              <label className="ml-1 flex cursor-pointer items-center gap-1.5 text-sm">
                <input type="checkbox" name={`gw${i}_on`} checked={r.on} onChange={(e) => update(i, { on: e.target.checked })} className="h-4 w-4" /> On
              </label>
              <span className="ml-auto flex items-center gap-1">
                <button type="button" onClick={() => move(i, -1)} disabled={i === 0} className="btn-quiet h-8 w-8 p-0 text-base disabled:opacity-30" aria-label="Move up" title="Move up">↑</button>
                <button type="button" onClick={() => move(i, 1)} disabled={i === rows.length - 1} className="btn-quiet h-8 w-8 p-0 text-base disabled:opacity-30" aria-label="Move down" title="Move down">↓</button>
                <button type="button" onClick={() => remove(i)} className="btn-quiet h-8 px-2 text-xs text-bad">Remove</button>
              </span>
            </div>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              {info.fields.map((f) => {
                const name = `gw${i}_f_${f.name}`;
                const label = `${f.label}${f.optional ? " (optional)" : ""}`;
                return (
                  <label key={f.name} className="block">
                    <span className="label">{label}</span>
                    {f.secret
                      ? <PasswordInput name={name} autoComplete="new-password" className="input" placeholder={r.saved[f.name] ? "Saved. Leave blank to keep it." : f.placeholder} />
                      : <input name={name} defaultValue={r.values[f.name] ?? ""} autoComplete="off" spellCheck={false} className="input" placeholder={f.placeholder} />}
                    {f.hint && <span className="hint">{f.hint}</span>}
                  </label>
                );
              })}
            </div>
            <p className="mt-2 text-xs text-ink-faint">Keys: {info.where}{info.webhook && webhookBase ? <> · Webhook URL: <code className="break-all">{webhookBase}/pg/{info.id}/webhook</code></> : null}</p>
            {errors[`gw${i}`] && <p className="error-text mt-1">{errors[`gw${i}`]}</p>}
          </div>
        );
      })}
      {rows.length < MAX_GATEWAYS && (
        <button type="button" onClick={add} className="btn-secondary w-full py-2.5 text-sm">+ Add {rows.length ? "a backup gateway" : "a payment gateway"}</button>
      )}
      <p className="text-xs text-ink-faint">The primary gateway takes payments. If it can't open the payment page, the next one opens instead, and if a customer's payment fails, "Try again" uses the next one. Up to {MAX_GATEWAYS} gateways.</p>
    </div>
  );
}
