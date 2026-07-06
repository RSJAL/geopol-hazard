import { useEffect, useMemo, useState } from "react";
import type { Bet, Catalog, CatalogEvent, LivePriceMap, NewsData, NewsSourceType } from "../lib/types";
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
  /** page the user navigated here from — the back button returns there */
  from?: "map" | "markets" | "portfolio";
}

const TYPE_LABEL: Record<NewsSourceType, string> = {
  press: "Press", osint: "OSINT", breaking: "Breaking",
};

type SentBucket = "hot" | "neutral" | "cool";
// thresholds mirror NewsFeed's sentiment badge
const sentBucket = (s: number): SentBucket =>
  s <= -0.15 ? "hot" : s >= 0.15 ? "cool" : "neutral";
const SENT_LABEL: Record<SentBucket, string> = {
  hot: "🔥 Hot", neutral: "· Neutral", cool: "❄ Cool",
};

export default function EventPage({ id, catalog, live, news, bets, onAddBet, from }: Props) {
  const [newsDay, setNewsDay] = useState<string | null>(null);
  const [newsType, setNewsType] = useState<NewsSourceType | null>(null); // null = all
  const [newsSent, setNewsSent] = useState<SentBucket | null>(null); // null = all
  useEffect(() => { setNewsDay(null); setNewsType(null); setNewsSent(null); }, [id]);
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

  const allArticles = useMemo(
    () => (event ? relatedArticles(news, memberIds, event.region, 5) : []),
    [news, event, memberIds],
  );

  /** source types present — the filter row only renders when there's a mix */
  const typesPresent = useMemo(
    () => new Set(allArticles.map((a) => a.sourceType ?? "press")),
    [allArticles],
  );

  const articles = useMemo(
    () =>
      allArticles.filter(
        (a) =>
          (!newsType || (a.sourceType ?? "press") === newsType) &&
          (!newsSent || sentBucket(a.sentiment) === newsSent),
      ),
    [allArticles, newsType, newsSent],
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

  // return to wherever the user came from (V0.154) — default Markets
  const backHref = from === "map" ? "#/" : from === "portfolio" ? "#/portfolio" : "#/markets";
  const backLabel = from === "map" ? "← Dashboard" : from === "portfolio" ? "← Portfolio" : "← Markets";
  const regionName = event.region
    ? catalog.regions.find((r) => r.id === event.region)?.name ?? event.region
    : null;

  return (
    <div className="event-page">
      <a className="back-link" href={backHref}>{backLabel}</a>
      <div className="event-page-grid">
        <div className="event-page-main">
          <EventDetail event={event} live={live} onAddBet={onAddBet} bets={bets} regionName={regionName} />
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
            {allArticles.length > 0 && (
              <div className="news-type-row">
                <button
                  className={`chip${newsType === null && newsSent === null ? " chip-active" : ""}`}
                  onClick={() => { setNewsType(null); setNewsSent(null); }}
                >
                  All
                </button>
                {typesPresent.size > 1 &&
                  (["press", "osint", "breaking"] as NewsSourceType[])
                    .filter((t) => typesPresent.has(t))
                    .map((t) => (
                      <button
                        key={t}
                        className={`chip${newsType === t ? " chip-active" : ""}`}
                        onClick={() => setNewsType(newsType === t ? null : t)}
                      >
                        {TYPE_LABEL[t]}
                      </button>
                    ))}
                <span className="chip-sep" />
                {(["hot", "neutral", "cool"] as SentBucket[]).map((s) => (
                  <button
                    key={s}
                    className={`chip${newsSent === s ? " chip-active" : ""}`}
                    title="Filter by escalation sentiment"
                    onClick={() => setNewsSent(newsSent === s ? null : s)}
                  >
                    {SENT_LABEL[s]}
                  </button>
                ))}
              </div>
            )}
            <SentimentChart articles={articles} selectedDay={newsDay} onSelectDay={setNewsDay} />
            <NewsFeed articles={dayArticles} limit={newsDay ? 100 : 25} />
          </div>
        </div>
      </div>
    </div>
  );
}
