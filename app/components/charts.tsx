import { useEffect, useRef, useState } from "react";
import { compactINR } from "~/lib/pricing";

export type ChartBucket = { key: string; label: string; longLabel: string; prepaid: number; cod: number; orders: number; adSpend: number | null };

const C = { prepaid: "#2a78d6", cod: "#eb6834", ads: "#1baf7a", grid: "#E8EAE6", axis: "#7A8494", surface: "#FFFFFF" };

function useWidth<T extends HTMLElement>(fallback = 320) {
  const ref = useRef<T>(null);
  const [w, setW] = useState(fallback);
  useEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(280, Math.round(e.contentRect.width))));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

/** Max for a 4-step axis where every tick is a round number (0, 2K, 4K, 6K, 8K). */
function niceMax(v: number) {
  if (v <= 0) return 1000;
  const raw = v / 4;
  const p = 10 ** Math.floor(Math.log10(raw));
  const n = raw / p;
  const step = (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p;
  return step * 4;
}

function topRounded(x: number, y: number, w: number, h: number) {
  const r = Math.min(4, h, w / 2);
  return `M${x},${y + h}L${x},${y + r}Q${x},${y} ${x + r},${y}L${x + w - r},${y}Q${x + w},${y} ${x + w},${y + r}L${x + w},${y + h}Z`;
}

const rupees = (v: number) => "₹" + Math.round(v).toLocaleString("en-IN");

/** Revenue by payment type (stacked columns) with ad spend as a line, one shared ₹ axis. */
export function RevenueChart({ buckets, showAds }: { buckets: ChartBucket[]; showAds: boolean }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const [table, setTable] = useState(false);

  const H = 260, m = { t: 12, r: 8, b: 28, l: 52 };
  const iw = width - m.l - m.r, ih = H - m.t - m.b;
  const n = Math.max(1, buckets.length);
  const max = niceMax(Math.max(0, ...buckets.map((b) => Math.max(b.prepaid + b.cod, showAds ? b.adSpend ?? 0 : 0))));
  const y = (v: number) => m.t + ih - (v / max) * ih;
  const band = iw / n;
  const barW = Math.max(2, Math.min(24, band * 0.62));
  const cx = (i: number) => m.l + band * i + band / 2;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * max);
  const every = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(iw / 64))));
  const hasAds = showAds && buckets.some((b) => b.adSpend != null);
  const linePts = hasAds ? buckets.map((b, i) => `${cx(i)},${y(b.adSpend ?? 0)}`).join(" ") : "";
  const empty = buckets.every((b) => b.prepaid + b.cod === 0 && !(b.adSpend ?? 0));

  const hb = hover != null ? buckets[hover] : null;

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <ul className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-soft">
          <Legend color={C.prepaid} label="Prepaid revenue" />
          <Legend color={C.cod} label="COD revenue" />
          {hasAds && <Legend color={C.ads} label="Ad spend" line />}
        </ul>
        <button type="button" className="btn-quiet text-xs" onClick={() => setTable((t) => !t)} aria-pressed={table}>
          {table ? "Show chart" : "Show table"}
        </button>
      </div>

      {table ? (
        <div className="max-h-[300px] overflow-auto rounded-lg border border-rule">
          <table className="table num">
            <thead><tr><th>Period</th><th>Prepaid</th><th>COD</th><th>Orders</th>{hasAds && <th>Ad spend</th>}</tr></thead>
            <tbody>
              {buckets.map((b) => (
                <tr key={b.key}><td>{b.longLabel}</td><td>{rupees(b.prepaid)}</td><td>{rupees(b.cod)}</td><td>{b.orders}</td>{hasAds && <td>{b.adSpend == null ? "—" : rupees(b.adSpend)}</td>}</tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div ref={ref} className="relative w-full overflow-hidden" onMouseLeave={() => setHover(null)}>
          <svg width={width} height={H} role="img" aria-label="Revenue and ad spend over time" className="block">
            {ticks.map((t) => (
              <g key={t}>
                <line x1={m.l} x2={width - m.r} y1={y(t)} y2={y(t)} stroke={C.grid} strokeWidth={1} />
                <text x={m.l - 8} y={y(t)} dy="0.32em" textAnchor="end" fontSize={11} fill={C.axis} className="num">{compactINR(t)}</text>
              </g>
            ))}
            {hb && <line x1={cx(hover!)} x2={cx(hover!)} y1={m.t} y2={m.t + ih} stroke={C.axis} strokeOpacity={0.35} strokeWidth={1} />}
            {buckets.map((b, i) => {
              const x = cx(i) - barW / 2;
              const hp = (b.prepaid / max) * ih;
              const hc = (b.cod / max) * ih;
              const gap = hp > 0 && hc > 0 ? 2 : 0;
              const dim = hover != null && hover !== i ? 0.45 : 1;
              return (
                <g key={b.key} opacity={dim}>
                  {hp > 0 && (hc > 0
                    ? <rect x={x} y={m.t + ih - hp} width={barW} height={hp} fill={C.prepaid} />
                    : <path d={topRounded(x, m.t + ih - hp, barW, hp)} fill={C.prepaid} />)}
                  {hc > 0 && <path d={topRounded(x, m.t + ih - hp - gap - hc, barW, hc)} fill={C.cod} />}
                </g>
              );
            })}
            {hasAds && (
              <>
                <polyline points={linePts} fill="none" stroke={C.ads} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
                {n <= 31 && buckets.map((b, i) => (
                  <circle key={b.key} cx={cx(i)} cy={y(b.adSpend ?? 0)} r={hover === i ? 5 : 3.5} fill={C.ads} stroke={C.surface} strokeWidth={2} />
                ))}
              </>
            )}
            <line x1={m.l} x2={width - m.r} y1={m.t + ih} y2={m.t + ih} stroke="#CDD2CB" strokeWidth={1} />
            {buckets.map((b, i) => (i % every === 0 ? (
              <text key={b.key} x={cx(i)} y={H - 8} textAnchor="middle" fontSize={11} fill={C.axis}>{b.label}</text>
            ) : null))}
            {buckets.map((b, i) => (
              <rect key={b.key} x={m.l + band * i} y={m.t} width={band} height={ih} fill="transparent"
                onMouseEnter={() => setHover(i)} onTouchStart={() => setHover(i)} />
            ))}
          </svg>
          {empty && (
            <p className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm text-ink-faint">No orders in this period</p>
          )}
          {hb && (
            <div className="pointer-events-none absolute top-2 z-10 w-48 rounded-lg border border-rule bg-white p-3 text-xs shadow-lift"
              style={{ left: Math.min(Math.max(cx(hover!) - 96, 0), width - 192) }}>
              <p className="mb-1.5 font-semibold text-ink">{hb.longLabel}</p>
              <TipRow color={C.prepaid} label="Prepaid" value={rupees(hb.prepaid)} />
              <TipRow color={C.cod} label="COD" value={rupees(hb.cod)} />
              <div className="my-1.5 border-t border-rule" />
              <TipRow label="Revenue" value={rupees(hb.prepaid + hb.cod)} strong />
              <TipRow label="Orders" value={String(hb.orders)} />
              {hasAds && <TipRow color={C.ads} label="Ad spend" value={hb.adSpend == null ? "—" : rupees(hb.adSpend)} />}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Legend({ color, label, line }: { color: string; label: string; line?: boolean }) {
  return (
    <li className="flex items-center gap-1.5">
      <span aria-hidden className={line ? "h-0.5 w-3.5 rounded" : "h-2.5 w-2.5 rounded-sm"} style={{ background: color }} />
      {label}
    </li>
  );
}

function TipRow({ color, label, value, strong }: { color?: string; label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 py-0.5">
      <span className="flex items-center gap-1.5 text-ink-soft">
        {color && <span aria-hidden className="h-2 w-2 rounded-sm" style={{ background: color }} />}
        {label}
      </span>
      <span className={`num ${strong ? "font-semibold text-ink" : "text-ink"}`}>{value}</span>
    </div>
  );
}

/** Prepaid vs COD share as one 100% bar. */
export function SplitBar({ prepaid, cod, prepaidValue, codValue }: { prepaid: number; cod: number; prepaidValue: number; codValue: number }) {
  const total = prepaid + cod;
  const pp = total ? (prepaid / total) * 100 : 0;
  return (
    <div>
      <div className="flex h-3 w-full gap-[2px] overflow-hidden rounded-full bg-paper-sunk" role="img" aria-label={`Prepaid ${Math.round(pp)} percent, COD ${Math.round(100 - pp)} percent`}>
        {total > 0 && prepaid > 0 && <div style={{ width: `${pp}%`, background: C.prepaid }} />}
        {total > 0 && cod > 0 && <div style={{ width: `${100 - pp}%`, background: C.cod }} />}
      </div>
      <dl className="mt-4 grid grid-cols-2 gap-4">
        <SplitStat color={C.prepaid} label="Prepaid" count={prepaid} share={total ? pp : null} value={prepaidValue} />
        <SplitStat color={C.cod} label="Cash on Delivery" count={cod} share={total ? 100 - pp : null} value={codValue} />
      </dl>
    </div>
  );
}

function SplitStat({ color, label, count, share, value }: { color: string; label: string; count: number; share: number | null; value: number }) {
  return (
    <div>
      <dt className="flex items-center gap-1.5 text-xs text-ink-soft"><span aria-hidden className="h-2.5 w-2.5 rounded-sm" style={{ background: color }} />{label}</dt>
      <dd className="mt-1 flex items-baseline gap-2">
        <span className="num text-xl font-semibold">{count.toLocaleString("en-IN")}</span>
        <span className="num text-xs text-ink-faint">{share == null ? "—" : `${Math.round(share)}%`}</span>
      </dd>
      <dd className="num text-xs text-ink-soft">{rupees(value)}</dd>
    </div>
  );
}
