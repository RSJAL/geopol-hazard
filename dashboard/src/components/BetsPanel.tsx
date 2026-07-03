import { useRef } from "react";
import type { Bet, CatalogEvent, CatalogMarket, LivePriceMap } from "../lib/types";
import { betPnl, exportBets, importBets } from "../lib/bets";

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

  let totCost = 0;
  let totValue = 0;
  const rows = bets.map((b) => {
    const hit = marketIndex.get(b.marketId);
    const pnl = betPnl(b, hit?.market, live);
    totCost += pnl.cost;
    totValue += pnl.value;
    return { bet: b, hit, pnl };
  });
  const totPnl = totValue - totCost;

  return (
    <div className="bets-panel">
      {bets.length > 0 && (
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
        {rows.map(({ bet, hit, pnl }) => (
          <div
            key={bet.id}
            className="bet-item"
            onClick={() => bet.eventId && onSelectEvent(bet.eventId)}
          >
            <div className="row-main">
              <div className="row-title">{bet.label}</div>
              <div className="row-meta">
                {bet.side} · {bet.shares} @ {bet.entryPrice.toFixed(1)}¢
                {" → "}
                {hit ? `${pnl.currentPrice.toFixed(1)}¢` : "market closed?"}
              </div>
            </div>
            <div className="row-price">
              <div className={`row-yes ${pnl.pnl >= 0 ? "up" : "down"}`}>
                {pnl.pnl >= 0 ? "+" : "−"}${Math.abs(pnl.pnl).toFixed(2)}
              </div>
              <div className={`row-chg ${pnl.pnl >= 0 ? "up" : "down"}`}>
                {pnl.pnlPct >= 0 ? "+" : ""}{pnl.pnlPct.toFixed(0)}%
              </div>
            </div>
            <button
              className="star"
              title="Delete bet record"
              onClick={(e) => { e.stopPropagation(); onRemove(bet.id); }}
            >
              🗑
            </button>
          </div>
        ))}
        {!bets.length && (
          <div className="empty">
            Log bets from any market's <b>$</b> button. Records stay in this
            browser only — use export for backup.
          </div>
        )}
      </div>
    </div>
  );
}
