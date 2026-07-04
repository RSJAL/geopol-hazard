import { useEffect, useMemo, useState } from "react";
import type { Bet, CatalogEvent, CatalogMarket, LivePriceMap, PricePoint } from "../lib/types";
import { buildLadder, fmtVolume, liveYes, deadlineLabel, type LadderRow } from "../lib/analytics";
import { betPnl, newBetId } from "../lib/bets";
import { fetchPriceHistory, type HistoryInterval } from "../lib/api";
import PriceChart, { type Series } from "./PriceChart";

const LINE_COLORS = ["#4fc3f7", "#ffa726", "#66bb6a", "#ef5350", "#ab47bc", "#26c6da"];

interface Props {
  event: CatalogEvent;
  live: LivePriceMap;
  onAddBet: (bet: Bet) => void;
  /** existing bets — markets you hold positions in show them inline */
  bets?: Bet[];
  showFullViewLink?: boolean;
}

type RateMode = "daily" | "total";

function BetForm({
  event, market, label, live, onAddBet, onClose,
}: {
  event: CatalogEvent;
  market: CatalogMarket;
  label: string;
  live: LivePriceMap;
  onAddBet: (bet: Bet) => void;
  onClose: () => void;
}) {
  const yes = liveYes(market, live);
  const [side, setSide] = useState<"YES" | "NO">("YES");
  const [shares, setShares] = useState("100");
  const [price, setPrice] = useState(yes.toFixed(1));

  // reset only when the SIDE flips — a 60s live-price tick must not clobber
  // an entry price the user is typing
  useEffect(() => {
    setPrice((side === "YES" ? yes : 100 - yes).toFixed(1));
  }, [side]); // eslint-disable-line react-hooks/exhaustive-deps

  const nShares = parseFloat(shares) || 0;
  const nPrice = parseFloat(price) || 0;
  const cost = (nShares * nPrice) / 100;

  return (
    <div className="bet-form" onClick={(e) => e.stopPropagation()}>
      <span className="bet-form-label">{label}</span>
      <select value={side} onChange={(e) => setSide(e.target.value as "YES" | "NO")}>
        <option value="YES">YES</option>
        <option value="NO">NO</option>
      </select>
      <input
        type="number" min="1" step="1" value={shares}
        onChange={(e) => setShares(e.target.value)} placeholder="shares"
      />
      <span className="muted">×</span>
      <input
        type="number" min="0.1" max="99.9" step="0.1" value={price}
        onChange={(e) => setPrice(e.target.value)} placeholder="entry ¢"
      />
      <span className="muted">¢ = ${cost.toFixed(2)}</span>
      <span className="bet-form-spacer" />
      <button
        className="btn btn-primary"
        disabled={nShares <= 0 || nPrice <= 0 || nPrice >= 100}
        onClick={() => {
          onAddBet({
            id: newBetId(),
            eventId: event.id.startsWith("group:") ? "" : event.id,
            marketId: market.id,
            label: `${event.title.slice(0, 40)} — ${label}`,
            side,
            shares: nShares,
            entryPrice: nPrice,
            openedAt: new Date().toISOString(),
          });
          onClose();
        }}
      >
        save bet
      </button>
      <button className="btn bet-form-close" title="Close" onClick={onClose}>✕</button>
    </div>
  );
}

/** PMF bar chart: per-day probability mass at each deadline, implied ↔ marginal. */
function HazardPmf({ ladder }: { ladder: LadderRow[] }) {
  const [mode, setMode] = useState<"implied" | "marginal">("implied");
  const vals = ladder.map((r) => (mode === "implied" ? r.implDaily : r.margDaily));
  // center of probability mass for the CURRENT mode gets the hot color
  const peakIdx = vals.reduce((bi, val, vi) => (val > vals[bi] ? vi : bi), 0);

  const CW = 640, CH = 170, padL = 46, padR = 8, padT = 10, padB = 26;
  const maxV = Math.max(...vals, 1e-9);
  const minV = Math.min(...vals, 0); // negative marginals (NEG) drop below zero
  const span = maxV - minV || 1e-9;
  const y = (v: number) => padT + ((maxV - v) / span) * (CH - padT - padB);
  const zero = y(0);
  const slot = (CW - padL - padR) / ladder.length;
  const bw = Math.min(56, slot - 10);

  const nTicks = 4;
  const ticks = Array.from({ length: nTicks + 1 }, (_, i) => {
    const v = minV + (span / nTicks) * i;
    return { y: y(v), label: `${v.toFixed(3)}%` };
  });

  return (
    <div className="pmf-chart">
      <div className="chart-head">
        <span className="panel-title">Hazard rate PMF <span className="muted">(probability mass per day)</span></span>
        <div className="toggle">
          <button className={mode === "implied" ? "on" : ""} onClick={() => setMode("implied")}>
            daily odds
          </button>
          <button className={mode === "marginal" ? "on" : ""} onClick={() => setMode("marginal")}>
            period odds/day
          </button>
        </div>
      </div>
      <svg viewBox={`0 0 ${CW} ${CH}`}>
        {ticks.map((t, i) => (
          <g key={i}>
            <line x1={padL} x2={CW - padR} y1={t.y} y2={t.y} className="grid-line" />
            <text x={padL - 5} y={t.y + 3} className="tick tick-y">{t.label}</text>
          </g>
        ))}
        {minV < 0 && (
          <line x1={padL} x2={CW - padR} y1={zero} y2={zero} className="zero-line" />
        )}
        {ladder.map((r, i) => {
          const v = vals[i];
          const x = padL + slot * (i + 0.5);
          const top = Math.min(y(v), zero);
          const h = Math.abs(y(v) - zero);
          const cls =
            v < 0 ? "pmf-bar-neg" : i === peakIdx && v > 0 ? "pmf-bar-peak" : "pmf-bar";
          return (
            <g key={r.endDate}>
              <title>
                {`${r.label}: ${v.toFixed(3)}%/day` +
                  (mode === "marginal"
                    ? ` over ${r.windowDays}-day window (${r.marginal >= 0 ? "+" : ""}${r.marginal.toFixed(1)}% mass)`
                    : ` (${r.yes.toFixed(1)}% compounded over ${r.days}d)`)}
              </title>
              <rect x={x - bw / 2} y={top} width={bw} height={Math.max(1.5, h)} className={cls} />
              <text x={x} y={CH - 3} className="tick tick-x">{r.label.replace(/^By /, "")}</text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

export default function EventDetail({ event, live, onAddBet, bets, showFullViewLink }: Props) {
  const [mode, setMode] = useState<RateMode>("total"); // total odds are the site default
  const [interval, setInterval_] = useState<HistoryInterval>("1m");
  const [series, setSeries] = useState<Series[] | null>(null);
  const [betMarketId, setBetMarketId] = useState<string | null>(null);

  useEffect(() => setBetMarketId(null), [event.id]);

  const ladder = useMemo(
    () => (event.type === "horizon" ? buildLadder(event, live) : []),
    [event, live],
  );

  const chartMarkets = useMemo(() => {
    const ms =
      event.type === "horizon"
        ? ladder.map((r) => r.market)
        : [...event.markets].sort((a, b) => b.volume - a.volume);
    return ms.filter((m) => m.yesTokenId).slice(0, 6);
  }, [event, ladder]);

  // key by market ids: the 60s live refresh rebuilds the ladder (new array
  // identity) and must NOT refetch histories / flash the chart
  const chartKey = chartMarkets.map((m) => m.id).join(",");
  useEffect(() => {
    let cancelled = false;
    setSeries(null);
    Promise.all(
      chartMarkets.map(async (m, i): Promise<Series> => {
        let points: PricePoint[] = [];
        try {
          points = await fetchPriceHistory(m.yesTokenId!, interval);
        } catch {
          /* individual history failures leave an empty line */
        }
        const label =
          event.type === "horizon"
            ? deadlineLabel(m.endDate)
            : m.groupItemTitle || m.question.slice(0, 30);
        return { label, color: LINE_COLORS[i % LINE_COLORS.length], points };
      }),
    ).then((s) => { if (!cancelled) setSeries(s); });
    return () => { cancelled = true; };
  }, [chartKey, interval, event.type]); // eslint-disable-line react-hooks/exhaustive-deps

  const peakMarg = Math.max(...ladder.slice(1).map((r) => r.margDaily), 0);
  const maxImpl = Math.max(...ladder.map((r) => r.implDaily), 1e-9);
  const maxYes = Math.max(...ladder.map((r) => r.yes), 1e-9);

  const positions = useMemo(() => {
    const m = new Map<string, Bet[]>();
    for (const b of bets ?? [])
      (m.get(b.marketId) ?? m.set(b.marketId, []).get(b.marketId)!).push(b);
    return m;
  }, [bets]);

  /** inline chips for positions already held on a market */
  const posChips = (m: CatalogMarket) =>
    positions.get(m.id)?.map((b) => {
      const pnl = betPnl(b, m, live);
      const up = pnl.pnl >= 0;
      return (
        <span
          key={b.id}
          className={`pos-chip ${up ? "up" : "down"}`}
          title={`${b.side} ${b.shares} @ ${b.entryPrice.toFixed(1)}¢ → now ${pnl.currentPrice.toFixed(1)}¢`}
        >
          {b.side} {b.shares}@{b.entryPrice.toFixed(0)}¢ {up ? "+" : "−"}$
          {Math.abs(pnl.pnl).toFixed(2)}
        </span>
      );
    });

  const betBtn = (m: CatalogMarket) => (
    <button
      className="bet-btn"
      title="Log a bet on this market"
      onClick={(e) => {
        e.stopPropagation();
        setBetMarketId(betMarketId === m.id ? null : m.id);
      }}
    >
      $
    </button>
  );

  return (
    <div className="detail-panel">
      <div className="detail-head">
        <div>
          <div className="detail-title">{event.title}</div>
          <div className="detail-meta">
            {event.category}
            {event.region && <> · {event.region}</>}
            {" · "}{fmtVolume(event.volume)} total vol
            {" · "}{fmtVolume(event.volume24h)} 24h
            {!event.id.startsWith("group:") && (
              <>
                {" · "}
                <a href={`https://polymarket.com/event/${event.slug}`} target="_blank" rel="noreferrer">
                  polymarket ↗
                </a>
              </>
            )}
            {showFullViewLink && (
              <>
                {" · "}
                <a href={`#/event/${event.id}`}>full view + news ↗</a>
              </>
            )}
          </div>
        </div>
        {event.type === "horizon" && (
          <div className="toggle">
            <button className={mode === "total" ? "on" : ""} onClick={() => setMode("total")}>total</button>
            <button className={mode === "daily" ? "on" : ""} onClick={() => setMode("daily")}>/day</button>
          </div>
        )}
      </div>

      {event.type === "horizon" && (
        <table className="ladder">
          <thead>
            <tr>
              <th>Deadline</th>
              <th className="num">YES</th>
              <th className="num">{mode === "daily" ? "Daily odds" : "Total odds"}</th>
              <th className="num" title="Odds added by this window vs the preceding deadline">
                {mode === "daily" ? "Period /day" : "Period odds"}
              </th>
              <th className="num">Days</th>
              <th className="viz"></th>
              <th className="flags"></th>
              <th className="bet-th"></th>
            </tr>
          </thead>
          <tbody>
            {ladder.map((r, i) => {
              const barVal = mode === "daily" ? r.implDaily / maxImpl : r.yes / maxYes;
              const implTxt = mode === "daily" ? `${r.implDaily.toFixed(3)}%` : `${r.yes.toFixed(1)}%`;
              const margTxt =
                i === 0 ? "—"
                : mode === "daily" ? `${r.margDaily.toFixed(3)}%`
                : `${r.marginal >= 0 ? "+" : ""}${r.marginal.toFixed(1)}%`;
              const margPeak = i > 0 && peakMarg > 0 && Math.abs(r.margDaily - peakMarg) < 1e-9;
              return [
                <tr key={r.endDate}>
                  <td>{r.label}</td>
                  <td className="num">{r.yes.toFixed(1)}%</td>
                  <td className={`num${r.isPeak ? " peak" : r.isInversion ? " inv" : ""}`}>{implTxt}</td>
                  <td className={`num${margPeak ? " peak" : r.isCheap ? " cheap" : ""}`}>{margTxt}</td>
                  <td className="num muted">{r.days}d</td>
                  <td className="viz">
                    <div
                      className={`bar${r.isPeak ? " bar-peak" : r.isInversion ? " bar-inv" : ""}`}
                      style={{ width: `${Math.max(2, barVal * 100)}%` }}
                    />
                  </td>
                  <td className="flags">
                    {r.isPeak && <span className="badge b-peak">PEAK</span>}
                    {r.isInversion && <span className="badge b-inv">INV</span>}
                    {r.isCheap && <span className="badge b-cheap">CHEAP</span>}
                    {r.isNegativeMarginal && <span className="badge b-neg" title="Longer deadline priced below shorter — inconsistent pricing">NEG</span>}
                  </td>
                  <td className="bet-cell">{posChips(r.market)}{betBtn(r.market)}</td>
                </tr>,
                betMarketId === r.market.id && (
                  <tr key={`${r.endDate}-bet`} className="bet-row">
                    <td colSpan={8}>
                      <BetForm
                        event={event} market={r.market} label={r.label} live={live}
                        onAddBet={onAddBet} onClose={() => setBetMarketId(null)}
                      />
                    </td>
                  </tr>
                ),
              ];
            })}
          </tbody>
        </table>
      )}

      {event.type === "categorical" && (
        <div className="buckets">
          {[...event.markets]
            .sort((a, b) => liveYes(b, live) - liveYes(a, live))
            .slice(0, 12)
            .map((m) => {
              const yes = liveYes(m, live);
              const label = m.groupItemTitle || m.question;
              return (
                <div key={m.id}>
                  <div className="bucket-row">
                    <span className="bucket-label">{label}</span>
                    <div className="bucket-bar-wrap">
                      <div className="bucket-bar" style={{ width: `${Math.max(1, yes)}%` }} />
                    </div>
                    <span className="bucket-val">{yes.toFixed(1)}%</span>
                    {posChips(m)}
                    {betBtn(m)}
                  </div>
                  {betMarketId === m.id && (
                    <BetForm
                      event={event} market={m} label={label.slice(0, 30)} live={live}
                      onAddBet={onAddBet} onClose={() => setBetMarketId(null)}
                    />
                  )}
                </div>
              );
            })}
        </div>
      )}

      {event.type === "binary" && (
        <div className="binary-summary">
          {event.markets.map((m) => {
            const yes = liveYes(m, live);
            const chg = (live.get(m.id)?.change24h ?? m.change24h ?? 0) * 100;
            const label = deadlineLabel(m.endDate);
            return (
              <div key={m.id}>
                <div className="binary-row">
                  <span className="binary-yes">{yes.toFixed(1)}%</span>
                  <span className="muted"> YES · {label}</span>
                  {chg !== 0 && (
                    <span className={chg > 0 ? "up" : "down"}>
                      {" "}{chg > 0 ? "▲" : "▼"}{Math.abs(chg).toFixed(1)} (24h)
                    </span>
                  )}
                  <span className="muted"> · spread {(m.spread ?? 0).toFixed(3)} · liq {fmtVolume(m.liquidity)}</span>
                  {posChips(m)}
                  {betBtn(m)}
                </div>
                {betMarketId === m.id && (
                  <BetForm
                    event={event} market={m} label={label} live={live}
                    onAddBet={onAddBet} onClose={() => setBetMarketId(null)}
                  />
                )}
              </div>
            );
          })}
        </div>
      )}

      <div className="chart-head">
        <span className="panel-title">Price paths</span>
        <div className="toggle">
          {(["1d", "1w", "1m", "max"] as HistoryInterval[]).map((iv) => (
            <button key={iv} className={interval === iv ? "on" : ""} onClick={() => setInterval_(iv)}>
              {iv}
            </button>
          ))}
        </div>
      </div>
      {series === null
        ? <div className="chart-empty">Loading price history…</div>
        : <PriceChart series={series} />}

      {/* full event page only — the map-side panel stays compact */}
      {!showFullViewLink && ladder.length >= 2 && <HazardPmf ladder={ladder} />}
    </div>
  );
}
