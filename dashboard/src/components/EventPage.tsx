import { useMemo } from "react";
import type { Bet, Catalog, CatalogEvent, LivePriceMap, NewsData } from "../lib/types";
import { buildGroups } from "../lib/grouping";
import EventDetail from "./EventDetail";
import NewsFeed, { SentimentChart } from "./NewsFeed";

interface Props {
  id: string; // catalog event id, or "group:<key>" for a merged ladder
  catalog: Catalog;
  live: LivePriceMap;
  news: NewsData | null;
  onAddBet: (bet: Bet) => void;
}

export default function EventPage({ id, catalog, live, news, onAddBet }: Props) {
  const { event, memberIds } = useMemo((): {
    event: CatalogEvent | null;
    memberIds: Set<string>;
  } => {
    if (id.startsWith("group:")) {
      const key = id.slice(6);
      const group = buildGroups(catalog.events).find((g) => g.key === key);
      if (group?.merged)
        return { event: group.merged, memberIds: new Set(group.events.map((e) => e.id)) };
      return { event: null, memberIds: new Set() };
    }
    const ev = catalog.events.find((e) => e.id === id) ?? null;
    return { event: ev, memberIds: new Set(ev ? [ev.id] : []) };
  }, [id, catalog]);

  const articles = useMemo(() => {
    if (!news || !event) return [];
    const direct = news.articles.filter((a) => a.eventIds.some((x) => memberIds.has(x)));
    if (direct.length >= 5 || !event.region) return direct;
    // thin direct coverage — pad with articles about the event's region
    const seen = new Set(direct.map((a) => a.id));
    const regional = news.articles.filter(
      (a) => !seen.has(a.id) && a.regions.includes(event.region!),
    );
    return [...direct, ...regional];
  }, [news, event, memberIds]);

  if (!event) {
    return (
      <div className="detail-placeholder">
        Event not found — it may have closed and left the catalog.{" "}
        <a href="#/">← back to dashboard</a>
      </div>
    );
  }

  return (
    <div className="event-page">
      <a className="back-link" href="#/markets">← markets</a>
      <div className="event-page-grid">
        <div className="event-page-main">
          <EventDetail event={event} live={live} onAddBet={onAddBet} />
        </div>
        <div className="event-page-side">
          <div className="detail-panel">
            <div className="panel-head">
              <span className="panel-title">📰 News</span>
              <span className="panel-sub">
                {articles.length} articles
                {news && ` · feed ${new Date(news.generatedAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`}
              </span>
            </div>
            <SentimentChart articles={articles} />
            <NewsFeed articles={articles} limit={25} />
          </div>
        </div>
      </div>
    </div>
  );
}
