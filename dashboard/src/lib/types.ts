export interface CatalogMarket {
  id: string;
  question: string;
  groupItemTitle: string;
  endDate: string; // YYYY-MM-DD
  days: number; // days from snapshot reference date (recompute client-side)
  yes: number; // YES price in percent 0-100
  bestAsk: number | null;
  lastTradePrice: number | null;
  change24h: number | null; // price change 0-1 scale from API
  spread: number | null;
  volume: number;
  volume1wk: number;
  liquidity: number;
  yesTokenId: string | null;
  /** Polymarket taker fee rate in bps (0 = fee-free; absent on old catalogs) */
  feeBps?: number;
}

export type EventType = "horizon" | "categorical" | "binary";

export interface CatalogEvent {
  id: string;
  slug: string;
  title: string;
  category: string;
  region: string | null;
  countries: string[];
  groupKey: string;
  type: EventType;
  tags: string[];
  volume: number;
  volume24h: number;
  liquidity: number;
  endDate: string;
  markets: CatalogMarket[];
}

export interface RegionInfo {
  id: string;
  name: string;
  lat: number;
  lon: number;
}

export interface CountryInfo {
  id: string;
  name: string;
  lat: number;
  lon: number;
  /** home region id — optional for old-schema catalog tolerance */
  region?: string;
  /** middle hierarchy level; null/absent = country sits directly under region */
  subregion?: string | null;
}

export interface SubregionInfo {
  id: string;
  region: string;
  name: string;
  lat: number;
  lon: number;
}

export interface Catalog {
  generatedAt: string;
  referenceDate: string;
  tags: string[];
  minVolume: number;
  regions: RegionInfo[];
  subregions?: SubregionInfo[]; // optional: old-schema catalogs lack it
  countries: CountryInfo[];
  events: CatalogEvent[];
}

// ── News ─────────────────────────────────────────────────────────────────────
export type NewsSourceType = "press" | "osint" | "breaking";

export interface NewsArticle {
  id: string;
  title: string;
  url: string;
  source: string;
  /** press (RSS whitelist) | osint / breaking (X accounts); absent = press */
  sourceType?: NewsSourceType;
  publishedAt: string | null;
  regions: string[];
  eventIds: string[];
  /** escalation score in [-1,1]: negative = hot/escalatory, positive = cool */
  sentiment: number;
}

export interface NewsData {
  generatedAt: string;
  sources: string[];
  articles: NewsArticle[];
}

// ── Bets (browser-local only, never shared/synced) ──────────────────────────
export interface Bet {
  id: string;
  eventId: string;
  marketId: string;
  label: string; // human label: question / deadline
  side: "YES" | "NO";
  shares: number;
  entryPrice: number; // percent 0-100 paid per share (x100 = cents)
  openedAt: string; // ISO date
  /** present ⇒ position is closed (absent on legacy records = open) */
  closedAt?: string;
  /** price received per share at close, percent, for the taken side */
  exitPrice?: number;
  /** closed by market resolution (fee-free) rather than sold on the book */
  settled?: boolean;
  /** Polymarket taker fee rate in bps captured at open (0 = fee-free) */
  feeBps?: number;
}

/** Live price overlay fetched client-side, keyed by market id. */
export interface LivePrice {
  yes: number;
  change24h: number | null;
  fetchedAt: number;
}

export type LivePriceMap = Map<string, LivePrice>;

export interface PricePoint {
  t: number; // unix seconds
  p: number; // price 0-1
}
