import type { Catalog, LivePrice, NewsData, PricePoint } from "./types";

const GAMMA = "https://gamma-api.polymarket.com";
const CLOB = "https://clob.polymarket.com";

export async function fetchCatalog(): Promise<Catalog> {
  const res = await fetch("data/catalog.json", { cache: "no-cache" });
  if (!res.ok) throw new Error(`catalog fetch failed: ${res.status}`);
  return res.json();
}

export async function fetchNews(): Promise<NewsData | null> {
  try {
    const res = await fetch("data/news.json", { cache: "no-cache" });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null; // news is optional — dashboard works without it
  }
}

function parseYes(outcomePrices: unknown): number | null {
  try {
    const arr =
      typeof outcomePrices === "string" ? JSON.parse(outcomePrices) : outcomePrices;
    if (Array.isArray(arr) && arr.length) {
      const v = parseFloat(arr[0]);
      if (Number.isFinite(v)) return Math.round(v * 10000) / 100;
    }
  } catch {
    /* malformed price payload */
  }
  return null;
}

/**
 * Fetch live prices for a set of event ids. Returns a map keyed by MARKET id.
 * Uses the keyset endpoint's `id` array filter (one round trip).
 */
export async function fetchLivePrices(
  eventIds: string[],
): Promise<Map<string, LivePrice>> {
  const out = new Map<string, LivePrice>();
  if (!eventIds.length) return out;

  // the keyset `id` filter returns at most `limit` (100) events per call
  const chunks: string[][] = [];
  for (let i = 0; i < eventIds.length; i += 100)
    chunks.push(eventIds.slice(i, i + 100));

  const bodies = await Promise.all(
    chunks.map(async (ids) => {
      const params = new URLSearchParams();
      for (const id of ids) params.append("id", id);
      params.set("limit", "100");
      const res = await fetch(`${GAMMA}/events/keyset?${params}`);
      if (!res.ok) throw new Error(`live price fetch failed: ${res.status}`);
      return res.json();
    }),
  );
  const now = Date.now();

  for (const body of bodies) {
    for (const ev of body.events ?? []) {
      for (const m of ev.markets ?? []) {
        const yes = parseYes(m.outcomePrices);
        if (yes === null) continue;
        out.set(String(m.id), {
          yes,
          change24h: m.oneDayPriceChange ?? null,
          fetchedAt: now,
        });
      }
    }
  }
  return out;
}

export type HistoryInterval = "1d" | "1w" | "1m" | "max";

/** CLOB price history for a YES token. Returns points sorted by time. */
export async function fetchPriceHistory(
  tokenId: string,
  interval: HistoryInterval = "1m",
): Promise<PricePoint[]> {
  const fidelity = interval === "1d" ? 10 : interval === "1w" ? 60 : 180;
  const res = await fetch(
    `${CLOB}/prices-history?market=${tokenId}&interval=${interval}&fidelity=${fidelity}`,
  );
  if (!res.ok) throw new Error(`history fetch failed: ${res.status}`);
  const body = await res.json();
  return (body.history ?? []) as PricePoint[];
}
