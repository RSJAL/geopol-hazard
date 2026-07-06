import type { CatalogEvent, CatalogMarket, LivePriceMap } from "./types";

export interface LadderRow {
  market: CatalogMarket;
  label: string;
  endDate: string;
  days: number;
  yes: number; // cumulative (total) YES %
  marginal: number; // period odds: yes − previous deadline's yes, pct points
  implDaily: number; // implied daily odds: 1 − (1−P)^(1/days), in %
  margDaily: number; // period daily odds: in-window hazard conditional on
  //                    surviving the previous deadline, in %
  windowDays: number;
  isPeak: boolean;
  isInversion: boolean; // implied daily fell vs prior deadline
  isCheap: boolean; // marginal daily < 40% of implied daily
  isNegativeMarginal: boolean; // longer deadline priced BELOW shorter one
}

const MS_DAY = 86_400_000;

export function daysFromToday(endDate: string): number {
  const end = new Date(endDate + "T23:59:59Z").getTime();
  return Math.max(1, Math.ceil((end - Date.now()) / MS_DAY));
}

export function deadlineLabel(endDate: string): string {
  const d = new Date(endDate + "T12:00:00Z");
  const sameYear = d.getUTCFullYear() === new Date().getUTCFullYear();
  const opts: Intl.DateTimeFormatOptions = sameYear
    ? { month: "short", day: "numeric", timeZone: "UTC" }
    : { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" };
  return "By " + d.toLocaleDateString("en-US", opts);
}

export function liveYes(m: CatalogMarket, live: LivePriceMap): number {
  return live.get(m.id)?.yes ?? m.yes;
}

/**
 * Implied daily odds: the constant per-day probability p such that running it
 * for `days` days compounds to the cumulative probability P:
 *   P = 1 − (1−p)^days  ⟹  p = 1 − (1−P)^(1/days)
 * (NOT P/days — the linear version materially understates high-P markets.)
 * Inputs and outputs in percent.
 */
export function impliedDaily(pctCum: number, days: number): number {
  const surv = Math.max(1 - pctCum / 100, 1e-9);
  return (1 - Math.pow(surv, 1 / Math.max(1, days))) * 100;
}

/**
 * Build the deadline ladder for a horizon event. When several sub-markets
 * share an end date (different outcome thresholds), the highest-volume one
 * is used.
 */
export function buildLadder(ev: CatalogEvent, live: LivePriceMap): LadderRow[] {
  const byEnd = new Map<string, CatalogMarket>();
  for (const m of ev.markets) {
    const cur = byEnd.get(m.endDate);
    if (!cur || m.volume > cur.volume) byEnd.set(m.endDate, m);
  }
  const markets = [...byEnd.values()]
    .map((m) => ({ m, days: daysFromToday(m.endDate) }))
    // endDate tiebreak: days clamps at 1, so two just-resolved rungs kept in
    // the 2-day grace window would otherwise sort arbitrarily
    .sort((a, b) => a.days - b.days || a.m.endDate.localeCompare(b.m.endDate));

  const implVals = markets.map(({ m, days }) => impliedDaily(liveYes(m, live), days));
  const peak = Math.max(...implVals);

  const rows: LadderRow[] = [];
  let prevYes = 0;
  let prevDays = 0;
  let prevImpl: number | null = null;

  for (const { m, days } of markets) {
    const yes = liveYes(m, live);
    const impl = impliedDaily(yes, days);
    const marginal = yes - prevYes;
    const windowDays = days - prevDays;
    // period daily odds: per-day hazard inside (prevDays, days] conditional on
    // the event not happening by prevDays — survival-ratio form nests impl for
    // the first row and goes negative when a longer deadline is priced lower
    const survRatio =
      Math.max(1 - yes / 100, 1e-9) / Math.max(1 - prevYes / 100, 1e-9);
    const margDaily =
      windowDays > 0 ? (1 - Math.pow(survRatio, 1 / windowDays)) * 100 : impl;

    rows.push({
      market: m,
      label: deadlineLabel(m.endDate),
      endDate: m.endDate,
      days,
      yes,
      marginal,
      implDaily: impl,
      margDaily,
      windowDays,
      isPeak: Math.abs(impl - peak) < 1e-9,
      isInversion: prevImpl !== null && impl < prevImpl,
      isCheap: prevImpl !== null && marginal >= 0 && margDaily < impl * 0.4,
      isNegativeMarginal: marginal < 0,
    });
    prevYes = yes;
    prevDays = days;
    prevImpl = impl;
  }
  return rows;
}

export interface CatalogStats {
  nEvents: number;
  nMarkets: number;
  nHorizon: number;
  totalVolume24h: number;
  spikeRatio: number;
  spikeEvent: string;
  spikeEventId: string;
}

export function catalogStats(events: CatalogEvent[], live: LivePriceMap): CatalogStats {
  let spikeRatio = 0;
  let spikeEvent = "";
  let spikeEventId = "";

  for (const ev of events) {
    if (ev.type !== "horizon") continue;
    const rows = buildLadder(ev, live);
    const impls = rows.map((r) => r.implDaily);
    if (impls.length >= 2) {
      const ratio = Math.max(...impls) / (Math.min(...impls) + 1e-9);
      if (ratio > spikeRatio) {
        spikeRatio = ratio;
        spikeEvent = ev.title;
        spikeEventId = ev.id;
      }
    }
  }

  return {
    nEvents: events.length,
    nMarkets: events.reduce((s, e) => s + e.markets.length, 0),
    nHorizon: events.filter((e) => e.type === "horizon").length,
    totalVolume24h: events.reduce((s, e) => s + e.volume24h, 0),
    spikeRatio,
    spikeEvent,
    spikeEventId,
  };
}

export function fmtVolume(v: number): string {
  if (v >= 1e9) return `$${(v / 1e9).toFixed(1)}B`;
  if (v >= 1e6) return `$${(v / 1e6).toFixed(1)}M`;
  if (v >= 1e3) return `$${(v / 1e3).toFixed(0)}K`;
  return `$${v.toFixed(0)}`;
}

/**
 * Zoomed-in map anchor: the event's first country that belongs to its own
 * region, else null (event stays on the region bubble). Keeping anchors
 * inside the region makes country counts split region totals exactly.
 */
export function anchorCountry(
  ev: CatalogEvent,
  regionOfCountry: Map<string, string | undefined>,
): string | null {
  if (!ev.region) return null;
  return ev.countries?.find((c) => regionOfCountry.get(c) === ev.region) ?? null;
}

/** Nearest-deadline market of an event (for compact list rows). */
export function headlineMarket(ev: CatalogEvent): CatalogMarket {
  if (ev.type === "categorical") {
    // most-traded bucket is the headline
    return ev.markets.reduce((a, b) => (b.volume > a.volume ? b : a));
  }
  return ev.markets.reduce((a, b) => (b.endDate < a.endDate ? b : a));
}
