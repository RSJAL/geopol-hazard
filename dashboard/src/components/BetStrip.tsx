import type { Bet, CatalogMarket, LivePriceMap } from "../lib/types";
import { betPnl } from "../lib/bets";

/** Compact strip showing a logged bet on a market card. */
export function BetStrip({ bet, market, live }: { bet: Bet; market: CatalogMarket | undefined; live: LivePriceMap }) {
  const pnl = betPnl(bet, market, live);
  const up = pnl.pnl >= 0;
  return (
    <div className="bet-strip" onClick={(e) => e.stopPropagation()}>
      <span className={`side-badge ${bet.side === "YES" ? "side-yes" : "side-no"}`}>{bet.side}</span>
      <span className="muted">{bet.shares} @ {bet.entryPrice.toFixed(1)}¢</span>
      <span className="strip-cur">now {pnl.currentPrice.toFixed(1)}¢</span>
      <b className={up ? "up" : "down"}>
        {up ? "+" : "−"}${Math.abs(pnl.pnl).toFixed(2)} ({pnl.pnlPct >= 0 ? "+" : ""}
        {pnl.pnlPct.toFixed(1)}%)
      </b>
    </div>
  );
}
