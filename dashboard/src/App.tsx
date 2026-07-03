import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Bet, Catalog, CatalogEvent, CatalogMarket, LivePriceMap, NewsData } from "./lib/types";
import { fetchCatalog, fetchLivePrices, fetchNews } from "./lib/api";
import { catalogStats, fmtVolume } from "./lib/analytics";
import { loadWatchlist, persist } from "./lib/watchlist";
import { loadBets, persistBets } from "./lib/bets";
import WorldMap from "./components/WorldMap";
import CatalogPanel from "./components/CatalogPanel";
import EventDetail from "./components/EventDetail";
import WatchlistPanel from "./components/WatchlistPanel";
import BetsPanel from "./components/BetsPanel";
import MarketsPage from "./components/MarketsPage";
import EventPage from "./components/EventPage";

const LIVE_REFRESH_MS = 60_000;

type Route = { page: "map" } | { page: "markets" } | { page: "event"; id: string };

function parseRoute(): Route {
  const h = window.location.hash;
  if (h.startsWith("#/event/")) return { page: "event", id: decodeURIComponent(h.slice(8)) };
  if (h.startsWith("#/markets")) return { page: "markets" };
  return { page: "map" };
}

export default function App() {
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [news, setNews] = useState<NewsData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [live, setLive] = useState<LivePriceMap>(new Map());
  const [lastLiveAt, setLastLiveAt] = useState<number | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [watchlist, setWatchlist] = useState<string[]>(() => loadWatchlist());
  const [bets, setBets] = useState<Bet[]>(() => loadBets());
  const [selectedId, setSelectedId] = useState<string | null>(
    () => new URLSearchParams(window.location.search).get("e"),
  );
  const [regionFilter, setRegionFilter] = useState<string | null>(null);
  const [route, setRoute] = useState<Route>(() => parseRoute());
  const [railTab, setRailTab] = useState<"watch" | "bets">("watch");

  useEffect(() => {
    fetchCatalog().then(setCatalog).catch((e) => setError(String(e)));
    fetchNews().then(setNews);
  }, []);

  useEffect(() => {
    const onHash = () => setRoute(parseRoute());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  // keep selected event in the URL so map views are deep-linkable
  useEffect(() => {
    const url = new URL(window.location.href);
    if (selectedId) url.searchParams.set("e", selectedId);
    else url.searchParams.delete("e");
    window.history.replaceState(null, "", url.toString());
  }, [selectedId]);

  const watchSet = useMemo(() => new Set(watchlist), [watchlist]);

  const toggleWatch = useCallback((id: string) => {
    setWatchlist((prev) => {
      const next = prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id];
      persist(next);
      return next;
    });
  }, []);

  const addBet = useCallback((bet: Bet) => {
    setBets((prev) => {
      const next = [...prev, bet];
      persistBets(next);
      return next;
    });
    setRailTab("bets");
  }, []);

  const removeBet = useCallback((id: string) => {
    setBets((prev) => {
      const next = prev.filter((b) => b.id !== id);
      persistBets(next);
      return next;
    });
  }, []);

  const importBetList = useCallback((incoming: Bet[]) => {
    setBets((prev) => {
      const have = new Set(prev.map((b) => b.id));
      const next = [...prev, ...incoming.filter((b) => !have.has(b.id))];
      persistBets(next);
      return next;
    });
  }, []);

  const betEventIds = useMemo(
    () => new Set(bets.map((b) => b.eventId).filter(Boolean)),
    [bets],
  );

  /** market id → market + owning event, for bet P&L lookups */
  const marketIndex = useMemo(() => {
    const idx = new Map<string, { market: CatalogMarket; event: CatalogEvent }>();
    for (const ev of catalog?.events ?? [])
      for (const m of ev.markets) idx.set(m.id, { market: m, event: ev });
    return idx;
  }, [catalog]);

  // ── Live price refresh: watchlist + selection + bet events + open page ─────
  const liveTargets = useMemo(() => {
    const ids = new Set(watchlist);
    if (selectedId) ids.add(selectedId);
    for (const id of betEventIds) ids.add(id);
    if (route.page === "event" && !route.id.startsWith("group:")) ids.add(route.id);
    return [...ids];
  }, [watchlist, selectedId, betEventIds, route]);
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
  }, [liveTargets.join(","), refreshLive]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Derived ─────────────────────────────────────────────────────────────────
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

  const goEvent = (id: string) => {
    setSelectedId(id);
    if (route.page !== "map") window.location.hash = `#/event/${id}`;
  };

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
          <nav className="nav">
            <a href="#/" className={route.page === "map" ? "on" : ""}>Dashboard</a>
            <a href="#/markets" className={route.page !== "map" ? "on" : ""}>Markets</a>
          </nav>
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

      {route.page === "markets" && (
        <MarketsPage
          catalog={catalog}
          live={live}
          watchlist={watchSet}
          news={news}
          onToggleWatch={toggleWatch}
        />
      )}

      {route.page === "event" && (
        <EventPage
          id={route.id}
          catalog={catalog}
          live={live}
          news={news}
          onAddBet={addBet}
        />
      )}

      {route.page === "map" && (
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
              countries={catalog.countries}
              selectedRegion={regionFilter}
              onSelectRegion={setRegionFilter}
              focusEvent={selected}
              onClearFocus={() => setSelectedId(null)}
              watchlist={watchSet}
              betEventIds={betEventIds}
            />
            {selected ? (
              <EventDetail event={selected} live={live} onAddBet={addBet} showFullViewLink />
            ) : (
              <div className="detail-placeholder">
                Select an event from the catalog to see its deadline ladder,
                implied daily hazard rates, and price paths — the map will pan
                to its location.
              </div>
            )}
          </div>
          <div className="rail">
            <div className="toggle rail-tabs">
              <button className={railTab === "watch" ? "on" : ""} onClick={() => setRailTab("watch")}>
                ★ Watchlist
              </button>
              <button className={railTab === "bets" ? "on" : ""} onClick={() => setRailTab("bets")}>
                $ Bets{bets.length ? ` (${bets.length})` : ""}
              </button>
            </div>
            {railTab === "watch" ? (
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
            ) : (
              <BetsPanel
                bets={bets}
                marketIndex={marketIndex}
                live={live}
                onRemove={removeBet}
                onImport={importBetList}
                onSelectEvent={goEvent}
              />
            )}
          </div>
        </main>
      )}

      <footer className="footer">
        Data: Polymarket Gamma + CLOB APIs · news: whitelisted RSS
        {news && ` (${news.sources.join(", ")})`} · snapshot {catalog.generatedAt} ·
        implied daily = cumulative YES% ÷ days to deadline · bets stay in this browser ·
        not investment advice
      </footer>
    </div>
  );
}
