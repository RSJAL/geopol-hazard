import { useEffect, useMemo, useState } from "react";
import type { Bet, Catalog, CatalogEvent, LivePriceMap, NewsData } from "../lib/types";
import { buildGroups } from "../lib/grouping";
import { relatedArticles } from "../lib/news";
import EventDetail from "./EventDetail";
import NewsFeed, { SentimentChart } from "./NewsFeed";

interface Props {
  id: string; // catalog event id, or "group:<key>" for a merged ladder
  catalog: Catalog;
  live: LivePriceMap;
  news: NewsData | null;
  bets: Bet[];
  onAddBet: (bet: Bet) => void;
}

export default function EventPage({ id, catalog, live, news, bets, onAddBet }: Props) {
  const [newsDay, setNewsDay] = useState<string | null>(null);
  useEffect(() => setNewsDay(null), [id]);
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

  const articles = useMemo(
    () => (event ? relatedArticles(news, memberIds, event.region, 5) : []),
    [news, event, memberIds],
  );

  const dayArticles = useMemo(
    () =>
      newsDay
        ? articles.filter((a) => a.publishedAt?.slice(0, 10) === newsDay)
        : articles,
    [articles, newsDay],
  );

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
      <a className="back-link" href="#/markets">← Markets</a>
      <div className="event-page-grid">
        <div className="event-page-main">
          <EventDetail event={event} live={live} onAddBet={onAddBet} bets={bets} />
        </div>
        <div className="event-page-side">
          <div className="detail-panel">
            <div className="panel-head">
              <span className="panel-title">📰 News</span>
              <span className="panel-sub">
                {newsDay ? (
                  <button className="chip chip-active" onClick={() => setNewsDay(null)}>
                    ✕ {newsDay} · {dayArticles.length} article{dayArticles.length !== 1 ? "s" : ""}
                  </button>
                ) : (
                  <>
                    {articles.length} articles
                    {news && ` · feed ${new Date(news.generatedAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`}
                  </>
                )}
              </span>
            </div>
            <SentimentChart articles={articles} selectedDay={newsDay} onSelectDay={setNewsDay} />
            <NewsFeed articles={dayArticles} limit={newsDay ? 100 : 25} />
          </div>
        </div>
      </div>
    </div>
  );
}
