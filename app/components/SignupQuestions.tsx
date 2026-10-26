// Signup: websites (with platform), where they run ads, what they want to improve, and how soon.
import { useState } from "react";
import { Icon } from "~/components/Icons";
import { AD_CHANNELS, GOALS, SITE_PLATFORMS, URGENCY } from "~/lib/clients";
import type { SignupProfile } from "~/db/schema";

type Site = { url: string; platform: "shopify" | "woocommerce" | "other"; other?: string };

export function SignupQuestions({ initial, error }: { initial?: SignupProfile | null; error?: string }) {
  const [sites, setSites] = useState<Site[]>(initial?.websites?.length ? initial.websites : [{ url: "", platform: "shopify" }]);
  const [ads, setAds] = useState<string[]>(initial?.adChannels ?? []);
  const [adOther, setAdOther] = useState(initial?.adOther ?? "");
  const [goals, setGoals] = useState<string[]>(initial?.goals ?? []);
  const [goalOther, setGoalOther] = useState(initial?.goalOther ?? "");
  const [urgency, setUrgency] = useState(initial?.urgency ?? "");
  const toggle = (list: string[], set: (v: string[]) => void, id: string) => set(list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
  const edit = (i: number, patch: Partial<Site>) => setSites(sites.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  const profile: SignupProfile = { websites: sites, adChannels: ads as SignupProfile["adChannels"], adOther, goals, goalOther, urgency: (urgency || undefined) as SignupProfile["urgency"] };

  return (
    <div className="space-y-5">
      <input type="hidden" name="profile" value={JSON.stringify(profile)} />

      <fieldset>
        <legend className="label">Your website</legend>
        <div className="space-y-2">
          {sites.map((s, i) => (
            <div key={i} className="rounded-xl border border-rule p-2.5">
              <div className="flex gap-2">
                <input value={s.url} onChange={(e) => edit(i, { url: e.target.value })} placeholder="yourbrand.com" inputMode="url" autoComplete="url"
                  className="input min-w-0 flex-1" aria-label={`Website ${i + 1}`} />
                <select value={s.platform} onChange={(e) => edit(i, { platform: e.target.value as Site["platform"] })} className="input w-[132px] shrink-0" aria-label="Built on">
                  {SITE_PLATFORMS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
                </select>
                {sites.length > 1 && (
                  <button type="button" onClick={() => setSites(sites.filter((_, j) => j !== i))} className="shrink-0 rounded-lg px-2 text-ink-faint hover:text-bad" aria-label="Remove website"><Icon name="close" className="h-4 w-4" /></button>
                )}
              </div>
              {s.platform === "other" && (
                <input value={s.other ?? ""} onChange={(e) => edit(i, { other: e.target.value })} placeholder="What is it built on? e.g. custom code, Wix, Dukaan"
                  className="input mt-2" aria-label="Describe your platform" />
              )}
            </div>
          ))}
        </div>
        {sites.length < 5 && (
          <button type="button" onClick={() => setSites([...sites, { url: "", platform: "shopify" }])} className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-pine hover:underline">
            <Icon name="plus" className="h-3.5 w-3.5" />Add another website
          </button>
        )}
      </fieldset>

      <fieldset>
        <legend className="label">Where do you run ads? <span className="font-normal text-ink-faint">Pick all that apply</span></legend>
        <div className="flex flex-wrap gap-2">
          {AD_CHANNELS.map((c) => <Chip key={c.id} on={ads.includes(c.id)} onClick={() => toggle(ads, setAds, c.id)}>{c.label}</Chip>)}
        </div>
        {ads.includes("other") && <input value={adOther} onChange={(e) => setAdOther(e.target.value)} placeholder="Where else? e.g. Snapchat, influencers" className="input mt-2" aria-label="Other ad channels" />}
      </fieldset>

      <fieldset>
        <legend className="label">What do you want to improve? <span className="font-normal text-ink-faint">Pick all that apply</span></legend>
        <div className="flex flex-wrap gap-2">
          {GOALS.map((g) => <Chip key={g.id} on={goals.includes(g.id)} onClick={() => toggle(goals, setGoals, g.id)}>{g.label}</Chip>)}
        </div>
        {goals.includes("other") && <textarea value={goalOther} onChange={(e) => setGoalOther(e.target.value)} rows={2} placeholder="Tell us what you'd like to change in your store" className="input mt-2" aria-label="Other goal" />}
      </fieldset>

      <fieldset>
        <legend className="label">How soon do you want to start?</legend>
        <div className="grid grid-cols-2 gap-2">
          {URGENCY.map((u) => (
            <button key={u.id} type="button" onClick={() => setUrgency(u.id)} aria-pressed={urgency === u.id}
              className={`rounded-xl border-2 px-3 py-2 text-left transition ${urgency === u.id ? "border-pine bg-pine-tint/40" : "border-rule hover:border-rule-strong"}`}>
              <span className="block text-sm font-semibold">{u.label}</span>
              <span className="block text-xs text-ink-soft">{u.hint}</span>
            </button>
          ))}
        </div>
      </fieldset>
      {error && <p className="error-text" role="alert">{error}</p>}
    </div>
  );
}

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={on}
      className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition ${on ? "border-pine bg-pine text-white" : "border-rule-strong text-ink-soft hover:border-ink hover:text-ink"}`}>
      {on && <Icon name="check" className="h-3.5 w-3.5" />}{children}
    </button>
  );
}
