import { useState } from "react";
import type { CatalogEvent, LivePriceMap } from "../lib/types";
import { headlineMarket, liveYes } from "../lib/analytics";
import { shareUrl } from "../lib/watchlist";

interface Props {
  events: CatalogEvent[]; // watchlisted, in list order
  live: LivePriceMap;
  lastLiveAt: number | null;
  refreshing: boolean;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onRemove: (id: string) => void;
  onRefresh: () => void;
}

export default function WatchlistPanel({
  events, live, lastLiveAt, refreshing, selectedId, onSelect, onRemove, onRefresh,
}: Props) {
  const [copied, setCopied] = useState(false);

  const copyShare = () => {
    navigator.clipboard
      .writeText(shareUrl(events.map((e) => e.id)))
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      })
      .catch(() => {});
  };

  return (
    <div className="watch-panel">
      <div className="panel-head">
        <span className="panel-title">★ Watchlist</span>
        <span className="panel-sub">
          {lastLiveAt
            ? `live ${Math.max(0, Math.round((Date.now() - lastLiveAt) / 1000))}s ago`
            : "snapshot prices"}
        </span>
      </div>

      <div className="watch-actions">
        <button className="btn" onClick={onRefresh} disabled={refreshing || !events.length}>
          {refreshing ? "⟳ refreshing…" : "⟳ refresh prices"}
        </button>
        <button className="btn" onClick={copyShare} disabled={!events.length}>
          {copied ? "✓ copied" : "🔗 share"}
        </button>
      </div>

      <div className="watch-list">
        {events.map((ev) => {
          const hm = headlineMarket(ev);
          const yes = liveYes(hm, live);
          const lp = live.get(hm.id);
          const chg = (lp?.change24h ?? hm.change24h ?? 0) * 100;
          return (
            <div
              key={ev.id}
              className={`watch-row${selectedId === ev.id ? " selected" : ""}`}
              onClick={() => onSelect(ev.id)}
            >
              <div className="row-main">
                <div className="row-title">{ev.title}</div>
                <div className="row-meta">{ev.category}{lp ? " · live" : ""}</div>
              </div>
              <div className="row-price">
                <div className="row-yes">{yes.toFixed(1)}%</div>
                {chg !== 0 && (
                  <div className={`row-chg ${chg > 0 ? "up" : "down"}`}>
                    {chg > 0 ? "▲" : "▼"} {Math.abs(chg).toFixed(1)}
                  </div>
                )}
              </div>
              <button
                className="star on"
                title="Remove"
                onClick={(e) => { e.stopPropagation(); onRemove(ev.id); }}
              >
                ★
              </button>
            </div>
          );
        })}
        {!events.length && (
          <div className="empty">
            Star events in the catalog to track them here with live prices.
          </div>
        )}
      </div>
    </div>
  );
}
