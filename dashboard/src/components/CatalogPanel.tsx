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
}

type SortKey = "volume" | "volume24h" | "move" | "endDate";

const TYPE_LABEL: Record<string, string> = {
  horizon: "⏱ ladder",
  categorical: "▤ buckets",
  binary: "◦ binary",
};

export default function CatalogPanel({
  catalog, live, regionFilter, mapMode, betEventIds, watchlist,
  selectedId, onSelect, onToggleWatch,
}: Props) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("");
  const [type, setType] = useState("");
  const [sort, setSort] = useState<SortKey>("volume");
  const [watchOnly, setWatchOnly] = useState(false);

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

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    let evs = catalog.events.filter((e) => {
      // a geography click while the map shows only watchlist/bets should
      // list only those events, not everything in the geography
      if (regionFilter && mapMode === "watch" && !watchlist.has(e.id)) return false;
      if (regionFilter && mapMode === "bets" && !betEventIds.has(e.id)) return false;
      if (regionFilter === "__global__" && e.region) return false;
      if (regionFilter?.startsWith("country:")) {
        // same anchor rule as the map bubbles, so counts match the list
        if (anchorCountry(e, regionOfCountry) !== regionFilter.slice(8)) return false;
      } else if (regionFilter?.startsWith("sub:")) {
        const cid = anchorCountry(e, regionOfCountry);
        if (!cid || subregionOfCountry.get(cid) !== regionFilter.slice(4)) return false;
      } else if (regionFilter?.startsWith("rem:")) {
        // region leftovers: events with no own-region anchor country
        if (e.region !== regionFilter.slice(4) || anchorCountry(e, regionOfCountry)) return false;
      } else if (regionFilter && regionFilter !== "__global__" && e.region !== regionFilter) {
        return false;
      }
      if (category && e.category !== category) return false;
      if (type && e.type !== type) return false;
      if (watchOnly && !watchlist.has(e.id)) return false;
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
  }, [catalog, query, category, type, sort, watchOnly, watchlist, regionFilter, regionOfCountry, subregionOfCountry, mapMode, betEventIds]);

  return (
    <div className="catalog-panel">
      <div className="panel-head">
        <span className="panel-title">Market Catalog</span>
        <span className="panel-sub">{filtered.length} / {catalog.events.length}</span>
      </div>

      <input
        className="search"
        placeholder="Search events or tags…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <div className="filter-row">
        <select value={category} onChange={(e) => setCategory(e.target.value)}>
          <option value="">All categories</option>
          {categories.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <select value={type} onChange={(e) => setType(e.target.value)}>
          <option value="">All types</option>
          <option value="horizon">Deadline ladder</option>
          <option value="categorical">Outcome buckets</option>
          <option value="binary">Single binary</option>
        </select>
      </div>
      <div className="filter-row">
        <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)}>
          <option value="volume">Sort: total volume</option>
          <option value="volume24h">Sort: 24h volume</option>
          <option value="move">Sort: biggest 24h move</option>
          <option value="endDate">Sort: nearest deadline</option>
        </select>
        <label className="check">
          <input type="checkbox" checked={watchOnly} onChange={(e) => setWatchOnly(e.target.checked)} />
          ★ watchlist
        </label>
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
                <div className="row-title">{ev.title}</div>
                <div className="row-meta">
                  {ev.category} · {TYPE_LABEL[ev.type]} · {fmtVolume(ev.volume)}
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
