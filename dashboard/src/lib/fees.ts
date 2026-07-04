/**
 * Polymarket CLOB fee model. Taker fees are charged symmetrically around 50¢:
 *
 *   fee = baseRate × min(p, 1−p) × shares
 *
 * (see docs.polymarket.com — fees are levied on the proceeds side, and maker/
 * taker base rates are per-market). The geopolitics markets this dashboard
 * tracks currently trade FEE-FREE: Gamma returns `feesEnabled: false` and the
 * CLOB reports `maker_base_fee = taker_base_fee = 0` (verified Jul 4 2026;
 * non-zero fees exist only on short-duration crypto markets). So the default
 * rate is 0 bps — bump DEFAULT_FEE_BPS (or a bet's `feeBps`) if Polymarket
 * enables fees here, and every cost/P&L number updates automatically.
 *
 * Settlement redemptions ($1 per winning share at resolution) are always
 * fee-free — only book sales pay the taker fee.
 */
export const DEFAULT_FEE_BPS = 0;

/** Fee in dollars for a fill of `shares` at `priceCt` (percent, 0-100). */
export function polymarketFee(
  priceCt: number,
  shares: number,
  bps: number = DEFAULT_FEE_BPS,
): number {
  if (bps <= 0 || shares <= 0) return 0;
  return (bps / 10_000) * (Math.min(priceCt, 100 - priceCt) / 100) * shares;
}
