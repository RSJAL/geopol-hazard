import type { Bet, CatalogEvent, CatalogMarket, LivePriceMap } from "./types";
import { liveYes } from "./analytics";
import { DEFAULT_FEE_BPS, polymarketFee } from "./fees";

const LS_KEY = "geopol-bets";

export function loadBets(): Bet[] {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) return arr;
    }
  } catch {
    /* corrupted storage — start fresh */
  }
  return [];
}

export function persistBets(bets: Bet[]): void {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(bets));
  } catch {
    /* storage unavailable */
  }
}

export function newBetId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

export function isOpen(bet: Bet): boolean {
  return !bet.closedAt;
}

/** Price per share for the bet's side, in percent (YES price or 100−YES). */
export function sidePrice(bet: Bet, m: CatalogMarket | undefined, live: LivePriceMap): number {
  const yes = m ? liveYes(m, live) : bet.entryPrice;
  return bet.side === "YES" ? yes : 100 - yes;
}

export interface BetPnl {
  cost: number; // dollars paid, including the entry fee
  value: number; // open: current gross value · closed: net proceeds
  pnl: number;
  pnlPct: number;
  currentPrice: number; // percent for the taken side (exit price once closed)
  fees: number; // fees paid so far (entry + exit-if-sold)
}

export function betPnl(bet: Bet, m: CatalogMarket | undefined, live: LivePriceMap): BetPnl {
  const bps = bet.feeBps ?? DEFAULT_FEE_BPS;
  const entryFee = polymarketFee(bet.entryPrice, bet.shares, bps);
  const cost = (bet.shares * bet.entryPrice) / 100 + entryFee;
  const closed = !isOpen(bet);
  const cur = closed ? bet.exitPrice ?? 0 : sidePrice(bet, m, live);
  // settlement redemptions are fee-free; only book sales pay the taker fee
  const exitFee = closed && !bet.settled ? polymarketFee(cur, bet.shares, bps) : 0;
  const value = (bet.shares * cur) / 100 - exitFee;
  return {
    cost,
    value,
    pnl: value - cost,
    pnlPct: cost > 0 ? ((value - cost) / cost) * 100 : 0,
    currentPrice: cur,
    fees: entryFee + exitFee,
  };
}

/** Close a position: sold on the book (`settled=false`) or resolved. */
export function closeBet(bet: Bet, exitPrice: number, settled: boolean): Bet {
  return { ...bet, exitPrice, settled, closedAt: new Date().toISOString() };
}

export interface PortfolioSummary {
  nOpen: number;
  nClosed: number;
  invested: number; // lifetime cost of all positions, fees included
  openCost: number;
  openValue: number;
  unrealizedPnl: number;
  realizedPnl: number;
  totalPnl: number;
  totalPnlPct: number; // vs lifetime invested
  feesPaid: number;
  wins: number; // closed positions that made money
  losses: number;
}

export function portfolioSummary(
  bets: Bet[],
  marketIndex: Map<string, { market: CatalogMarket; event: CatalogEvent }>,
  live: LivePriceMap,
): PortfolioSummary {
  const s: PortfolioSummary = {
    nOpen: 0, nClosed: 0, invested: 0, openCost: 0, openValue: 0,
    unrealizedPnl: 0, realizedPnl: 0, totalPnl: 0, totalPnlPct: 0,
    feesPaid: 0, wins: 0, losses: 0,
  };
  for (const b of bets) {
    const pnl = betPnl(b, marketIndex.get(b.marketId)?.market, live);
    s.invested += pnl.cost;
    s.feesPaid += pnl.fees;
    if (isOpen(b)) {
      s.nOpen++;
      s.openCost += pnl.cost;
      s.openValue += pnl.value;
      s.unrealizedPnl += pnl.pnl;
    } else {
      s.nClosed++;
      s.realizedPnl += pnl.pnl;
      if (pnl.pnl >= 0) s.wins++;
      else s.losses++;
    }
  }
  s.totalPnl = s.unrealizedPnl + s.realizedPnl;
  s.totalPnlPct = s.invested > 0 ? (s.totalPnl / s.invested) * 100 : 0;
  return s;
}

export function exportBets(bets: Bet[]): void {
  const blob = new Blob([JSON.stringify(bets, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `geopol-bets-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
}

export function importBets(file: File): Promise<Bet[]> {
  return file.text().then((txt) => {
    const arr = JSON.parse(txt);
    if (!Array.isArray(arr)) throw new Error("not a bet list");
    return arr
      .filter(
        (b) =>
          typeof b?.marketId === "string" &&
          (b.side === "YES" || b.side === "NO") &&
          Number.isFinite(b.shares) && b.shares > 0 &&
          Number.isFinite(b.entryPrice) && b.entryPrice > 0 && b.entryPrice < 100,
      )
      .map(
        (b): Bet => ({
          // hand-edited files may lack the bookkeeping fields — fill them in
          id: typeof b.id === "string" && b.id ? b.id : newBetId(),
          eventId: typeof b.eventId === "string" ? b.eventId : "",
          marketId: b.marketId,
          label: typeof b.label === "string" && b.label ? b.label : `market ${b.marketId}`,
          side: b.side,
          shares: b.shares,
          entryPrice: b.entryPrice,
          openedAt: typeof b.openedAt === "string" ? b.openedAt : new Date().toISOString(),
          ...(typeof b.closedAt === "string" && Number.isFinite(b.exitPrice)
            ? { closedAt: b.closedAt, exitPrice: b.exitPrice, settled: b.settled === true }
            : {}),
          ...(Number.isFinite(b.feeBps) && b.feeBps > 0 ? { feeBps: b.feeBps } : {}),
        }),
      );
  });
}
