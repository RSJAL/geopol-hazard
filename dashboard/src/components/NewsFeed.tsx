import { useMemo } from "react";
import type { NewsArticle } from "../lib/types";

function timeAgo(iso: string | null): string {
  if (!iso) return "";
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 60) return `${Math.max(1, mins)}m`;
  if (mins < 60 * 24) return `${Math.round(mins / 60)}h`;
  return `${Math.round(mins / 1440)}d`;
}

export function sentimentBadge(s: number) {
  if (s <= -0.15) return <span className="sent sent-hot" title={`escalation score ${s}`}>🔥 hot</span>;
  if (s >= 0.15) return <span className="sent sent-cool" title={`escalation score ${s}`}>❄ cool</span>;
  return <span className="sent sent-neutral" title={`escalation score ${s}`}>· neutral</span>;
}

export default function NewsFeed({
  articles,
  limit = 30,
}: {
  articles: NewsArticle[];
  limit?: number;
}) {
  const shown = articles.slice(0, limit);
  if (!shown.length)
    return <div className="empty">No matching articles in the current feed.</div>;
  return (
    <div className="news-list">
      {shown.map((a) => (
        <a key={a.id} className="news-row" href={a.url} target="_blank" rel="noreferrer">
          <div className="news-main">
            <div className="news-title">{a.title}</div>
            <div className="news-meta">
              {a.source} · {timeAgo(a.publishedAt)} ago
            </div>
          </div>
          {sentimentBadge(a.sentiment)}
        </a>
      ))}
    </div>
  );
}

/** Aggregate escalation sentiment per day, charted as bars (hot below zero).
 *  Clicking a day filters the article list to that day (click again to clear). */
export function SentimentChart({
  articles,
  selectedDay = null,
  onSelectDay,
}: {
  articles: NewsArticle[];
  selectedDay?: string | null;
  onSelectDay?: (day: string | null) => void;
}) {
  const days = useMemo(() => {
    const byDay = new Map<string, number[]>();
    for (const a of articles) {
      if (!a.publishedAt) continue;
      const day = a.publishedAt.slice(0, 10);
      (byDay.get(day) ?? byDay.set(day, []).get(day)!).push(a.sentiment);
    }
    return [...byDay.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([day, vals]) => ({
        day,
        mean: vals.reduce((s, v) => s + v, 0) / vals.length,
        n: vals.length,
      }));
  }, [articles]);

  if (days.length < 2) return null;

  const CW = 640, CH = 150, pad = 24;
  const slot = (CW - 2 * pad) / days.length;
  const bw = Math.min(46, slot - 4);
  const mid = (CH - 14) / 2;
  const labelEvery = Math.ceil(days.length / 12); // avoid crowded x labels

  return (
    <div className="sentiment-chart">
      <div className="panel-sub" style={{ marginBottom: 4 }}>
        Aggregate escalation sentiment by day — <span className="down">below = hot</span>,{" "}
        <span className="up">above = cool</span>
        {onSelectDay && " · click a day to filter articles"}
      </div>
      <svg viewBox={`0 0 ${CW} ${CH}`}>
        <line x1={pad} x2={CW - pad} y1={mid} y2={mid} className="grid-line" />
        {days.map((d, i) => {
          const x = pad + slot * (i + 0.5);
          const h = Math.abs(d.mean) * (mid - 14);
          const hot = d.mean < 0;
          const sel = d.day === selectedDay;
          return (
            <g
              key={d.day}
              className={onSelectDay ? "sent-day" : undefined}
              onClick={() => onSelectDay?.(sel ? null : d.day)}
            >
              <title>{`${d.day}: ${d.mean.toFixed(2)} (${d.n} article${d.n > 1 ? "s" : ""})`}</title>
              {/* full-height hit area so thin bars are easy to click */}
              <rect x={x - slot / 2} y={0} width={slot} height={CH - 12} fill="transparent" />
              {sel && (
                <rect x={x - slot / 2 + 1} y={2} width={slot - 2} height={CH - 16}
                      className="sent-day-sel" />
              )}
              <rect
                x={x - bw / 2}
                y={hot ? mid : mid - h}
                width={bw}
                height={Math.max(1.5, h)}
                className={hot ? "sent-bar-hot" : "sent-bar-cool"}
              />
              {i % labelEvery === 0 && (
                <text x={x} y={CH - 3} className="tick tick-x">
                  {d.day.slice(5)}
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
