import { useMemo } from "react";
import type { PricePoint } from "../lib/types";

export interface Series {
  label: string;
  color: string;
  points: PricePoint[];
}

const W = 640;
const H = 180;
const PAD = { l: 34, r: 8, t: 8, b: 18 };

/** Multi-line price-path chart (YES probability over time), hand-rolled SVG. */
export default function PriceChart({ series }: { series: Series[] }) {
  const { paths, yTicks, xTicks } = useMemo(() => {
    const all = series.flatMap((s) => s.points);
    if (!all.length) return { paths: [], yTicks: [], xTicks: [] };

    const t0 = Math.min(...all.map((p) => p.t));
    const t1 = Math.max(...all.map((p) => p.t));
    const pMax = Math.min(1, Math.max(...all.map((p) => p.p)) * 1.15 + 0.02);

    const x = (t: number) =>
      PAD.l + ((t - t0) / Math.max(1, t1 - t0)) * (W - PAD.l - PAD.r);
    const y = (p: number) => H - PAD.b - (p / pMax) * (H - PAD.t - PAD.b);

    const paths = series
      .filter((s) => s.points.length > 1)
      .map((s) => ({
        label: s.label,
        color: s.color,
        d: s.points
          .map((pt, i) => `${i ? "L" : "M"}${x(pt.t).toFixed(1)},${y(pt.p).toFixed(1)}`)
          .join(""),
        endY: y(s.points[s.points.length - 1].p),
        endP: s.points[s.points.length - 1].p,
      }));

    const nY = 4;
    const yTicks = Array.from({ length: nY + 1 }, (_, i) => {
      const p = (pMax / nY) * i;
      return { y: y(p), label: `${Math.round(p * 100)}%` };
    });

    const nX = 4;
    const xTicks = Array.from({ length: nX + 1 }, (_, i) => {
      const t = t0 + ((t1 - t0) / nX) * i;
      return {
        x: x(t),
        label: new Date(t * 1000).toLocaleDateString("en-US", { month: "short", day: "numeric" }),
      };
    });

    return { paths, yTicks, xTicks };
  }, [series]);

  if (!paths.length) return <div className="chart-empty">No price history available.</div>;

  return (
    <div className="price-chart">
      <svg viewBox={`0 0 ${W} ${H}`}>
        {yTicks.map((t, i) => (
          <g key={i}>
            <line x1={PAD.l} x2={W - PAD.r} y1={t.y} y2={t.y} className="grid-line" />
            <text x={PAD.l - 5} y={t.y + 3} className="tick tick-y">{t.label}</text>
          </g>
        ))}
        {xTicks.map((t, i) => (
          <text key={i} x={t.x} y={H - 4} className="tick tick-x">{t.label}</text>
        ))}
        {paths.map((p) => (
          <path key={p.label} d={p.d} fill="none" stroke={p.color} strokeWidth={1.8} />
        ))}
      </svg>
      <div className="chart-legend">
        {paths.map((p) => (
          <span key={p.label} style={{ color: p.color }}>
            ━ {p.label} ({(p.endP * 100).toFixed(1)}%)
          </span>
        ))}
      </div>
    </div>
  );
}
