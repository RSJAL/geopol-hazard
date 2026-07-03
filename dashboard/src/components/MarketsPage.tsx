import { useEffect, useMemo, useRef, useState } from "react";
import type { Catalog, CatalogEvent, LivePriceMap, NewsData, PricePoint } from "../lib/types";
import { buildLadder, fmtVolume, liveYes, headlineMarket } from "../lib/analytics";
import { buildGroups, memberLabel, type EventGroup } from "../lib/grouping";
import { fetchPriceHistory, type HistoryInterval } from "../lib/api";
import PriceChart, { type Series } from "./PriceChart";

const COMPARE_COLORS = ["#4fc3f7", "#ffa726", "#66bb6a"];
const COMPARE_MAX = 3;

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
            <th className="num" title="Implied daily odds: 1 − (1−P)^(1/days)">Daily</th>
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

/** Side-by-side comparison of selected market groups with overlaid prices. */
function CompareView({
  groups, live, onRemove,
}: {
  groups: EventGroup[];
  live: LivePriceMap;
  onRemove: (key: string) => void;
}) {
  const [interval, setInterval_] = useState<HistoryInterval>("1m");
  const [series, setSeries] = useState<Series[] | null>(null);

  // each group is represented by its merged/highest-volume event's
  // nearest-deadline market
  const reps = useMemo(
    () =>
      groups.map((g) => {
        const ev = g.merged ?? g.events.reduce((a, b) => (b.volume > a.volume ? b : a));
        return { group: g, ev, market: headlineMarket(ev) };
      }),
    [groups],
  );

  useEffect(() => {
    let cancelled = false;
    setSeries(null);
    Promise.all(
      reps.map(async ({ group, market }, i): Promise<Series> => {
        let points: PricePoint[] = [];
        if (market.yesTokenId) {
          try {
            points = await fetchPriceHistory(market.yesTokenId, interval);
          } catch {
            /* leave an empty line */
          }
        }
        return {
          label: group.title.slice(0, 32),
          color: COMPARE_COLORS[i % COMPARE_COLORS.length],
          points,
        };
      }),
    ).then((s) => { if (!cancelled) setSeries(s); });
    return () => { cancelled = true; };
  }, [reps, interval]);

  return (
    <div className="compare-view">
      <div className="chart-head">
        <span className="panel-title">
          ⇄ Comparison <span className="muted">· nearest-deadline YES price</span>
        </span>
        <div className="toggle">
          {(["1w", "1m", "max"] as HistoryInterval[]).map((iv) => (
            <button key={iv} className={interval === iv ? "on" : ""} onClick={() => setInterval_(iv)}>
              {iv}
            </button>
          ))}
        </div>
      </div>
      {series === null
        ? <div className="chart-empty">Loading price history…</div>
        : <PriceChart series={series} />}
      <div className="compare-grid">
        {reps.map(({ group, ev, market }, i) => (
          <div key={group.key} className="compare-col">
            <div className="compare-col-head">
              <span style={{ color: COMPARE_COLORS[i % COMPARE_COLORS.length] }}>━</span>
              <a className="group-title" href={`#/event/${ev.id}`}>{group.title}</a>
              <button className="star" title="Remove from comparison" onClick={() => onRemove(group.key)}>
                ✕
              </button>
            </div>
            <div className="group-meta">
              {ev.category} · {fmtVolume(group.events.reduce((s, e) => s + e.volume, 0))}
              {" · YES "}{liveYes(market, live).toFixed(1)}%
            </div>
            <MiniLadder ev={ev} live={live} />
          </div>
        ))}
      </div>
    </div>
  );
}

function GroupCard({
  group, live, news, watchlist, comparing, onToggleWatch, onToggleCompare,
}: {
  group: EventGroup;
  live: LivePriceMap;
  news: NewsData | null;
  watchlist: Set<string>;
  comparing: boolean;
  onToggleWatch: (id: string) => void;
  onToggleCompare: () => void;
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
          <button
            className={`cmp-btn${comparing ? " on" : ""}`}
            title={comparing ? "Remove from comparison" : "Add to comparison"}
            onClick={(e) => { e.stopPropagation(); onToggleCompare(); }}
          >
            ⇄
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
  // compared group keys live in ?cmp= so comparisons are shareable links
  const [compare, setCompare] = useState<string[]>(() => {
    const p = new URLSearchParams(window.location.search).get("cmp");
    return p ? p.split("~").filter(Boolean).slice(0, COMPARE_MAX) : [];
  });

  useEffect(() => {
    const url = new URL(window.location.href);
    if (compare.length) url.searchParams.set("cmp", compare.join("~"));
    else url.searchParams.delete("cmp");
    window.history.replaceState(null, "", url.toString());
  }, [compare]);

  const toggleCompare = (key: string) =>
    setCompare((prev) =>
      prev.includes(key)
        ? prev.filter((k) => k !== key)
        : prev.length >= COMPARE_MAX
          ? prev
          : [...prev, key],
    );

  const groups = useMemo(() => buildGroups(catalog.events), [catalog]);
  const tracked = groups.filter((g) => g.events.some((e) => watchlist.has(e.id)));
  const shown = showAll || !tracked.length ? groups.slice(0, 30) : tracked;

  const compareGroups = compare
    .map((k) => groups.find((g) => g.key === k))
    .filter((g): g is EventGroup => !!g);

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

      {compareGroups.length >= 2 && (
        <CompareView groups={compareGroups} live={live} onRemove={toggleCompare} />
      )}
      {compareGroups.length === 1 && (
        <div className="compare-hint">
          ⇄ <b>{compareGroups[0].title}</b> selected — pick {COMPARE_MAX > 2 ? "1–2 more markets" : "one more market"} to
          compare, or <button className="link-btn" onClick={() => setCompare([])}>clear</button>.
        </div>
      )}

      <div className="markets-grid">
        {shown.map((g) => (
          <GroupCard
            key={g.key}
            group={g}
            live={live}
            news={news}
            watchlist={watchlist}
            comparing={compare.includes(g.key)}
            onToggleWatch={onToggleWatch}
            onToggleCompare={() => toggleCompare(g.key)}
          />
        ))}
      </div>
    </div>
  );
}
