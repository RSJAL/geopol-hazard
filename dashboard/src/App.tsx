import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Catalog, LivePriceMap } from "./lib/types";
import { fetchCatalog, fetchLivePrices } from "./lib/api";
import { catalogStats, fmtVolume } from "./lib/analytics";
import { loadWatchlist, persist } from "./lib/watchlist";
import WorldMap from "./components/WorldMap";
import CatalogPanel from "./components/CatalogPanel";
import EventDetail from "./components/EventDetail";
import WatchlistPanel from "./components/WatchlistPanel";

const LIVE_REFRESH_MS = 60_000;

export default function App() {
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [live, setLive] = useState<LivePriceMap>(new Map());
  const [lastLiveAt, setLastLiveAt] = useState<number | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [watchlist, setWatchlist] = useState<string[]>(() => loadWatchlist());
  const [selectedId, setSelectedId] = useState<string | null>(
    () => new URLSearchParams(window.location.search).get("e"),
  );
  const [regionFilter, setRegionFilter] = useState<string | null>(null);

  // keep selected event in the URL so views are deep-linkable
  useEffect(() => {
    const url = new URL(window.location.href);
    if (selectedId) url.searchParams.set("e", selectedId);
    else url.searchParams.delete("e");
    window.history.replaceState(null, "", url.toString());
  }, [selectedId]);

  useEffect(() => {
    fetchCatalog().then(setCatalog).catch((e) => setError(String(e)));
  }, []);

  const watchSet = useMemo(() => new Set(watchlist), [watchlist]);

  const toggleWatch = useCallback((id: string) => {
    setWatchlist((prev) => {
      const next = prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id];
      persist(next);
      return next;
    });
  }, []);

  // ── Live price refresh: watchlist + selected event, on a timer ──────────────
  const liveTargets = useMemo(() => {
    const ids = new Set(watchlist);
    if (selectedId) ids.add(selectedId);
    return [...ids];
  }, [watchlist, selectedId]);
  const targetsRef = useRef(liveTargets);
  targetsRef.current = liveTargets;

  const refreshLive = useCallback(async () => {
    const ids = targetsRef.current;
    if (!ids.length) return;
    setRefreshing(true);
    try {
      const prices = await fetchLivePrices(ids);
      setLive((prev) => {
        const next = new Map(prev);
        for (const [k, v] of prices) next.set(k, v);
        return next;
      });
      setLastLiveAt(Date.now());
    } catch {
      /* transient network failure — snapshot prices remain */
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    if (!liveTargets.length) return;
    refreshLive();
    const t = window.setInterval(refreshLive, LIVE_REFRESH_MS);
    return () => window.clearInterval(t);
    // re-arm when the target set actually changes
  }, [liveTargets.join(","), refreshLive]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Derived ──────────────────────────────────────────────────────────────────
  const stats = useMemo(
    () => (catalog ? catalogStats(catalog.events, live) : null),
    [catalog, live],
  );
  const selected = useMemo(
    () => catalog?.events.find((e) => e.id === selectedId) ?? null,
    [catalog, selectedId],
  );
  const watchedEvents = useMemo(
    () =>
      watchlist
        .map((id) => catalog?.events.find((e) => e.id === id))
        .filter((e): e is NonNullable<typeof e> => !!e),
    [catalog, watchlist],
  );

  if (error) {
    return (
      <div className="boot-error">
        <h2>Failed to load catalog</h2>
        <p>{error}</p>
        <p>Run <code>python pipeline/build_catalog.py</code> to generate it.</p>
      </div>
    );
  }
  if (!catalog || !stats) return <div className="boot">Loading catalog…</div>;

  const snapshotAge = Math.round(
    (Date.now() - new Date(catalog.generatedAt).getTime()) / 60000,
  );

  return (
    <div className="app">
      <header className="header">
        <div>
          <h1 className="title">🌍 GEOPOL HAZARD MONITOR</h1>
          <p className="subtitle">
            Polymarket geopolitics · implied hazard rates by deadline ·{" "}
            snapshot {snapshotAge < 60 ? `${snapshotAge}m` : `${Math.round(snapshotAge / 60)}h`} old
            {lastLiveAt && <span className="live-dot"> · ● live</span>}
          </p>
        </div>
        <div className="tiles">
          <div className="tile">
            <div className="tile-label">Events</div>
            <div className="tile-value">{stats.nEvents}</div>
          </div>
          <div className="tile">
            <div className="tile-label">Markets</div>
            <div className="tile-value">{stats.nMarkets}</div>
          </div>
          <div className="tile">
            <div className="tile-label">Deadline ladders</div>
            <div className="tile-value accent">{stats.nHorizon}</div>
          </div>
          <div className="tile">
            <div className="tile-label">Volume</div>
            <div className="tile-value">{fmtVolume(stats.totalVolume)}</div>
          </div>
          <div className="tile" title={stats.spikeEvent}>
            <div className="tile-label">Sharpest spike</div>
            <div className="tile-value spike">{stats.spikeRatio.toFixed(0)}×</div>
          </div>
          <div className="tile">
            <div className="tile-label">Inversions</div>
            <div className="tile-value inv">{stats.totalInversions}</div>
          </div>
        </div>
      </header>

      <main className="layout">
        <CatalogPanel
          catalog={catalog}
          live={live}
          regionFilter={regionFilter}
          watchlist={watchSet}
          selectedId={selectedId}
          onSelect={setSelectedId}
          onToggleWatch={toggleWatch}
        />
        <div className="center-col">
          <WorldMap
            events={catalog.events}
            regions={catalog.regions}
            selectedRegion={regionFilter}
            onSelectRegion={setRegionFilter}
          />
          {selected ? (
            <EventDetail event={selected} live={live} />
          ) : (
            <div className="detail-placeholder">
              Select an event from the catalog to see its deadline ladder,
              implied daily hazard rates, and price paths.
            </div>
          )}
        </div>
        <WatchlistPanel
          events={watchedEvents}
          live={live}
          lastLiveAt={lastLiveAt}
          refreshing={refreshing}
          selectedId={selectedId}
          onSelect={setSelectedId}
          onRemove={toggleWatch}
          onRefresh={refreshLive}
        />
      </main>

      <footer className="footer">
        Data: Polymarket Gamma + CLOB APIs · snapshot {catalog.generatedAt} ·
        implied daily = cumulative YES% ÷ days to deadline · marginal daily =
        Δ YES% ÷ window days · not investment advice
      </footer>
    </div>
  );
}
