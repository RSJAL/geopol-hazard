import type { Bet, CatalogMarket, LivePriceMap } from "./types";
import { liveYes } from "./analytics";

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

/** Price per share for the bet's side, in percent (YES price or 100−YES). */
export function sidePrice(bet: Bet, m: CatalogMarket | undefined, live: LivePriceMap): number {
  const yes = m ? liveYes(m, live) : bet.entryPrice;
  return bet.side === "YES" ? yes : 100 - yes;
}

export interface BetPnl {
  cost: number; // dollars paid
  value: number; // current dollar value
  pnl: number;
  pnlPct: number;
  currentPrice: number; // percent for the taken side
}

export function betPnl(bet: Bet, m: CatalogMarket | undefined, live: LivePriceMap): BetPnl {
  const cur = sidePrice(bet, m, live);
  const cost = (bet.shares * bet.entryPrice) / 100;
  const value = (bet.shares * cur) / 100;
  return {
    cost,
    value,
    pnl: value - cost,
    pnlPct: cost > 0 ? ((value - cost) / cost) * 100 : 0,
    currentPrice: cur,
  };
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
    return arr.filter(
      (b): b is Bet =>
        typeof b?.marketId === "string" &&
        (b.side === "YES" || b.side === "NO") &&
        typeof b.shares === "number" &&
        typeof b.entryPrice === "number",
    );
  });
}
