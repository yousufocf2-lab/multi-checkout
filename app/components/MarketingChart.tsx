// Super admin → Marketing: daily ad spend (Meta + Google, stacked) with leads as lines on a second axis.
import { useEffect, useRef, useState } from "react";
import { compactINR } from "~/lib/pricing";

export type MarketingPoint = { key: string; label: string; longLabel: string; meta: number; google: number; siteLeads: number; adLeads: number };

const C = { meta: "#0866FF", google: "#F2A900", site: "#0B5D4B", ad: "#8B5CF6", grid: "#E8EAE6", axis: "#7A8494", surface: "#FFFFFF" };

function niceMax(v: number, min = 4) {
  if (v <= 0) return min;
  const raw = v / 4;
  const p = 10 ** Math.floor(Math.log10(raw));
  const n = raw / p;
  return Math.max(min, (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p * 4);
}
const inr = (v: number) => "₹" + Math.round(v).toLocaleString("en-IN");
const leadsFmt = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(1));

export function MarketingChart({ points, showMeta, showGoogle }: { points: MarketingPoint[]; showMeta: boolean; showGoogle: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(640);
  const [hover, setHover] = useState<number | null>(null);
  const [table, setTable] = useState(false);
  useEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.max(280, Math.round(e.contentRect.width))));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, [table]);

  const H = 270, m = { t: 14, r: 40, b: 28, l: 52 };
  const iw = width - m.l - m.r, ih = H - m.t - m.b;
  const n = Math.max(1, points.length);
  const spendMax = niceMax(Math.max(0, ...points.map((p) => (showMeta ? p.meta : 0) + (showGoogle ? p.google : 0))), 400);
  const leadMax = niceMax(Math.max(0, ...points.map((p) => Math.max(p.siteLeads, p.adLeads))), 4);
  const band = iw / n, bw = Math.max(3, Math.min(28, band * 0.6));
  const cx = (i: number) => m.l + band * i + band / 2;
  const ys = (v: number) => m.t + ih - (v / spendMax) * ih;
  const yl = (v: number) => m.t + ih - (v / leadMax) * ih;
  const ticks = [0, 0.25, 0.5, 0.75, 1];
  const every = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(iw / 60))));
  const line = (get: (p: MarketingPoint) => number) => points.map((p, i) => `${cx(i)},${yl(get(p))}`).join(" ");

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <ul className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-soft">
          {showMeta && <Key color={C.meta} label="Meta spend" />}
          {showGoogle && <Key color={C.google} label="Google spend" />}
          <Key color={C.site} label="Website leads" line />
          {(showMeta || showGoogle) && <Key color={C.ad} label="Leads reported by ads" line dashed />}
        </ul>
        <button type="button" className="btn-quiet text-xs" onClick={() => setTable((t) => !t)} aria-pressed={table}>{table ? "Show chart" : "Show table"}</button>
      </div>
      {table ? (
        <div className="max-h-[320px] overflow-auto rounded-lg border border-rule">
          <table className="table num">
            <thead><tr><th>Period</th>{showMeta && <th>Meta</th>}{showGoogle && <th>Google</th>}<th>Website leads</th>{(showMeta || showGoogle) && <th>Ad leads</th>}</tr></thead>
            <tbody>{points.map((p) => (
              <tr key={p.key}><td>{p.longLabel}</td>{showMeta && <td>{inr(p.meta)}</td>}{showGoogle && <td>{inr(p.google)}</td>}<td>{p.siteLeads}</td>{(showMeta || showGoogle) && <td>{leadsFmt(p.adLeads)}</td>}</tr>
            ))}</tbody>
          </table>
        </div>
      ) : (
        <div ref={ref} className="relative w-full overflow-hidden" onMouseLeave={() => setHover(null)}>
          <svg width={width} height={H} role="img" aria-label="Ad spend and leads over time" className="block">
            {ticks.map((f) => (
              <g key={f}>
                <line x1={m.l} x2={width - m.r} y1={ys(f * spendMax)} y2={ys(f * spendMax)} stroke={C.grid} />
                <text x={m.l - 8} y={ys(f * spendMax)} dy="0.32em" textAnchor="end" fontSize={11} fill={C.axis}>{compactINR(f * spendMax)}</text>
                <text x={width - m.r + 8} y={yl(f * leadMax)} dy="0.32em" fontSize={11} fill={C.site}>{leadsFmt(f * leadMax)}</text>
              </g>
            ))}
            {hover != null && <rect x={cx(hover) - band / 2} y={m.t} width={band} height={ih} fill="#0B5D4B" fillOpacity={0.05} />}
            {points.map((p, i) => {
              const mv = showMeta ? p.meta : 0, gv = showGoogle ? p.google : 0;
              const hm = (mv / spendMax) * ih, hg = (gv / spendMax) * ih;
              return (
                <g key={p.key}>
                  {mv > 0 && <rect x={cx(i) - bw / 2} y={m.t + ih - hm} width={bw} height={hm} fill={C.meta} rx={gv > 0 ? 0 : 3} />}
                  {gv > 0 && <rect x={cx(i) - bw / 2} y={m.t + ih - hm - hg} width={bw} height={hg} fill={C.google} rx={3} />}
                </g>
              );
            })}
            {(showMeta || showGoogle) && <polyline points={line((p) => p.adLeads)} fill="none" stroke={C.ad} strokeWidth={2} strokeDasharray="5 4" strokeLinejoin="round" />}
            <polyline points={line((p) => p.siteLeads)} fill="none" stroke={C.site} strokeWidth={2.25} strokeLinejoin="round" strokeLinecap="round" />
            {n <= 45 && points.map((p, i) => <circle key={p.key} cx={cx(i)} cy={yl(p.siteLeads)} r={hover === i ? 4.5 : 2.5} fill={C.site} stroke={C.surface} strokeWidth={1.5} />)}
            <line x1={m.l} x2={width - m.r} y1={m.t + ih} y2={m.t + ih} stroke="#CDD2CB" />
            {points.map((p, i) => (i % every === 0 ? <text key={p.key} x={cx(i)} y={H - 8} textAnchor="middle" fontSize={11} fill={C.axis}>{p.label}</text> : null))}
            {points.map((p, i) => <rect key={p.key} x={cx(i) - band / 2} y={m.t} width={band} height={ih} fill="transparent" onMouseEnter={() => setHover(i)} onTouchStart={() => setHover(i)} />)}
          </svg>
          {hover != null && points[hover] && (
            <div className="pointer-events-none absolute top-2 z-10 w-56 rounded-lg border border-rule bg-white p-3 text-xs shadow-lift" style={{ left: Math.min(Math.max(cx(hover) - 112, 0), width - 224) }}>
              <p className="mb-1.5 font-semibold text-ink">{points[hover].longLabel}</p>
              {showMeta && <Tip color={C.meta} label="Meta spend" value={inr(points[hover].meta)} />}
              {showGoogle && <Tip color={C.google} label="Google spend" value={inr(points[hover].google)} />}
              <Tip color={C.site} label="Website leads" value={String(points[hover].siteLeads)} />
              {(showMeta || showGoogle) && <Tip color={C.ad} label="Leads reported by ads" value={leadsFmt(points[hover].adLeads)} />}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Key({ color, label, line, dashed }: { color: string; label: string; line?: boolean; dashed?: boolean }) {
  return (
    <li className="flex items-center gap-1.5">
      {line
        ? <svg width="16" height="8" aria-hidden><line x1="0" x2="16" y1="4" y2="4" stroke={color} strokeWidth="2.5" strokeDasharray={dashed ? "4 3" : undefined} /></svg>
        : <span className="h-2.5 w-2.5 rounded-sm" style={{ background: color }} />}
      {label}
    </li>
  );
}

function Tip({ color, label, value }: { color: string; label: string; value: string }) {
  return (
    <p className="flex items-center justify-between gap-3 py-0.5">
      <span className="flex items-center gap-1.5 text-ink-soft"><span className="h-2 w-2 rounded-full" style={{ background: color }} />{label}</span>
      <span className="num font-semibold text-ink">{value}</span>
    </p>
  );
}
