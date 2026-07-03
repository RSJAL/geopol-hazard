import { useEffect, useMemo, useState } from "react";
import type { Bet, CatalogEvent, CatalogMarket, LivePriceMap, PricePoint } from "../lib/types";
import { buildLadder, fmtVolume, liveYes, deadlineLabel } from "../lib/analytics";
import { newBetId } from "../lib/bets";
import { fetchPriceHistory, type HistoryInterval } from "../lib/api";
import PriceChart, { type Series } from "./PriceChart";

const LINE_COLORS = ["#4fc3f7", "#ffa726", "#66bb6a", "#ef5350", "#ab47bc", "#26c6da"];

interface Props {
  event: CatalogEvent;
  live: LivePriceMap;
  onAddBet: (bet: Bet) => void;
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

  useEffect(() => {
    setPrice((side === "YES" ? yes : 100 - yes).toFixed(1));
  }, [side, yes]);

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
      <button className="btn" onClick={onClose}>✕</button>
    </div>
  );
}

export default function EventDetail({ event, live, onAddBet, showFullViewLink }: Props) {
  const [mode, setMode] = useState<RateMode>("daily");
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
  }, [chartMarkets, interval, event.type]);

  const peakMarg = Math.max(...ladder.slice(1).map((r) => r.margDaily), 0);
  const maxImpl = Math.max(...ladder.map((r) => r.implDaily), 1e-9);
  const maxYes = Math.max(...ladder.map((r) => r.yes), 1e-9);

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
            <button className={mode === "daily" ? "on" : ""} onClick={() => setMode("daily")}>/day</button>
            <button className={mode === "total" ? "on" : ""} onClick={() => setMode("total")}>total</button>
          </div>
        )}
      </div>

      {event.type === "horizon" && (
        <table className="ladder">
          <thead>
            <tr>
              <th>Deadline</th>
              <th className="num">YES</th>
              <th className="num">{mode === "daily" ? "Impl/day" : "Cumulative"}</th>
              <th className="num">{mode === "daily" ? "Marg/day" : "Marginal"}</th>
              <th className="num">Days</th>
              <th className="viz"></th>
              <th className="flags"></th>
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
                    {betBtn(r.market)}
                  </td>
                </tr>,
                betMarketId === r.market.id && (
                  <tr key={`${r.endDate}-bet`} className="bet-row">
                    <td colSpan={7}>
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
          {(["1w", "1m", "max"] as HistoryInterval[]).map((iv) => (
            <button key={iv} className={interval === iv ? "on" : ""} onClick={() => setInterval_(iv)}>
              {iv}
            </button>
          ))}
        </div>
      </div>
      {series === null
        ? <div className="chart-empty">Loading price history…</div>
        : <PriceChart series={series} />}
    </div>
  );
}
