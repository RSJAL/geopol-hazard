import { useMemo, useState } from "react";
import type { Catalog, CatalogEvent, LivePriceMap } from "../lib/types";
import { anchorCountry, fmtVolume, headlineMarket, liveYes } from "../lib/analytics";
import type { MapFilter } from "./WorldMap";

interface Props {
  catalog: Catalog;
  live: LivePriceMap;
  regionFilter: string | null;
  /** map scope: geography clicks only list watched/bet events in these modes */
  mapMode: MapFilter;
  betEventIds: Set<string>;
  watchlist: Set<string>;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onToggleWatch: (id: string) => void;
  onRegionFilter: (id: string | null) => void;
  onMapModeChange: (m: MapFilter) => void;
}

type SortKey = "volume" | "volume24h" | "move" | "endDate";

// categorical events show no type token (V0.151: "buckets" jargon removed)
const TYPE_LABEL: Record<string, string> = {
  horizon: "⏱ ladder",
  binary: "◦ binary",
};

/**
 * Two-state panel, Browse-style (V0.15): a region list with counts first;
 * picking a geographic scope (here or on the map) reveals the market list
 * with search, filters, and sort.
 */
export default function CatalogPanel({
  catalog, live, regionFilter, mapMode, betEventIds, watchlist,
  selectedId, onSelect, onToggleWatch, onRegionFilter, onMapModeChange,
}: Props) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("");
  const [type, setType] = useState("");
  const [sort, setSort] = useState<SortKey>("volume");
  /** "All markets" picked — scoped view without a geographic filter */
  const [browseAll, setBrowseAll] = useState(false);

  const scoped = browseAll || regionFilter !== null;

  const categories = useMemo(
    () => [...new Set(catalog.events.map((e) => e.category))].sort(),
    [catalog],
  );
  const regionOfCountry = useMemo(
    () => new Map(catalog.countries.map((c) => [c.id, c.region])),
    [catalog],
  );
  const subregionOfCountry = useMemo(
    () => new Map(catalog.countries.map((c) => [c.id, c.subregion ?? null])),
    [catalog],
  );

  /** 24h-volume threshold for the top 10% of events — the "Active" tag */
  const activeCut = useMemo(() => {
    const vols = catalog.events.map((e) => e.volume24h).sort((a, b) => b - a);
    if (!vols.length) return Infinity;
    const cut = vols[Math.max(0, Math.ceil(vols.length * 0.1) - 1)];
    return cut > 0 ? cut : Infinity; // all-zero snapshot: tag nothing
  }, [catalog]);

  /** events surviving the map's all/watch/bets scope — counts match bubbles */
  const base = useMemo(
    () =>
      catalog.events.filter((e) =>
        mapMode === "watch" ? watchlist.has(e.id)
        : mapMode === "bets" ? betEventIds.has(e.id)
        : true),
    [catalog, mapMode, watchlist, betEventIds],
  );

  const { regionCounts, globalCount } = useMemo(() => {
    const regionCounts = new Map<string, number>();
    let globalCount = 0;
    for (const e of base) {
      if (!e.region) { globalCount++; continue; }
      regionCounts.set(e.region, (regionCounts.get(e.region) ?? 0) + 1);
    }
    return { regionCounts, globalCount };
  }, [base]);

  /** events inside the selected geography (all of `base` for "All markets") */
  const inScope = useMemo(
    () =>
      base.filter((e) => {
        if (!regionFilter) return true;
        if (regionFilter === "__global__") return !e.region;
        if (regionFilter.startsWith("country:"))
          // same anchor rule as the map bubbles, so counts match the list
          return anchorCountry(e, regionOfCountry) === regionFilter.slice(8);
        if (regionFilter.startsWith("sub:")) {
          const cid = anchorCountry(e, regionOfCountry);
          return !!cid && subregionOfCountry.get(cid) === regionFilter.slice(4);
        }
        if (regionFilter.startsWith("rem:"))
          // region leftovers: events with no own-region anchor country
          return e.region === regionFilter.slice(4) && !anchorCountry(e, regionOfCountry);
        return e.region === regionFilter;
      }),
    [base, regionFilter, regionOfCountry, subregionOfCountry],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    let evs = inScope.filter((e) => {
      if (category && e.category !== category) return false;
      if (type && e.type !== type) return false;
      if (q && !e.title.toLowerCase().includes(q) && !e.tags.some((t) => t.includes(q)))
        return false;
      return true;
    });
    const move = (e: CatalogEvent) =>
      Math.max(0, ...e.markets.map((m) => Math.abs(m.change24h ?? 0)));
    switch (sort) {
      case "volume":    evs = evs.sort((a, b) => b.volume - a.volume); break;
      case "volume24h": evs = evs.sort((a, b) => b.volume24h - a.volume24h); break;
      case "move":      evs = evs.sort((a, b) => move(b) - move(a)); break;
      case "endDate":   evs = evs.sort((a, b) => a.endDate.localeCompare(b.endDate)); break;
    }
    return evs;
  }, [inScope, query, category, type, sort]);

  const regionName = (id: string) => catalog.regions.find((r) => r.id === id)?.name ?? id;
  const scopeLabel = !regionFilter
    ? "All markets"
    : regionFilter === "__global__"
      ? "Global / other"
      : regionFilter.startsWith("country:")
        ? catalog.countries.find((c) => c.id === regionFilter.slice(8))?.name ?? "Country"
        : regionFilter.startsWith("sub:")
          ? catalog.subregions?.find((s) => s.id === regionFilter.slice(4))?.name ?? "Subregion"
          : regionFilter.startsWith("rem:")
            ? `${regionName(regionFilter.slice(4))} · other`
            : regionName(regionFilter);

  const backToRegions = () => {
    setBrowseAll(false);
    onRegionFilter(null);
    setQuery("");
  };

  // ── State A: geographic scope picker (Browse-sidebar style) ────────────────
  if (!scoped) {
    return (
      <div className="catalog-panel">
        <div className="panel-head">
          <span className="panel-title">Market Catalog</span>
          <span className="panel-sub">
            {mapMode === "watch" ? "★ watchlist" : mapMode === "bets" ? "$ bets" : "all events"}
          </span>
        </div>
        <div className="cat-side">
          <button className="bw-side-item" onClick={() => setBrowseAll(true)}>
            <span className="bw-side-name">All markets</span>
            <span className="bw-side-count">{base.length}</span>
          </button>
          <div className="bw-side-sect">Regions</div>
          {catalog.regions
            .filter((r) => (regionCounts.get(r.id) ?? 0) > 0)
            .sort((a, b) => (regionCounts.get(b.id) ?? 0) - (regionCounts.get(a.id) ?? 0))
            .map((r) => (
              <button key={r.id} className="bw-side-item" onClick={() => onRegionFilter(r.id)}>
                <span className="bw-side-name">{r.name}</span>
                <span className="bw-side-count">{regionCounts.get(r.id)}</span>
              </button>
            ))}
          {globalCount > 0 && (
            <button className="bw-side-item" onClick={() => onRegionFilter("__global__")}>
              <span className="bw-side-name">Global / other</span>
              <span className="bw-side-count">{globalCount}</span>
            </button>
          )}
          {!base.length && (
            <div className="empty">
              {mapMode === "watch"
                ? "Watchlist is empty — star events to track them here."
                : "No open bets — log one from any market's $ button."}
            </div>
          )}
        </div>
        <div className="cat-hint">
          Pick a region here or click the map — bubbles mirror these counts.
        </div>
      </div>
    );
  }

  // ── State B: markets in the selected scope ─────────────────────────────────
  return (
    <div className="catalog-panel">
      <div className="cat-scope-head">
        <button className="cat-back" onClick={backToRegions}>‹ Regions</button>
        <span className="cat-scope-name">{scopeLabel}</span>
        <span className="panel-sub">{filtered.length} / {inScope.length}</span>
      </div>

      <input
        className="search"
        placeholder="Search events or tags…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <div className="filter-row">
        <select value={type} onChange={(e) => setType(e.target.value)}>
          <option value="">All market types</option>
          <option value="horizon">Deadline ladder</option>
          <option value="categorical">Outcome buckets</option>
          <option value="binary">Single binary</option>
        </select>
        <select value={category} onChange={(e) => setCategory(e.target.value)}>
          <option value="">All categories</option>
          {categories.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>
      <div className="filter-row">
        <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)}>
          <option value="volume">Sort: total volume</option>
          <option value="volume24h">Sort: 24h volume</option>
          <option value="move">Sort: biggest 24h move</option>
          <option value="endDate">Sort: nearest deadline</option>
        </select>
        <div className="toggle cat-scope-toggle">
          <button
            className={mapMode === "watch" ? "on" : ""}
            title="Watchlisted events only"
            onClick={() => onMapModeChange(mapMode === "watch" ? "all" : "watch")}
          >
            ★
          </button>
          <button
            className={mapMode === "bets" ? "on" : ""}
            title="Events with open bets only"
            onClick={() => onMapModeChange(mapMode === "bets" ? "all" : "bets")}
          >
            $
          </button>
        </div>
      </div>

      <div className="catalog-list">
        {filtered.map((ev) => {
          const hm = headlineMarket(ev);
          const yes = liveYes(hm, live);
          const chg = (live.get(hm.id)?.change24h ?? hm.change24h ?? 0) * 100;
          const watched = watchlist.has(ev.id);
          return (
            <div
              key={ev.id}
              className={`catalog-row${selectedId === ev.id ? " selected" : ""}`}
              onClick={() => onSelect(ev.id)}
            >
              <button
                className={`star${watched ? " on" : ""}`}
                title={watched ? "Remove from watchlist" : "Add to watchlist"}
                onClick={(e) => { e.stopPropagation(); onToggleWatch(ev.id); }}
              >
                {watched ? "★" : "☆"}
              </button>
              <div className="row-main">
                <div className="row-title">
                  {ev.volume24h >= activeCut && (
                    <span
                      className="badge b-active"
                      title={`Top 10% of events by 24h volume (${fmtVolume(ev.volume24h)} traded today)`}
                    >
                      ⚡ ACTIVE
                    </span>
                  )}
                  {ev.title}
                </div>
                <div className="row-meta">
                  {ev.category}
                  {TYPE_LABEL[ev.type] && ` · ${TYPE_LABEL[ev.type]}`}
                  {` · ${fmtVolume(ev.volume)}`}
                  {ev.type === "horizon" && ` · ${new Set(ev.markets.map((m) => m.endDate)).size} deadlines`}
                </div>
              </div>
              <div className="row-price">
                <div className="row-yes">{yes.toFixed(1)}%</div>
                {chg !== 0 && (
                  <div className={`row-chg ${chg > 0 ? "up" : "down"}`}>
                    {chg > 0 ? "▲" : "▼"} {Math.abs(chg).toFixed(1)}
                  </div>
                )}
              </div>
            </div>
          );
        })}
        {!filtered.length && <div className="empty">No events match the filters.</div>}
      </div>
    </div>
  );
}
