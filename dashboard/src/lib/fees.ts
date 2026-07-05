/**
 * Polymarket taker fee model (docs.polymarket.com, July 2026):
 *
 *   fee = shares × feeRate × p × (1−p)
 *
 * Makers pay nothing; takers pay a per-category rate — crypto 7%, sports 3%,
 * finance/politics/tech/mentions 4%, economics/culture/weather/other 5%, and
 * **geopolitics/world-events markets are fee-free** ("Polymarket does not
 * charge fees or profit from trading activity on these markets"). Fees peak
 * at 50¢ and fall symmetrically toward 0¢/100¢.
 *
 * The pipeline records each market's rate in `CatalogMarket.feeBps` (from
 * Gamma's feesEnabled/feeType), so bets on any fee-enabled market that slips
 * into the catalog are costed correctly; the geopolitics markets this
 * dashboard tracks resolve to 0 bps. DEFAULT_FEE_BPS is only the fallback for
 * markets with no recorded rate. Settlement redemptions ($1 per winning share
 * at resolution) are always fee-free — only book sales pay the taker fee.
 */
export const DEFAULT_FEE_BPS = 0;

/** Taker fee in dollars for a fill of `shares` at `priceCt` (percent, 0-100). */
export function polymarketFee(
  priceCt: number,
  shares: number,
  bps: number = DEFAULT_FEE_BPS,
): number {
  if (bps <= 0 || shares <= 0) return 0;
  const p = priceCt / 100;
  return (bps / 10_000) * p * (1 - p) * shares;
}

/** Human label for a market's taker fee rate, for bet-form display. */
export function feeRateLabel(bps: number): string {
  return bps > 0 ? `${(bps / 100).toFixed(bps % 100 ? 2 : 0)}% taker` : "fee-free";
}
