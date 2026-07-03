import { useMemo, useRef, useState } from "react";
import type { PricePoint } from "../lib/types";

export interface Series {
  label: string;
  color: string;
  points: PricePoint[];
}

const W = 640;
const H = 190;
const PAD = { l: 34, r: 8, t: 8, b: 18 };

interface Scales {
  x: (t: number) => number;
  y: (p: number) => number;
  t0: number;
  t1: number;
  pMax: number;
}

/** Multi-line price-path chart with hover crosshair + tooltip. */
export default function PriceChart({ series }: { series: Series[] }) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [hoverT, setHoverT] = useState<number | null>(null);

  const { paths, yTicks, xTicks, scales } = useMemo(() => {
    const all = series.flatMap((s) => s.points);
    if (!all.length)
      return { paths: [], yTicks: [], xTicks: [], scales: null as Scales | null };

    const t0 = Math.min(...all.map((p) => p.t));
    const t1 = Math.max(...all.map((p) => p.t));
    const pMax = Math.min(1, Math.max(...all.map((p) => p.p)) * 1.15 + 0.02);

    const x = (t: number) => PAD.l + ((t - t0) / Math.max(1, t1 - t0)) * (W - PAD.l - PAD.r);
    const y = (p: number) => H - PAD.b - (p / pMax) * (H - PAD.t - PAD.b);
    const scales: Scales = { x, y, t0, t1, pMax };

    const paths = series
      .filter((s) => s.points.length > 1)
      .map((s) => ({
        label: s.label,
        color: s.color,
        points: s.points,
        d: s.points
          .map((pt, i) => `${i ? "L" : "M"}${x(pt.t).toFixed(1)},${y(pt.p).toFixed(1)}`)
          .join(""),
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
    return { paths, yTicks, xTicks, scales };
  }, [series]);

  // nearest point per series at hovered time
  const hover = useMemo(() => {
    if (hoverT === null || !scales) return null;
    const rows = paths.map((p) => {
      let best = p.points[0];
      for (const pt of p.points) {
        if (Math.abs(pt.t - hoverT) < Math.abs(best.t - hoverT)) best = pt;
      }
      return { label: p.label, color: p.color, point: best };
    });
    const anchor = rows.reduce((a, b) =>
      Math.abs(b.point.t - hoverT) < Math.abs(a.point.t - hoverT) ? b : a);
    return { rows, x: scales.x(anchor.point.t), when: anchor.point.t };
  }, [hoverT, paths, scales]);

  if (!paths.length) return <div className="chart-empty">No price history available.</div>;

  const onMove = (e: React.MouseEvent<SVGSVGElement>) => {
    if (!scales || !svgRef.current) return;
    const rect = svgRef.current.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * W;
    if (px < PAD.l || px > W - PAD.r) { setHoverT(null); return; }
    const frac = (px - PAD.l) / (W - PAD.l - PAD.r);
    setHoverT(scales.t0 + frac * (scales.t1 - scales.t0));
  };

  const tipLeft = hover ? (hover.x / W) * 100 : 0;

  return (
    <div className="price-chart">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        onMouseMove={onMove}
        onMouseLeave={() => setHoverT(null)}
      >
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
        {hover && (
          <g>
            <line x1={hover.x} x2={hover.x} y1={PAD.t} y2={H - PAD.b} className="crosshair" />
            {hover.rows.map((r) => (
              <circle
                key={r.label}
                cx={scales!.x(r.point.t)}
                cy={scales!.y(r.point.p)}
                r={3}
                fill={r.color}
                stroke="#0f1117"
                strokeWidth={1}
              />
            ))}
          </g>
        )}
      </svg>

      {hover && (
        <div
          className="chart-tip"
          style={{ left: `${Math.min(78, Math.max(4, tipLeft))}%` }}
        >
          <div className="tip-when">
            {new Date(hover.when * 1000).toLocaleString("en-US", {
              month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
            })}
          </div>
          {hover.rows.map((r) => (
            <div key={r.label} className="tip-row">
              <span style={{ color: r.color }}>━</span> {r.label}
              <b> {(r.point.p * 100).toFixed(1)}%</b>
            </div>
          ))}
        </div>
      )}

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
