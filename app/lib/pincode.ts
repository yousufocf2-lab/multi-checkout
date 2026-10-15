// Instant state guess from the first 3 digits of an Indian pincode (no network).
// The server lookup (/api/pincode/:pin) then confirms city + state.

const RANGES: [number, number, string][] = [
  [110, 110, "DL"], [121, 136, "HR"], [140, 159, "PB"], [160, 160, "CH"], [161, 169, "PB"],
  [171, 177, "HP"], [180, 193, "JK"], [194, 194, "LA"],
  [201, 285, "UP"], [301, 345, "RJ"], [360, 396, "GJ"],
  [400, 402, "MH"], [403, 403, "GA"], [404, 445, "MH"],
  [450, 488, "MP"], [490, 497, "CG"], [500, 509, "TS"], [515, 535, "AP"],
  [560, 591, "KA"], [600, 643, "TN"], [670, 695, "KL"],
  [700, 736, "WB"], [737, 737, "SK"], [738, 743, "WB"], [744, 744, "AN"],
  [751, 770, "OR"], [781, 788, "AS"], [790, 792, "AR"], [793, 794, "ML"], [795, 795, "MN"],
  [796, 796, "MZ"], [797, 798, "NL"], [799, 799, "TR"], [800, 855, "BR"],
];
const OVERRIDES: Record<number, string> = {
  246: "UK", 248: "UK", 249: "UK", 262: "UK", 263: "UK",
  814: "JH", 815: "JH", 816: "JH", 822: "JH", 825: "JH", 826: "JH", 827: "JH", 828: "JH",
  829: "JH", 831: "JH", 832: "JH", 833: "JH", 834: "JH", 835: "JH",
};

export function guessStateFromPincode(pin: string): string | null {
  if (!/^[1-9]\d{5}$/.test(pin)) return null;
  const p3 = Number(pin.slice(0, 3));
  if (OVERRIDES[p3]) return OVERRIDES[p3];
  const r = RANGES.find(([a, b]) => p3 >= a && p3 <= b);
  return r ? r[2] : null;
}
