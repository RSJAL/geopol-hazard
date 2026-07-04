import { useRef } from "react";
import type { Bet, CatalogEvent, CatalogMarket, LivePriceMap } from "../lib/types";
import { betPnl, exportBets, importBets, isOpen } from "../lib/bets";

interface Props {
  bets: Bet[];
  marketIndex: Map<string, { market: CatalogMarket; event: CatalogEvent }>;
  live: LivePriceMap;
  onRemove: (id: string) => void;
  onImport: (bets: Bet[]) => void;
  onSelectEvent: (id: string) => void;
}

export default function BetsPanel({
  bets, marketIndex, live, onRemove, onImport, onSelectEvent,
}: Props) {
  const fileRef = useRef<HTMLInputElement>(null);

  // the rail tracks OPEN positions; closed history lives on the portfolio page
  const openBets = bets.filter(isOpen);
  let totCost = 0;
  let totValue = 0;
  const rows = openBets.map((b) => {
    const hit = marketIndex.get(b.marketId);
    const pnl = betPnl(b, hit?.market, live);
    totCost += pnl.cost;
    totValue += pnl.value;
    return { bet: b, hit, pnl };
  });
  const totPnl = totValue - totCost;
  const realized = bets
    .filter((b) => !isOpen(b))
    .reduce((s, b) => s + betPnl(b, marketIndex.get(b.marketId)?.market, live).pnl, 0);
  const nClosed = bets.length - openBets.length;

  return (
    <div className="bets-panel">
      {openBets.length > 0 && (
        <div className="pnl-summary">
          <div>
            <div className="tile-label">Cost</div>
            <div className="pnl-num">${totCost.toFixed(2)}</div>
          </div>
          <div>
            <div className="tile-label">Value</div>
            <div className="pnl-num">${totValue.toFixed(2)}</div>
          </div>
          <div>
            <div className="tile-label">P&amp;L</div>
            <div className={`pnl-num ${totPnl >= 0 ? "up" : "down"}`}>
              {totPnl >= 0 ? "+" : "−"}${Math.abs(totPnl).toFixed(2)}
            </div>
          </div>
        </div>
      )}

      <a className="pf-link" href="#/portfolio">
        💼 portfolio: value graph, close positions, history
        {nClosed > 0 && (
          <> · realized <b className={realized >= 0 ? "up" : "down"}>
            {realized >= 0 ? "+" : "−"}${Math.abs(realized).toFixed(2)}
          </b></>
        )}
        {" →"}
      </a>

      <div className="watch-actions">
        <button className="btn" onClick={() => exportBets(bets)} disabled={!bets.length}>
          ↓ export
        </button>
        <button className="btn" onClick={() => fileRef.current?.click()}>↑ import</button>
        <input
          ref={fileRef}
          type="file"
          accept="application/json"
          style={{ display: "none" }}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) importBets(f).then(onImport).catch(() => {});
            e.target.value = "";
          }}
        />
      </div>

      <div className="watch-list">
        {rows.map(({ bet, hit, pnl }) => {
          const up = pnl.pnl >= 0;
          return (
            <div
              key={bet.id}
              className={`bet-card ${up ? "bet-card-up" : "bet-card-down"}`}
              onClick={() => bet.eventId && onSelectEvent(bet.eventId)}
            >
              <div className="bet-card-head">
                <span className="bet-card-title">{bet.label}</span>
                <button
                  className="star"
                  title="Delete bet record"
                  onClick={(e) => { e.stopPropagation(); onRemove(bet.id); }}
                >
                  🗑
                </button>
              </div>
              <div className="bet-card-mid">
                <span className={`side-badge ${bet.side === "YES" ? "side-yes" : "side-no"}`}>
                  {bet.side}
                </span>
                <span className="muted">{bet.shares} @ {bet.entryPrice.toFixed(1)}¢ entry</span>
                <span className="muted">cost ${pnl.cost.toFixed(2)}</span>
              </div>
              <div className="bet-card-row">
                <span className="muted">Current</span>
                <span className="bet-cur">
                  {hit ? `${pnl.currentPrice.toFixed(1)}¢ · $${pnl.value.toFixed(2)}` : "market closed?"}
                </span>
              </div>
              <div className="bet-card-row">
                <span className="muted">Return</span>
                <b className={up ? "up" : "down"}>
                  {up ? "+" : "−"}${Math.abs(pnl.pnl).toFixed(2)} ({pnl.pnlPct >= 0 ? "+" : ""}
                  {pnl.pnlPct.toFixed(1)}%)
                </b>
              </div>
              <div className="bet-card-date">
                opened {bet.openedAt.slice(0, 10)}
              </div>
            </div>
          );
        })}
        {!openBets.length && (
          <div className="empty">
            {nClosed
              ? "No open positions — closed bets are on the portfolio page."
              : <>Log bets from any market's <b>$</b> button. Records stay in
                this browser only — use export for backup.</>}
          </div>
        )}
      </div>
    </div>
  );
}
