import { useEffect, useMemo, useRef, useState } from "react";
import type { Bet, CatalogEvent, CatalogMarket, LivePriceMap, PricePoint } from "../lib/types";
import {
  betPnl, closeBet, exportBets, importBets, isOpen, portfolioSummary, sidePrice,
} from "../lib/bets";
import { DEFAULT_FEE_BPS, polymarketFee } from "../lib/fees";
import { fetchPriceHistory, type HistoryInterval } from "../lib/api";

interface Props {
  bets: Bet[];
  marketIndex: Map<string, { market: CatalogMarket; event: CatalogEvent }>;
  live: LivePriceMap;
  onUpdateBet: (bet: Bet) => void;
  onRemoveBet: (id: string) => void;
  onImport: (bets: Bet[]) => void;
}

const money = (v: number) => `${v < 0 ? "−" : ""}$${Math.abs(v).toFixed(2)}`;
const signedMoney = (v: number) => `${v >= 0 ? "+" : "−"}$${Math.abs(v).toFixed(2)}`;

interface EquityPoint {
  t: number; // unix seconds
  value: number; // open positions marked to market + realized proceeds
  invested: number; // cumulative cost of positions opened by t (fees incl.)
}

/** last history point at or before t (binary search; null before the first) */
function priceAt(hist: PricePoint[], t: number): number | null {
  if (!hist.length || t < hist[0].t) return null;
  let lo = 0, hi = hist.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (hist[mid].t <= t) lo = mid;
    else hi = mid - 1;
  }
  return hist[lo].p;
}

/** Two-series dollar line chart (portfolio value vs invested) with hover. */
function EquityChart({ points }: { points: EquityPoint[] }) {
  const W = 760, H = 220, PAD = { l: 46, r: 10, t: 10, b: 20 };
  const svgRef = useRef<SVGSVGElement>(null);
  const [hoverT, setHoverT] = useState<number | null>(null);

  const { t0, t1, vMin, vMax } = useMemo(() => {
    const vals = points.flatMap((p) => [p.value, p.invested]);
    const lo = Math.min(...vals), hi = Math.max(...vals);
    const pad = Math.max((hi - lo) * 0.08, hi * 0.02, 0.5);
    return {
      t0: points[0].t,
      t1: points[points.length - 1].t,
      vMin: Math.max(0, lo - pad),
      vMax: hi + pad,
    };
  }, [points]);

  const x = (t: number) => PAD.l + ((t - t0) / Math.max(1, t1 - t0)) * (W - PAD.l - PAD.r);
  const y = (v: number) => H - PAD.b - ((v - vMin) / Math.max(1e-9, vMax - vMin)) * (H - PAD.t - PAD.b);
  const line = (get: (p: EquityPoint) => number) =>
    points.map((p, i) => `${i ? "L" : "M"}${x(p.t).toFixed(1)},${y(get(p)).toFixed(1)}`).join("");

  const yTicks = Array.from({ length: 5 }, (_, i) => {
    const v = vMin + ((vMax - vMin) / 4) * i;
    return { y: y(v), label: `$${v.toFixed(v >= 100 ? 0 : 2)}` };
  });
  const xTicks = Array.from({ length: 5 }, (_, i) => {
    const t = t0 + ((t1 - t0) / 4) * i;
    return {
      x: x(t),
      label: new Date(t * 1000).toLocaleDateString("en-US", { month: "short", day: "numeric" }),
    };
  });

  const hover = useMemo(() => {
    if (hoverT === null) return null;
    let best = points[0];
    for (const p of points) if (Math.abs(p.t - hoverT) < Math.abs(best.t - hoverT)) best = p;
    return best;
  }, [hoverT, points]);

  const onMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = svgRef.current!.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * W;
    if (px < PAD.l || px > W - PAD.r) { setHoverT(null); return; }
    setHoverT(t0 + ((px - PAD.l) / (W - PAD.l - PAD.r)) * (t1 - t0));
  };

  return (
    <div className="pf-chart">
      <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} onMouseMove={onMove} onMouseLeave={() => setHoverT(null)}>
        {yTicks.map((tk, i) => (
          <g key={i}>
            <line x1={PAD.l} x2={W - PAD.r} y1={tk.y} y2={tk.y} className="grid-line" />
            <text x={PAD.l - 5} y={tk.y + 3} className="tick tick-y">{tk.label}</text>
          </g>
        ))}
        {xTicks.map((tk, i) => (
          <text key={i} x={tk.x} y={H - 4} className="tick tick-x">{tk.label}</text>
        ))}
        <path d={line((p) => p.invested)} className="pf-line-invested" />
        <path d={line((p) => p.value)} className="pf-line-value" />
        {hover && (
          <g>
            <line x1={x(hover.t)} x2={x(hover.t)} y1={PAD.t} y2={H - PAD.b} className="crosshair" />
            <circle cx={x(hover.t)} cy={y(hover.value)} r={3} className="pf-dot-value" />
            <circle cx={x(hover.t)} cy={y(hover.invested)} r={3} className="pf-dot-invested" />
          </g>
        )}
      </svg>
      {hover && (
        <div className="chart-tip" style={{ left: `${Math.min(72, Math.max(4, (x(hover.t) / W) * 100))}%` }}>
          <div className="tip-when">
            {new Date(hover.t * 1000).toLocaleString("en-US", {
              month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
            })}
          </div>
          <div className="tip-row"><span className="pf-key-value">━</span> value <b>${hover.value.toFixed(2)}</b></div>
          <div className="tip-row"><span className="pf-key-invested">━</span> invested <b>${hover.invested.toFixed(2)}</b></div>
          <div className="tip-row">P&L <b className={hover.value - hover.invested >= 0 ? "up" : "down"}>
            {signedMoney(hover.value - hover.invested)}</b></div>
        </div>
      )}
      <div className="chart-legend">
        <span className="pf-key-value">━ portfolio value</span>
        <span className="pf-key-invested">━ invested (cost basis)</span>
      </div>
    </div>
  );
}

/** Inline close/settle editor for an open position. */
function CloseForm({
  bet, market, live, onUpdateBet, onCancel,
}: {
  bet: Bet;
  market: CatalogMarket | undefined;
  live: LivePriceMap;
  onUpdateBet: (b: Bet) => void;
  onCancel: () => void;
}) {
  const [price, setPrice] = useState(() => sidePrice(bet, market, live).toFixed(1));
  const nPrice = parseFloat(price) || 0;
  const bps = bet.feeBps ?? DEFAULT_FEE_BPS;
  const saleFee = polymarketFee(nPrice, bet.shares, bps);
  return (
    <div className="bet-form" onClick={(e) => e.stopPropagation()}>
      <span className="bet-form-label">close {bet.side} {bet.shares} — sold at</span>
      <input
        type="number" min="0" max="100" step="0.1" value={price}
        onChange={(e) => setPrice(e.target.value)}
      />
      <span className="muted">
        ¢ → {money((bet.shares * nPrice) / 100 - saleFee)}
        {saleFee > 0 && ` (incl ${money(saleFee)} fee)`}
      </span>
      <button
        className="btn btn-primary"
        disabled={nPrice < 0 || nPrice > 100}
        onClick={() => onUpdateBet(closeBet(bet, nPrice, false))}
      >
        close at price
      </button>
      <span className="muted">or resolved:</span>
      <button className="btn pf-won" onClick={() => onUpdateBet(closeBet(bet, 100, true))}>✓ won</button>
      <button className="btn pf-lost" onClick={() => onUpdateBet(closeBet(bet, 0, true))}>✕ lost</button>
      <span className="bet-form-spacer" />
      <button className="btn bet-form-close" onClick={onCancel}>cancel</button>
    </div>
  );
}

export default function PortfolioPage({
  bets, marketIndex, live, onUpdateBet, onRemoveBet, onImport,
}: Props) {
  const [range, setRange] = useState<HistoryInterval>("1m");
  const [closingId, setClosingId] = useState<string | null>(null);
  const [histories, setHistories] = useState<Map<string, PricePoint[]> | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const summary = useMemo(
    () => portfolioSummary(bets, marketIndex, live),
    [bets, marketIndex, live],
  );
  const open = bets.filter(isOpen).sort((a, b) => b.openedAt.localeCompare(a.openedAt));
  const closed = bets
    .filter((b) => !isOpen(b))
    .sort((a, b) => (b.closedAt ?? "").localeCompare(a.closedAt ?? ""));

  // ── YES-price histories for every bet market (equity curve input) ──────────
  const histKey = useMemo(
    () =>
      [...new Set(bets.map((b) => b.marketId))]
        .filter((id) => marketIndex.get(id)?.market.yesTokenId)
        .sort()
        .join(","),
    [bets, marketIndex],
  );
  useEffect(() => {
    let cancelled = false;
    setHistories(null);
    const ids = histKey ? histKey.split(",") : [];
    if (!ids.length) { setHistories(new Map()); return; }
    Promise.all(
      ids.map(async (id) => {
        try {
          const pts = await fetchPriceHistory(marketIndex.get(id)!.market.yesTokenId!, range);
          return [id, pts] as const;
        } catch {
          return [id, [] as PricePoint[]] as const;
        }
      }),
    ).then((entries) => { if (!cancelled) setHistories(new Map(entries)); });
    return () => { cancelled = true; };
  }, [histKey, range]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── equity curve: value vs cumulative invested over time ───────────────────
  const curve = useMemo((): EquityPoint[] | null => {
    if (!histories || !bets.length) return histories ? [] : null;
    const openTs = bets.map((b) => new Date(b.openedAt).getTime() / 1000);
    const tFirst = Math.min(...openTs);
    const now = Date.now() / 1000;
    const ts = new Set<number>([tFirst, now]);
    for (const h of histories.values()) for (const p of h) if (p.t >= tFirst) ts.add(p.t);
    for (const t of openTs) ts.add(t);
    for (const b of bets) if (b.closedAt) ts.add(new Date(b.closedAt).getTime() / 1000);
    let grid = [...ts].filter((t) => t <= now).sort((a, b) => a - b);
    if (grid.length > 400) {
      const step = Math.ceil(grid.length / 400);
      grid = grid.filter((_, i) => i % step === 0 || i === grid.length - 1);
    }

    return grid.map((t, gi) => {
      let value = 0;
      let invested = 0;
      for (const b of bets) {
        if (new Date(b.openedAt).getTime() / 1000 > t) continue;
        const pnl = betPnl(b, marketIndex.get(b.marketId)?.market, live);
        invested += pnl.cost;
        const closedT = b.closedAt ? new Date(b.closedAt).getTime() / 1000 : null;
        if (closedT !== null && closedT <= t) {
          value += pnl.value; // realized proceeds (net of sale fee)
          continue;
        }
        // open at t (or closed later): mark to market via YES history
        const hist = histories.get(b.marketId);
        const yes = hist ? priceAt(hist, t) : null;
        if (yes !== null) {
          const px = b.side === "YES" ? yes * 100 : 100 - yes * 100;
          value += (b.shares * px) / 100;
        } else if (gi === grid.length - 1 && isOpen(b)) {
          value += pnl.value; // last point: live price
        } else {
          value += (b.shares * b.entryPrice) / 100; // no history — flat at entry
        }
      }
      return { t, value, invested };
    });
  }, [histories, bets, marketIndex, live]);

  const missingHist =
    histories !== null &&
    bets.some((b) => !histories.get(b.marketId)?.length);

  const rowsFor = (list: Bet[], closedTable: boolean) =>
    list.map((b) => {
      const hit = marketIndex.get(b.marketId);
      const pnl = betPnl(b, hit?.market, live);
      const up = pnl.pnl >= 0;
      return [
        <tr
          key={b.id}
          className="pf-row"
          onClick={() => { if (b.eventId) window.location.hash = `#/event/${b.eventId}`; }}
        >
          <td className="pf-label">{b.label}</td>
          <td>
            <span className={`side-badge ${b.side === "YES" ? "side-yes" : "side-no"}`}>{b.side}</span>
          </td>
          <td className="num">{b.shares}</td>
          <td className="num">
            {b.entryPrice.toFixed(1)}¢{closedTable && ` → ${(b.exitPrice ?? 0).toFixed(1)}¢`}
          </td>
          {!closedTable && <td className="num">{hit ? `${pnl.currentPrice.toFixed(1)}¢` : "—"}</td>}
          <td className="num">{money(pnl.value)}</td>
          <td className={`num ${up ? "up" : "down"}`}>
            {signedMoney(pnl.pnl)} ({pnl.pnlPct >= 0 ? "+" : ""}{pnl.pnlPct.toFixed(1)}%)
          </td>
          <td className="num muted">
            {closedTable
              ? `${b.openedAt.slice(0, 10)} → ${(b.closedAt ?? "").slice(0, 10)}${b.settled ? " · resolved" : ""}`
              : b.openedAt.slice(0, 10)}
          </td>
          <td className="pf-actions">
            {!closedTable && (
              <button
                className="btn pf-close-btn"
                onClick={(e) => { e.stopPropagation(); setClosingId(closingId === b.id ? null : b.id); }}
              >
                close
              </button>
            )}
            <button
              className="star"
              title="Delete record"
              onClick={(e) => { e.stopPropagation(); onRemoveBet(b.id); }}
            >
              🗑
            </button>
          </td>
        </tr>,
        !closedTable && closingId === b.id && (
          <tr key={`${b.id}-close`} className="bet-row">
            <td colSpan={8}>
              <CloseForm
                bet={b} market={hit?.market} live={live}
                onUpdateBet={(nb) => { onUpdateBet(nb); setClosingId(null); }}
                onCancel={() => setClosingId(null)}
              />
            </td>
          </tr>
        ),
      ];
    });

  return (
    <div className="portfolio-page">
      <div className="pf-head">
        <span className="panel-title">💼 Portfolio</span>
        <div className="watch-actions pf-io">
          <button className="btn" onClick={() => exportBets(bets)} disabled={!bets.length}>↓ export</button>
          <button className="btn" onClick={() => fileRef.current?.click()}>↑ import</button>
          <input
            ref={fileRef} type="file" accept="application/json" style={{ display: "none" }}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) importBets(f).then(onImport).catch(() => {});
              e.target.value = "";
            }}
          />
        </div>
      </div>

      <div className="tiles pf-tiles">
        <div className="tile">
          <div className="tile-label">Open / closed</div>
          <div className="tile-value">{summary.nOpen} / {summary.nClosed}</div>
        </div>
        <div className="tile">
          <div className="tile-label">Open value</div>
          <div className="tile-value">{money(summary.openValue)}</div>
        </div>
        <div className="tile">
          <div className="tile-label">Unrealized P&L</div>
          <div className={`tile-value ${summary.unrealizedPnl >= 0 ? "up" : "down"}`}>
            {signedMoney(summary.unrealizedPnl)}
          </div>
        </div>
        <div className="tile">
          <div className="tile-label">Realized P&L</div>
          <div className={`tile-value ${summary.realizedPnl >= 0 ? "up" : "down"}`}>
            {signedMoney(summary.realizedPnl)}
          </div>
        </div>
        <div className="tile" title={`vs ${money(summary.invested)} lifetime invested`}>
          <div className="tile-label">Total return</div>
          <div className={`tile-value ${summary.totalPnl >= 0 ? "up" : "down"}`}>
            {signedMoney(summary.totalPnl)}
            <span className="pf-pct"> ({summary.totalPnlPct >= 0 ? "+" : ""}{summary.totalPnlPct.toFixed(1)}%)</span>
          </div>
        </div>
        <div className="tile" title="Wins / losses among closed positions">
          <div className="tile-label">Record</div>
          <div className="tile-value">{summary.wins}–{summary.losses}</div>
        </div>
        {summary.feesPaid > 0 && (
          <div className="tile">
            <div className="tile-label">Fees paid</div>
            <div className="tile-value">{money(summary.feesPaid)}</div>
          </div>
        )}
      </div>

      <div className="detail-panel pf-panel">
        <div className="chart-head">
          <span className="panel-title">Portfolio value over time</span>
          <div className="toggle">
            {(["1w", "1m", "max"] as HistoryInterval[]).map((iv) => (
              <button key={iv} className={range === iv ? "on" : ""} onClick={() => setRange(iv)}>
                {iv}
              </button>
            ))}
          </div>
        </div>
        {!bets.length ? (
          <div className="empty">No bets yet — log one from any market's $ button.</div>
        ) : curve === null ? (
          <div className="chart-empty">Loading price history…</div>
        ) : curve.length < 2 ? (
          <div className="chart-empty">Not enough history in this range yet.</div>
        ) : (
          <EquityChart points={curve} />
        )}
        {missingHist && (
          <div className="pf-note">
            Some positions have no fetchable price history (market closed or left the
            catalog) — they're held flat at entry price until their close date.
          </div>
        )}
      </div>

      <div className="detail-panel pf-panel">
        <div className="panel-head">
          <span className="panel-title">Open positions</span>
          <span className="panel-sub">{open.length} · cost {money(summary.openCost)}</span>
        </div>
        {open.length ? (
          <table className="ladder pf-table">
            <thead>
              <tr>
                <th>Market</th><th>Side</th><th className="num">Shares</th>
                <th className="num">Entry</th><th className="num">Now</th>
                <th className="num">Value</th><th className="num">P&L</th>
                <th className="num">Opened</th><th></th>
              </tr>
            </thead>
            <tbody>{rowsFor(open, false)}</tbody>
          </table>
        ) : (
          <div className="empty">No open positions.</div>
        )}
      </div>

      <div className="detail-panel pf-panel">
        <div className="panel-head">
          <span className="panel-title">History</span>
          <span className="panel-sub">
            {closed.length} closed · realized {signedMoney(summary.realizedPnl)}
          </span>
        </div>
        {closed.length ? (
          <table className="ladder pf-table">
            <thead>
              <tr>
                <th>Market</th><th>Side</th><th className="num">Shares</th>
                <th className="num">Entry → Exit</th>
                <th className="num">Proceeds</th><th className="num">P&L</th>
                <th className="num">Held</th><th></th>
              </tr>
            </thead>
            <tbody>{rowsFor(closed, true)}</tbody>
          </table>
        ) : (
          <div className="empty">Nothing closed yet — close a position above when you sell or it resolves.</div>
        )}
      </div>
    </div>
  );
}
