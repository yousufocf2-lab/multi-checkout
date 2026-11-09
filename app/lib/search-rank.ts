// Forgiving product search ranking (no database here, so it can be tested on its own).
export type Doc = { id: number; title: string; handle: string; title_t: string[]; other_t: string[]; compact: string; image: string | null; price: number; compare: number };

export const norm = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
export const tokens = (s: string) => norm(s).split(/[^a-z0-9\u0900-\u097f]+/).filter((t) => t.length > 0);
export const compact = (s: string) => norm(s).replace(/[^a-z0-9\u0900-\u097f]+/g, "");
// Few common shopping words people type differently
const SYN: Record<string, string[]> = {
  watch: ["smartwatch", "watches"], smartwatch: ["watch"], earbud: ["earbuds", "buds", "tws"], earbuds: ["buds", "tws", "earphones"], buds: ["earbuds", "tws"],
  headphone: ["headphones", "headset"], headphones: ["headset"], speaker: ["speakers"], charger: ["adapter"], powerbank: ["power", "bank"], mic: ["microphone"],
  tshirt: ["t", "shirt", "tee"], tee: ["tshirt"], shoes: ["shoe", "sneakers", "footwear"], phone: ["mobile"], mobile: ["phone"],
};

function lev(a: string, b: string, max: number) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i]; let best = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (cur[j] < best) best = cur[j];
    }
    if (best > max) return max + 1;
    prev = cur;
  }
  return prev[b.length];
}

/** How well one typed word matches a word of the product (0..1). */
function wordScore(q: string, words: string[]) {
  let best = 0;
  for (const w of words) {
    let s = 0;
    if (w === q) s = 1;
    else if (q.length >= 2 && w.startsWith(q)) s = 0.88;
    else if (q.length >= 3 && w.length >= 3 && q.startsWith(w)) s = 0.7;
    else if (q.length >= 3 && w.includes(q)) s = 0.72;
    else if (q.length >= 4) { const d = lev(q, w.slice(0, Math.max(q.length, Math.min(w.length, q.length + 2))), 2); s = d === 1 ? 0.62 : d === 2 && q.length >= 6 ? 0.45 : 0; }
    if (s > best) best = s;
    if (best === 1) break;
  }
  return best;
}


/** Ranked product ids for a query, plus whether these are only "closest" matches. */
export function rank(docs: Doc[], cats: { title: string; handle: string; t: string[] }[], q: string, limit = 48) {
  const qt = tokens(q).slice(0, 8);
  if (!qt.length) return { ids: docs.slice(0, limit).map((d) => d.id), exact: false, categories: [] as { title: string; handle: string }[] };
  const qc = compact(q);
  const scored = docs.map((d) => {
    let total = 0, matched = 0;
    for (const t of qt) {
      const variants = [t, ...(SYN[t] ?? [])];
      let s = 0;
      for (const v of variants) s = Math.max(s, wordScore(v, d.title_t) * (v === t ? 1 : 0.85), wordScore(v, d.other_t) * 0.75 * (v === t ? 1 : 0.85));
      // "hw512" against "HW-512": compare without spaces and dashes
      if (s < 0.8 && t.length >= 3 && d.compact.includes(t)) s = 0.8;
      total += s; if (s >= 0.45) matched++;
    }
    let score = total / qt.length;
    if (qc.length >= 4 && d.compact.includes(qc)) score += 0.6; // the whole phrase is in the name
    if (matched === qt.length) score += 0.2;
    return { id: d.id, score };
  }).filter((x) => x.score >= 0.3).sort((a, b) => b.score - a.score);
  const strong = scored.filter((x) => x.score >= 0.55);
  const categories = cats.map((c) => ({ c, s: qt.reduce((a, t) => a + wordScore(t, c.t), 0) / qt.length })).filter((x) => x.s >= 0.6).sort((a, b) => b.s - a.s).slice(0, 4).map((x) => ({ title: x.c.title, handle: x.c.handle }));
  if (strong.length) return { ids: scored.slice(0, limit).map((x) => x.id), exact: true, categories };
  // Nothing close enough: the nearest few, then other products so the page is never empty
  const near = scored.map((x) => x.id);
  const rest = docs.map((d) => d.id).filter((id) => !near.includes(id));
  return { ids: [...near, ...rest].slice(0, limit), exact: false, categories };
}
