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
}

export type EventType = "horizon" | "categorical" | "binary";

export interface CatalogEvent {
  id: string;
  slug: string;
  title: string;
  category: string;
  region: string | null;
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

export interface Catalog {
  generatedAt: string;
  referenceDate: string;
  tags: string[];
  minVolume: number;
  regions: RegionInfo[];
  events: CatalogEvent[];
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
