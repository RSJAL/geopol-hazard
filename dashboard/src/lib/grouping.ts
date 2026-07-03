import type { CatalogEvent } from "./types";

export interface EventGroup {
  key: string;
  /** display title: shortest member title, cleaned */
  title: string;
  events: CatalogEvent[]; // sorted by nearest endDate
  /** synthetic event merging all members' markets — a cross-event deadline
   *  ladder ("China invades Taiwan" across separate Polymarket events) */
  merged: CatalogEvent | null;
}

function cleanTitle(t: string): string {
  return t
    .replace(/\s+by\s*(\.\.\.|…)\s*\??$/i, "")
    .replace(/\s+(by|before|in)\s+[A-Za-z]*\.?\s*\d{0,2},?\s*20\d\d\s*\??$/i, "")
    .replace(/\s+before 20\d\d\s*\??$/i, "")
    .replace(/[?？]\s*$/, "")
    .trim();
}

export function buildGroups(events: CatalogEvent[]): EventGroup[] {
  const byKey = new Map<string, CatalogEvent[]>();
  for (const ev of events) {
    const k = ev.groupKey || ev.id;
    (byKey.get(k) ?? byKey.set(k, []).get(k)!).push(ev);
  }

  const groups: EventGroup[] = [];
  for (const [key, evs] of byKey) {
    evs.sort((a, b) => a.endDate.localeCompare(b.endDate));
    let merged: CatalogEvent | null = null;
    if (evs.length > 1) {
      const allMarkets = evs.flatMap((e) => e.markets);
      const distinctEnds = new Set(allMarkets.map((m) => m.endDate));
      if (distinctEnds.size >= 2) {
        const primary = evs.reduce((a, b) => (b.volume > a.volume ? b : a));
        merged = {
          ...primary,
          id: `group:${key}`,
          title: cleanTitle(primary.title),
          type: "horizon",
          volume: evs.reduce((s, e) => s + e.volume, 0),
          volume24h: evs.reduce((s, e) => s + e.volume24h, 0),
          markets: allMarkets,
        };
      }
    }
    groups.push({
      key,
      title: cleanTitle(evs.reduce((a, b) => (b.title.length < a.title.length ? b : a)).title),
      events: evs,
      merged,
    });
  }

  groups.sort(
    (a, b) =>
      b.events.reduce((s, e) => s + e.volume, 0) -
      a.events.reduce((s, e) => s + e.volume, 0),
  );
  return groups;
}

/** Short label distinguishing group members, e.g. "Dec 2026" from endDate. */
export function memberLabel(ev: CatalogEvent): string {
  if (!ev.endDate) return ev.title.slice(0, 12);
  const d = new Date(ev.endDate + "T12:00:00Z");
  return d.toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
}
