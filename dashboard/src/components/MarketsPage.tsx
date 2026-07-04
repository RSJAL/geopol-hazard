import { useEffect, useMemo, useRef, useState } from "react";
import type { Bet, Catalog, CatalogEvent, CatalogMarket, LivePriceMap, NewsData, PricePoint } from "../lib/types";
import { buildLadder, deadlineLabel, fmtVolume, liveYes, headlineMarket } from "../lib/analytics";
import { betPnl } from "../lib/bets";
import { buildGroups, memberLabel, type EventGroup } from "../lib/grouping";
import { fetchPriceHistory, type HistoryInterval } from "../lib/api";
import PriceChart, { type Series } from "./PriceChart";

const COMPARE_COLORS = ["#4fc3f7", "#ffa726", "#66bb6a"];
const COMPARE_MAX = 3;

type MarketsView = "watch" | "bets" | "all";

interface Props {
  catalog: Catalog;
  live: LivePriceMap;
  watchlist: Set<string>;
  bets: Bet[];
  news: NewsData | null;
  onToggleWatch: (id: string) => void;
}

/** Compact strip showing a logged bet on a group card (also used by BrowsePage). */
export function BetStrip({ bet, market, live }: { bet: Bet; market: CatalogMarket | undefined; live: LivePriceMap }) {
  const pnl = betPnl(bet, market, live);
  const up = pnl.pnl >= 0;
  return (
    <div className="bet-strip" onClick={(e) => e.stopPropagation()}>
      <span className={`side-badge ${bet.side === "YES" ? "side-yes" : "side-no"}`}>{bet.side}</span>
      <span className="muted">{bet.shares} @ {bet.entryPrice.toFixed(1)}¢</span>
      <span className="strip-cur">now {pnl.currentPrice.toFixed(1)}¢</span>
      <b className={up ? "up" : "down"}>
        {up ? "+" : "−"}${Math.abs(pnl.pnl).toFixed(2)} ({pnl.pnlPct >= 0 ? "+" : ""}
        {pnl.pnlPct.toFixed(1)}%)
      </b>
    </div>
  );
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

/** Uniform YES / NO / Volume table for every event type on group tiles. */
function MiniLadder({ ev, live }: { ev: CatalogEvent; live: LivePriceMap }) {
  const rows =
    ev.type === "horizon"
      ? buildLadder(ev, live).map((r) => ({ key: r.endDate, label: r.label, market: r.market }))
      : ev.type === "categorical"
        ? [...ev.markets]
            .sort((a, b) => liveYes(b, live) - liveYes(a, live))
            .slice(0, 4)
            .map((m) => ({ key: m.id, label: m.groupItemTitle || m.question, market: m }))
        : ev.markets.map((m) => ({ key: m.id, label: deadlineLabel(m.endDate), market: m }));
  return (
    <table className="ladder mini">
      <thead>
        <tr>
          <th>{ev.type === "categorical" ? "Outcome" : "Deadline"}</th>
          <th className="num">YES</th>
          <th className="num">NO</th>
          <th className="num">Volume</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(({ key, label, market }) => {
          const yes = liveYes(market, live);
          return (
            <tr key={key}>
              <td className="mini-label">{label}</td>
              <td className="num">{yes.toFixed(1)}%</td>
              <td className="num">{(100 - yes).toFixed(1)}%</td>
              <td className="num">{fmtVolume(market.volume)}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
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
  group, live, news, watchlist, bets, comparing, onToggleWatch, onToggleCompare,
}: {
  group: EventGroup;
  live: LivePriceMap;
  news: NewsData | null;
  watchlist: Set<string>;
  bets?: Bet[];
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

      {bets?.map((b) => (
        <BetStrip
          key={b.id}
          bet={b}
          market={group.events.flatMap((e) => e.markets).find((m) => m.id === b.marketId)}
          live={live}
        />
      ))}
    </div>
  );
}

export default function MarketsPage({ catalog, live, watchlist, bets, news, onToggleWatch }: Props) {
  const [viewChoice, setViewChoice] = useState<MarketsView | null>(null);
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

  /** group key → bets placed on any of the group's markets */
  const groupBets = useMemo(() => {
    const m = new Map<string, Bet[]>();
    for (const g of groups) {
      const marketIds = new Set(g.events.flatMap((e) => e.markets.map((mk) => mk.id)));
      const bs = bets.filter((b) => marketIds.has(b.marketId));
      if (bs.length) m.set(g.key, bs);
    }
    return m;
  }, [groups, bets]);

  const view: MarketsView = viewChoice ?? (tracked.length ? "watch" : "all");
  const shown =
    view === "watch" ? tracked
    : view === "bets" ? groups.filter((g) => groupBets.has(g.key))
    : groups.slice(0, 30);

  const compareGroups = compare
    .map((k) => groups.find((g) => g.key === k))
    .filter((g): g is EventGroup => !!g);

  return (
    <div className="markets-page">
      <div className="markets-head">
        <div>
          <span className="panel-title">Market View</span>
          <span className="panel-sub" style={{ marginLeft: 10 }}>
            {view === "watch"
              ? `${tracked.length} tracked group${tracked.length === 1 ? "" : "s"}`
              : view === "bets"
                ? `${shown.length} market group${shown.length === 1 ? "" : "s"} with open bets`
                : "top markets by volume"}
          </span>
        </div>
        <div className="markets-tools">
          <AddToWatchlist groups={groups} watchlist={watchlist} onToggleWatch={onToggleWatch} />
          <div className="toggle">
            <button className={view === "watch" ? "on" : ""} onClick={() => setViewChoice("watch")}>
              ★ watchlist
            </button>
            <button className={view === "bets" ? "on" : ""} onClick={() => setViewChoice("bets")}>
              $ bets{groupBets.size ? ` (${groupBets.size})` : ""}
            </button>
            <button className={view === "all" ? "on" : ""} onClick={() => setViewChoice("all")}>
              all markets
            </button>
          </div>
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
            bets={view === "bets" ? groupBets.get(g.key) : undefined}
            comparing={compare.includes(g.key)}
            onToggleWatch={onToggleWatch}
            onToggleCompare={() => toggleCompare(g.key)}
          />
        ))}
        {!shown.length && (
          <div className="empty">
            {view === "bets"
              ? "No open bets yet — log one from any market's $ button."
              : "Nothing to show — star some markets or switch to all markets."}
          </div>
        )}
      </div>
    </div>
  );
}
