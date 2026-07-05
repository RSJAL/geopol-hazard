import { useEffect, useMemo, useState } from "react";
import type { Bet, CatalogEvent, CatalogMarket, LivePriceMap, PricePoint } from "../lib/types";
import { buildLadder, fmtVolume, liveYes, deadlineLabel } from "../lib/analytics";
import { betPnl, isOpen, newBetId } from "../lib/bets";
import { DEFAULT_FEE_BPS, polymarketFee } from "../lib/fees";
import { fetchPriceHistory, type HistoryInterval } from "../lib/api";
import PriceChart, { type Series } from "./PriceChart";

// lead series takes the default green (V0.152); the rest stay distinguishable
const LINE_COLORS = ["#00c896", "#ffa726", "#4fc3f7", "#ef5350", "#ab47bc", "#26c6da"];

const INTERVAL_LABEL: Record<HistoryInterval, string> = {
  "1d": "1D", "1w": "1W", "1m": "1M", max: "Max",
};

interface Props {
  event: CatalogEvent;
  live: LivePriceMap;
  onAddBet: (bet: Bet) => void;
  /** existing bets — markets you hold positions in show them inline */
  bets?: Bet[];
  showFullViewLink?: boolean;
}

type RateMode = "daily" | "total";

interface BetOption {
  market: CatalogMarket;
  label: string;
}

/** One bet form per event (V0.151): the market — candidate or deadline — is
 *  picked in a dropdown instead of per-row $ buttons. */
function BetForm({
  event, options, initialId, live, onAddBet, onClose,
}: {
  event: CatalogEvent;
  options: BetOption[];
  initialId: string;
  live: LivePriceMap;
  onAddBet: (bet: Bet) => void;
  onClose: () => void;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const [marketId, setMarketId] = useState(initialId);
  const opt = options.find((o) => o.market.id === marketId) ?? options[0];
  const market = opt.market;
  const yes = liveYes(market, live);
  const [side, setSide] = useState<"YES" | "NO">("YES");
  const [shares, setShares] = useState("100");
  const [price, setPrice] = useState(yes.toFixed(1));
  const [opened, setOpened] = useState(today); // backdatable (V0.152)

  // reset only when the SIDE or MARKET changes — a 60s live-price tick must
  // not clobber an entry price the user is typing
  useEffect(() => {
    setPrice((side === "YES" ? yes : 100 - yes).toFixed(1));
  }, [side, marketId]); // eslint-disable-line react-hooks/exhaustive-deps

  const nShares = parseFloat(shares) || 0;
  const nPrice = parseFloat(price) || 0;
  const fee = polymarketFee(nPrice, nShares);
  const cost = (nShares * nPrice) / 100 + fee;

  return (
    <div className="bet-form" onClick={(e) => e.stopPropagation()}>
      <span className="bet-form-label">bet on</span>
      {options.length > 1 ? (
        <select
          className="bet-market"
          value={opt.market.id}
          onChange={(e) => setMarketId(e.target.value)}
        >
          {options.map((o) => (
            <option key={o.market.id} value={o.market.id}>{o.label}</option>
          ))}
        </select>
      ) : (
        <span className="bet-form-label"><b>{opt.label}</b></span>
      )}
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
      <span
        className="muted"
        title="Polymarket taker fee = rate × min(p, 1−p) × shares. Geopolitics markets currently trade fee-free (0 bps); recorded per bet so P&L adjusts if fees turn on."
      >
        ¢ = ${cost.toFixed(2)} · fee ${fee.toFixed(2)}
      </span>
      <span className="muted">on</span>
      <input
        type="date" value={opened} max={today}
        title="Date the bet was placed — backdate to match your real entry; the portfolio chart starts each position at this date"
        onChange={(e) => setOpened(e.target.value)}
      />
      <span className="bet-form-spacer" />
      <button
        className="btn btn-primary"
        disabled={nShares <= 0 || nPrice <= 0 || nPrice >= 100}
        onClick={() => {
          onAddBet({
            id: newBetId(),
            eventId: event.id.startsWith("group:") ? "" : event.id,
            marketId: market.id,
            label: `${event.title.slice(0, 40)} — ${opt.label}`,
            side,
            shares: nShares,
            entryPrice: nPrice,
            // backdated bets land at noon UTC of the chosen day; today = now
            openedAt:
              opened && opened !== today
                ? `${opened}T12:00:00.000Z`
                : new Date().toISOString(),
            ...(DEFAULT_FEE_BPS > 0 ? { feeBps: DEFAULT_FEE_BPS } : {}),
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

export default function EventDetail({ event, live, onAddBet, bets, showFullViewLink }: Props) {
  const [mode, setMode] = useState<RateMode>("total"); // total odds are the site default
  const [interval, setInterval_] = useState<HistoryInterval>("1m");
  const [series, setSeries] = useState<Series[] | null>(null);
  /** market id to preselect in the single bet form; null = form closed */
  const [betInit, setBetInit] = useState<string | null>(null);

  useEffect(() => setBetInit(null), [event.id]);

  const ladder = useMemo(
    () => (event.type === "horizon" ? buildLadder(event, live) : []),
    [event, live],
  );

  const chartMarkets = useMemo(() => {
    // categorical: lead candidates by snapshot price (stable across live
    // ticks) — volume order surfaced dead-but-once-traded outcomes instead
    const ms =
      event.type === "horizon"
        ? ladder.map((r) => r.market)
        : [...event.markets].sort((a, b) => b.yes - a.yes);
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
      if (isOpen(b)) (m.get(b.marketId) ?? m.set(b.marketId, []).get(b.marketId)!).push(b);
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

  /** one dropdown-equipped form per event: deadlines / candidates / the market */
  const betOptions = useMemo((): BetOption[] => {
    if (event.type === "horizon")
      return ladder.map((r) => ({ market: r.market, label: r.label }));
    if (event.type === "categorical")
      return [...event.markets]
        .sort((a, b) => b.yes - a.yes)
        .slice(0, 12)
        .map((m) => ({ market: m, label: (m.groupItemTitle || m.question).slice(0, 40) }));
    return event.markets.map((m) => ({ market: m, label: deadlineLabel(m.endDate) }));
  }, [event, ladder]);

  const toggleBetForm = (marketId?: string) =>
    setBetInit((prev) =>
      prev !== null && (marketId === undefined || prev === marketId)
        ? null
        : marketId ?? betOptions[0]?.market.id ?? null);

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
        <div className="detail-actions">
          {event.type === "horizon" && (
            <div className="toggle">
              <button className={mode === "total" ? "on" : ""} onClick={() => setMode("total")}>Total</button>
              <button className={mode === "daily" ? "on" : ""} onClick={() => setMode("daily")}>Day</button>
            </div>
          )}
          <button className="bet-btn" onClick={() => toggleBetForm()}>$ Record bet</button>
        </div>
      </div>

      {betInit !== null && betOptions.length > 0 && (
        <BetForm
          event={event}
          options={betOptions}
          initialId={betInit}
          live={live}
          onAddBet={onAddBet}
          onClose={() => setBetInit(null)}
        />
      )}

      {event.type === "horizon" && (
        <>
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
                return (
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
                    <td className="bet-cell">{posChips(r.market)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </>
      )}

      {event.type === "categorical" && (
        <>
          <div className="buckets">
            {[...event.markets]
              .sort((a, b) => liveYes(b, live) - liveYes(a, live))
              .slice(0, 12)
              .map((m) => {
                const yes = liveYes(m, live);
                const label = m.groupItemTitle || m.question;
                return (
                  <div key={m.id} className="bucket-row">
                    <span className="bucket-label">{label}</span>
                    <div className="bucket-bar-wrap">
                      <div className="bucket-bar" style={{ width: `${Math.max(1, yes)}%` }} />
                    </div>
                    <span className="bucket-val">{yes.toFixed(1)}%</span>
                    {posChips(m)}
                  </div>
                );
              })}
          </div>
        </>
      )}

      {event.type === "binary" && (
        <div className="binary-summary">
          {event.markets.map((m) => {
            const yes = liveYes(m, live);
            const chg = (live.get(m.id)?.change24h ?? m.change24h ?? 0) * 100;
            const label = deadlineLabel(m.endDate);
            return (
              <div key={m.id} className="binary-row">
                <div className="binary-main">
                  <span className="binary-yes">{yes.toFixed(1)}%</span>
                  <span className="binary-side">YES · {label}</span>
                </div>
                <div className="binary-stats">
                  {chg !== 0 && (
                    <div className="bstat">
                      <span className="bstat-label">24h</span>
                      <b className={chg > 0 ? "up" : "down"}>
                        {chg > 0 ? "▲" : "▼"} {Math.abs(chg).toFixed(1)}
                      </b>
                    </div>
                  )}
                  <div className="bstat">
                    <span className="bstat-label">Spread</span>
                    <b>{(m.spread ?? 0).toFixed(3)}</b>
                  </div>
                  <div className="bstat">
                    <span className="bstat-label">Vol</span>
                    <b>{fmtVolume(m.volume)}</b>
                  </div>
                </div>
                <div className="binary-actions">{posChips(m)}</div>
              </div>
            );
          })}
        </div>
      )}

      <div className="chart-head">
        <span className="panel-title">Price history</span>
        <div className="toggle iv-toggle">
          {(["1d", "1w", "1m", "max"] as HistoryInterval[]).map((iv) => (
            <button key={iv} className={interval === iv ? "on" : ""} onClick={() => setInterval_(iv)}>
              {INTERVAL_LABEL[iv]}
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
