import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { guessStateFromPincode } from "~/lib/pincode";
import { stateCodeFromName } from "~/lib/states";

type Result = { city: string | null; state: string | null; source: "lookup" | "guess" | "none" };
const cache = new Map<string, Result>();

/** City + state for an Indian pincode. Cached in memory; falls back to a prefix guess. */
export async function loader({ params }: LoaderFunctionArgs) {
  const pin = String(params.pin ?? "");
  if (!/^[1-9]\d{5}$/.test(pin)) return json({ city: null, state: null, source: "none" } satisfies Result, { status: 400 });
  const hit = cache.get(pin);
  if (hit) return json(hit, { headers: { "Cache-Control": "public, max-age=86400" } });

  let result: Result = { city: null, state: guessStateFromPincode(pin), source: "guess" };
  try {
    const res = await fetch(`https://api.postalpincode.in/pincode/${pin}`, { signal: AbortSignal.timeout(3500) });
    const data = (await res.json()) as { Status?: string; PostOffice?: { District?: string; State?: string }[] }[];
    const po = data?.[0]?.PostOffice?.[0];
    if (po) result = { city: po.District ?? null, state: stateCodeFromName(po.State ?? "") ?? result.state, source: "lookup" };
  } catch {
    // keep the guess
  }
  if (result.source === "lookup") {
    if (cache.size > 20000) cache.clear();
    cache.set(pin, result);
  }
  return json(result, { headers: { "Cache-Control": result.source === "lookup" ? "public, max-age=86400" : "no-store" } });
}
