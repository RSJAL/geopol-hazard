import { useEffect, useMemo, useRef, useState } from "react";
import type { Catalog, CatalogEvent, LivePriceMap, NewsData } from "../lib/types";
import { buildLadder, fmtVolume, liveYes, headlineMarket } from "../lib/analytics";
import { buildGroups, memberLabel, type EventGroup } from "../lib/grouping";

interface Props {
  catalog: Catalog;
  live: LivePriceMap;
  watchlist: Set<string>;
  news: NewsData | null;
  onToggleWatch: (id: string) => void;
}

/** Combobox for adding whole market groups to the watchlist. */
function AddToWatchlist({
  groups, watchlist, onToggleWatch,
}: {
  groups: EventGroup[];
  watchlist: Set<string>;
  onToggleWatch: (id: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [hl, setHl] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  const candidates = useMemo(() => {
    const q = query.trim().toLowerCase();
    return groups
      .filter((g) => !g.events.some((e) => watchlist.has(e.id)))
      .filter((g) => !q || g.title.toLowerCase().includes(q))
      .slice(0, 50);
  }, [groups, watchlist, query]);

  // keep the keyboard-highlighted row visible in the scrollable list
  useEffect(() => {
    listRef.current?.children[hl]?.scrollIntoView({ block: "nearest" });
  }, [hl]);

  const add = (g: EventGroup) => {
    g.events.forEach((e) => { if (!watchlist.has(e.id)) onToggleWatch(e.id); });
    setQuery("");
    setOpen(false);
    setHl(0);
  };

  return (
    <div className="combo">
      <input
        className="search watch-add"
        placeholder="＋ add market to watchlist…"
        value={query}
        onChange={(e) => { setQuery(e.target.value); setOpen(true); setHl(0); }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setOpen(true);
            setHl((h) => Math.min(h + 1, candidates.length - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setHl((h) => Math.max(h - 1, 0));
          } else if (e.key === "Enter" && open && candidates[hl]) {
            add(candidates[hl]);
          } else if (e.key === "Escape") {
            setOpen(false);
          }
        }}
      />
      {open && candidates.length > 0 && (
        <div className="combo-list" ref={listRef}>
          {candidates.map((g, i) => (
            <div
              key={g.key}
              className={`combo-item${i === hl ? " hl" : ""}`}
              // mousedown (not click) so the input's blur doesn't close us first
              onMouseDown={(e) => { e.preventDefault(); add(g); }}
              onMouseEnter={() => setHl(i)}
            >
              <span className="combo-title">{g.title}</span>
              <span className="combo-meta">
                {fmtVolume(g.events.reduce((s, e) => s + e.volume, 0))}
                {g.events.length > 1 && ` · ${g.events.length} horizons`}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function MiniLadder({ ev, live }: { ev: CatalogEvent; live: LivePriceMap }) {
  if (ev.type === "horizon") {
    const rows = buildLadder(ev, live);
    const maxImpl = Math.max(...rows.map((r) => r.implDaily), 1e-9);
    return (
      <table className="ladder mini">
        <thead>
          <tr>
            <th>Deadline</th><th className="num">YES</th>
            <th className="num">Impl/d</th>
            <th className="viz"></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.endDate}>
              <td>{r.label}</td>
              <td className="num">{r.yes.toFixed(1)}%</td>
              <td className={`num${r.isPeak ? " peak" : r.isInversion ? " inv" : ""}`}>
                {r.implDaily.toFixed(3)}%
              </td>
              <td className="viz">
                <div
                  className={`bar${r.isPeak ? " bar-peak" : r.isInversion ? " bar-inv" : ""}`}
                  style={{ width: `${Math.max(2, (r.implDaily / maxImpl) * 100)}%` }}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    );
  }
  const top = [...ev.markets].sort((a, b) => liveYes(b, live) - liveYes(a, live)).slice(0, 4);
  return (
    <div className="buckets">
      {top.map((m) => {
        const yes = liveYes(m, live);
        return (
          <div className="bucket-row" key={m.id}>
            <span className="bucket-label">{m.groupItemTitle || m.question}</span>
            <div className="bucket-bar-wrap">
              <div className="bucket-bar" style={{ width: `${Math.max(1, yes)}%` }} />
            </div>
            <span className="bucket-val">{yes.toFixed(1)}%</span>
          </div>
        );
      })}
    </div>
  );
}

function GroupCard({
  group, live, news, watchlist, onToggleWatch,
}: {
  group: EventGroup;
  live: LivePriceMap;
  news: NewsData | null;
  watchlist: Set<string>;
  onToggleWatch: (id: string) => void;
}) {
  // tab: "all" (merged cross-event ladder) or a member event id
  const [tab, setTab] = useState<string>(group.merged ? "all" : group.events[0].id);
  const current: CatalogEvent =
    tab === "all" && group.merged
      ? group.merged
      : group.events.find((e) => e.id === tab) ?? group.events[0];

  const memberIds = new Set(group.events.map((e) => e.id));
  const newsCount = news?.articles.filter((a) => a.eventIds.some((id) => memberIds.has(id))).length ?? 0;

  const hm = headlineMarket(current);
  const chg = (live.get(hm.id)?.change24h ?? hm.change24h ?? 0) * 100;
  const watched = group.events.some((e) => watchlist.has(e.id));

  return (
    <div
      className="group-card"
      onClick={() => { window.location.hash = `#/event/${current.id}`; }}
    >
      <div className="group-head">
        <div className="group-title-wrap">
          <button
            className={`star${watched ? " on" : ""}`}
            title={watched ? "Remove from watchlist" : "Add to watchlist"}
            onClick={(e) => {
              e.stopPropagation();
              group.events.forEach((ev) =>
                (watched ? watchlist.has(ev.id) : true) && onToggleWatch(ev.id));
            }}
          >
            {watched ? "★" : "☆"}
          </button>
          <span className="group-title">{group.title}</span>
          {chg !== 0 && (
            <span className={`row-chg ${chg > 0 ? "up" : "down"}`}>
              {chg > 0 ? "▲" : "▼"}{Math.abs(chg).toFixed(1)}
            </span>
          )}
        </div>
        <div className="group-meta">
          {current.category} · {fmtVolume(group.events.reduce((s, e) => s + e.volume, 0))}
          {newsCount > 0 && <> · 📰 {newsCount}</>}
        </div>
      </div>

      {(group.events.length > 1) && (
        <div className="toggle group-tabs" onClick={(e) => e.stopPropagation()}>
          {group.merged && (
            <button className={tab === "all" ? "on" : ""} onClick={() => setTab("all")}>
              all horizons
            </button>
          )}
          {group.events.map((e) => (
            <button key={e.id} className={tab === e.id ? "on" : ""} onClick={() => setTab(e.id)}>
              {memberLabel(e)}
            </button>
          ))}
        </div>
      )}

      <MiniLadder ev={current} live={live} />
    </div>
  );
}

export default function MarketsPage({ catalog, live, watchlist, news, onToggleWatch }: Props) {
  const [showAll, setShowAll] = useState(false);

  const groups = useMemo(() => buildGroups(catalog.events), [catalog]);
  const tracked = groups.filter((g) => g.events.some((e) => watchlist.has(e.id)));
  const shown = showAll || !tracked.length ? groups.slice(0, 30) : tracked;

  return (
    <div className="markets-page">
      <div className="markets-head">
        <div>
          <span className="panel-title">Market View</span>
          <span className="panel-sub" style={{ marginLeft: 10 }}>
            {tracked.length
              ? `${tracked.length} tracked group${tracked.length > 1 ? "s" : ""}`
              : "no watchlist yet — showing top markets by volume"}
          </span>
        </div>
        <div className="markets-tools">
          <AddToWatchlist groups={groups} watchlist={watchlist} onToggleWatch={onToggleWatch} />
          {tracked.length > 0 && (
            <label className="check">
              <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} />
              show all markets
            </label>
          )}
        </div>
      </div>
      <div className="markets-grid">
        {shown.map((g) => (
          <GroupCard
            key={g.key}
            group={g}
            live={live}
            news={news}
            watchlist={watchlist}
            onToggleWatch={onToggleWatch}
          />
        ))}
      </div>
    </div>
  );
}
