import type { NewsArticle, NewsData } from "./types";

/**
 * Articles for an event (or group of member events): direct eventId matches
 * first; when there are fewer than `min`, pad with articles about the event's
 * region. Shared by the event drill-down page and the map-rail mini feed.
 */
export function relatedArticles(
  news: NewsData | null,
  memberIds: Set<string>,
  region: string | null,
  min: number,
): NewsArticle[] {
  if (!news) return [];
  const direct = news.articles.filter((a) => a.eventIds.some((id) => memberIds.has(id)));
  if (direct.length >= min || !region) return direct;
  const seen = new Set(direct.map((a) => a.id));
  const regional = news.articles.filter(
    (a) => !seen.has(a.id) && a.regions.includes(region),
  );
  return [...direct, ...regional];
}
