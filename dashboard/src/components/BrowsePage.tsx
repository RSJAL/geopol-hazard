import { useEffect, useMemo, useState } from "react";
import type { Bet, Catalog, CatalogEvent, LivePriceMap } from "../lib/types";
import { anchorCountry, buildLadder, deadlineLabel, fmtVolume, liveYes } from "../lib/analytics";
import { isOpen } from "../lib/bets";
import { buildGroups, type EventGroup } from "../lib/grouping";
import { BetStrip } from "./BetStrip";

interface Props {
  catalog: Catalog;
  live: LivePriceMap;
  watchlist: Set<string>;
  bets: Bet[];
  onToggleWatch: (id: string) => void;
}

type SortKey = "volume" | "volume24h" | "move" | "endDate";
type Scope = "all" | "watch" | "bets";

const MAX_ROWS = 3;

/** ISO3 → ISO2 for flag emoji (covers the pipeline's COUNTRIES table). */
const ISO2: Record<string, string> = {
  TWN: "TW", UKR: "UA", RUS: "RU", IRN: "IR", ISR: "IL", LBN: "LB", SYR: "SY",
  TUR: "TR", CHN: "CN", PRK: "KP", KOR: "KR", JPN: "JP", IND: "IN", PAK: "PK",
  AFG: "AF", PHL: "PH", AUS: "AU", SAU: "SA", YEM: "YE", IRQ: "IQ", QAT: "QA",
  ARE: "AE", EGY: "EG", MAR: "MA", LBY: "LY", SDN: "SD", VEN: "VE", BRA: "BR",
  COL: "CO", ARG: "AR", CUB: "CU", MEX: "MX", PAN: "PA", USA: "US", CAN: "CA",
  GRL: "GL", GBR: "GB", FRA: "FR", DEU: "DE", POL: "PL", MDA: "MD", BLR: "BY",
  ARM: "AM", AZE: "AZ", GEO: "GE", ALB: "AL", SRB: "RS", NGA: "NG", ETH: "ET",
};

function flagEmoji(cid: string | null): string {
  const two = cid ? ISO2[cid] : undefined;
  if (!two) return "🌐";
  return String.fromCodePoint(...[...two].map((c) => 0x1f1e6 - 65 + c.charCodeAt(0)));
}

/** Kalshi-style payout multiplier for buying YES at `yes` percent. */
function multiplier(yes: number): string {
  if (yes <= 0) return "—";
  const x = 100 / yes;
  if (x >= 100) return `${Math.round(x)}x`;
  if (x >= 10) return `${x.toFixed(1)}x`;
  return `${x.toFixed(2)}x`;
}

/** Polymarket-style semicircular "% chance" gauge for single binary markets. */
function ChanceGauge({ pct }: { pct: number }) {
  const r = 24, cx = 30, cy = 32;
  const len = Math.PI * r;
  const color = pct >= 65 ? "var(--bw-green)" : pct >= 35 ? "var(--inv)" : "var(--bw-red)";
  const d = `M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`;
  return (
    <svg viewBox="0 0 60 44" className="chance-gauge" aria-label={`${pct.toFixed(0)}% chance`}>
      <path d={d} className="gauge-track" />
      <path d={d} className="gauge-arc" stroke={color}
            strokeDasharray={`${(Math.max(1, pct) / 100) * len} ${len}`} />
      <text x={cx} y={cy - 3} className="gauge-pct">{pct.toFixed(0)}%</text>
      <text x={cx} y={cy + 9} className="gauge-sub">chance</text>
    </svg>
  );
}

interface CardRow {
  key: string;
  label: string;
  yes: number;
}

function BrowseCard({
  group, live, watchlist, bets, onToggleWatch, regionName, regionOfCountry,
}: {
  group: EventGroup;
  live: LivePriceMap;
  watchlist: Set<string>;
  /** open bets on this group's markets — shown as position strips (V0.153: every scope) */
  bets?: Bet[];
  onToggleWatch: (id: string) => void;
  regionName: Map<string, string>;
  regionOfCountry: Map<string, string | undefined>;
}) {
  // merged cross-event ladder when it exists, else the busiest member
  const current: CatalogEvent =
    group.merged ?? group.events.reduce((a, b) => (b.volume > a.volume ? b : a));
  const rep = group.events.reduce((a, b) => (b.volume > a.volume ? b : a));

  const rows: CardRow[] =
    current.type === "horizon"
      ? buildLadder(current, live).map((r) => ({ key: r.endDate, label: r.label, yes: r.yes }))
      : current.type === "categorical"
        ? [...current.markets]
            .sort((a, b) => liveYes(b, live) - liveYes(a, live))
            .map((m) => ({ key: m.id, label: m.groupItemTitle || m.question, yes: liveYes(m, live) }))
        : current.markets.map((m) => ({
            key: m.id, label: deadlineLabel(m.endDate), yes: liveYes(m, live),
          }));

  const isBinary = current.type === "binary" && rows.length === 1;
  const shown = rows.slice(0, MAX_ROWS);
  const more = rows.length - shown.length;
  const maxYes = Math.max(...rows.map((r) => r.yes), 1e-9);

  const totalVol = group.events.reduce((s, e) => s + e.volume, 0);
  const watched = group.events.some((e) => watchlist.has(e.id));
  const region = rep.region ? regionName.get(rep.region) : null;

  return (
    <div
      className="bw-card"
      onClick={() => { window.location.hash = `#/event/${current.id}`; }}
    >
      <div className="bw-head">
        <span className="bw-flag">{flagEmoji(anchorCountry(rep, regionOfCountry))}</span>
        <div className="bw-head-main">
          <div className="bw-eyebrow">
            {rep.category}{region && <span className="bw-eyebrow-region"> · {region}</span>}
          </div>
          <div className="bw-title">{group.title}</div>
        </div>
        {isBinary && <ChanceGauge pct={rows[0].yes} />}
      </div>

      {isBinary ? (
        <div className="bw-yn">
          <span className="bw-yes">Yes {rows[0].yes.toFixed(0)}¢</span>
          <span className="bw-no">No {(100 - rows[0].yes).toFixed(0)}¢</span>
        </div>
      ) : (
        <div className="bw-rows">
          {shown.map((r, i) => (
            <div key={r.key} className="bw-row">
              <div className="bw-row-label">
                <span className="bw-row-name">{r.label}</span>
                <div
                  className={`bw-underline u${Math.min(i, 2)}`}
                  style={{ width: `${Math.max(3, (r.yes / maxYes) * 100)}%` }}
                />
              </div>
              <span className="bw-mult">{multiplier(r.yes)}</span>
              <span className="bw-pill">{r.yes.toFixed(0)}%</span>
            </div>
          ))}
          {more > 0 && <div className="bw-more">+{more} more</div>}
        </div>
      )}

      {bets?.map((b) => (
        <BetStrip
          key={b.id}
          bet={b}
          market={group.events.flatMap((e) => e.markets).find((m) => m.id === b.marketId)}
          live={live}
        />
      ))}

      <div className="bw-foot">
        <span>{fmtVolume(totalVol)} Vol.</span>
        <span className="bw-foot-right">
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
        </span>
      </div>
    </div>
  );
}

export default function BrowsePage({ catalog, live, watchlist, bets, onToggleWatch }: Props) {
  const [geo, setGeo] = useState<string | null>(null); // region id | "country:XXX" | "__global__"
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortKey>("volume24h"); // 24h volume is the default view
  const [scope, setScope] = useState<Scope>("all");

  const regionOfCountry = useMemo(
    () => new Map(catalog.countries.map((c) => [c.id, c.region])),
    [catalog],
  );
  const regionName = useMemo(
    () => new Map(catalog.regions.map((r) => [r.id, r.name])),
    [catalog],
  );
  const countryName = useMemo(
    () => new Map(catalog.countries.map((c) => [c.id, c.name])),
    [catalog],
  );

  const groups = useMemo(() => buildGroups(catalog.events), [catalog]);

  /** group key → OPEN bets placed on any of the group's markets */
  const groupBets = useMemo(() => {
    const m = new Map<string, Bet[]>();
    for (const g of groups) {
      const marketIds = new Set(g.events.flatMap((e) => e.markets.map((mk) => mk.id)));
      const bs = bets.filter((b) => isOpen(b) && marketIds.has(b.marketId));
      if (bs.length) m.set(g.key, bs);
    }
    return m;
  }, [groups, bets]);

  /** watchlist/bets scope narrows everything: cards, sidebar counts, title */
  const scopedGroups = useMemo(() => {
    switch (scope) {
      case "watch": return groups.filter((g) => g.events.some((e) => watchlist.has(e.id)));
      case "bets":  return groups.filter((g) => groupBets.has(g.key));
      default:      return groups;
    }
  }, [groups, scope, watchlist, groupBets]);

  /** each card's geography comes from its busiest member, like the map anchors */
  const geoOf = useMemo(() => {
    const m = new Map<string, { region: string | null; country: string | null }>();
    for (const g of groups) {
      const rep = g.events.reduce((a, b) => (b.volume > a.volume ? b : a));
      m.set(g.key, { region: rep.region, country: anchorCountry(rep, regionOfCountry) });
    }
    return m;
  }, [groups, regionOfCountry]);

  const { regionCounts, countryCounts, globalCount } = useMemo(() => {
    const regionCounts = new Map<string, number>();
    const countryCounts = new Map<string, number>();
    let globalCount = 0;
    for (const g of scopedGroups) {
      const { region, country } = geoOf.get(g.key)!;
      if (!region) { globalCount++; continue; }
      regionCounts.set(region, (regionCounts.get(region) ?? 0) + 1);
      if (country) countryCounts.set(country, (countryCounts.get(country) ?? 0) + 1);
    }
    return { regionCounts, countryCounts, globalCount };
  }, [scopedGroups, geoOf]);

  // a scope switch can empty the selected geography (its sidebar entry
  // disappears but the filter would silently stick) — reset to All markets
  useEffect(() => {
    if (!geo) return;
    const alive =
      geo === "__global__"
        ? globalCount > 0
        : geo.startsWith("country:")
          ? (countryCounts.get(geo.slice(8)) ?? 0) > 0
          : (regionCounts.get(geo) ?? 0) > 0;
    if (!alive) setGeo(null);
  }, [geo, regionCounts, countryCounts, globalCount]);

  const topCountries = useMemo(
    () =>
      [...countryCounts.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 12),
    [countryCounts],
  );

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    let out = scopedGroups.filter((g) => {
      const { region, country } = geoOf.get(g.key)!;
      if (geo === "__global__" && region) return false;
      if (geo?.startsWith("country:") && country !== geo.slice(8)) return false;
      if (geo && geo !== "__global__" && !geo.startsWith("country:") && region !== geo)
        return false;
      if (q && !g.title.toLowerCase().includes(q)) return false;
      return true;
    });
    const vol = (g: EventGroup) => g.events.reduce((s, e) => s + e.volume, 0);
    const vol24 = (g: EventGroup) => g.events.reduce((s, e) => s + e.volume24h, 0);
    const move = (g: EventGroup) =>
      Math.max(0, ...g.events.flatMap((e) => e.markets.map((m) => Math.abs(m.change24h ?? 0))));
    const nearest = (g: EventGroup) => g.events.reduce((s, e) => (e.endDate < s ? e.endDate : s), "9999");
    switch (sort) {
      case "volume":    out = out.sort((a, b) => vol(b) - vol(a)); break;
      case "volume24h": out = out.sort((a, b) => vol24(b) - vol24(a)); break;
      case "move":      out = out.sort((a, b) => move(b) - move(a)); break;
      case "endDate":   out = out.sort((a, b) => nearest(a).localeCompare(nearest(b))); break;
    }
    return out;
  }, [scopedGroups, geoOf, geo, query, sort]);

  const sideItem = (id: string | null, label: string, count: number) => (
    <button
      key={id ?? "all"}
      className={`bw-side-item${geo === id ? " on" : ""}`}
      onClick={() => setGeo(id)}
    >
      <span className="bw-side-name">{label}</span>
      <span className="bw-side-count">{count}</span>
    </button>
  );

  return (
    <div className="browse-page">
      <aside className="bw-side">
        {sideItem(null, "All markets", scopedGroups.length)}
        <div className="bw-side-sect">Regions</div>
        {catalog.regions
          .filter((r) => (regionCounts.get(r.id) ?? 0) > 0)
          .sort((a, b) => (regionCounts.get(b.id) ?? 0) - (regionCounts.get(a.id) ?? 0))
          .map((r) => sideItem(r.id, r.name, regionCounts.get(r.id) ?? 0))}
        {globalCount > 0 && sideItem("__global__", "Global / other", globalCount)}
        <div className="bw-side-sect">Countries</div>
        {topCountries.map(([cid, n]) =>
          sideItem(`country:${cid}`, countryName.get(cid) ?? cid, n))}
      </aside>

      <div className="bw-main">
        <div className="bw-toolbar">
          <span className="bw-page-title">
            {geo?.startsWith("country:")
              ? countryName.get(geo.slice(8)) ?? "Markets"
              : geo === "__global__"
                ? "Global / other"
                : geo
                  ? regionName.get(geo) ?? "Markets"
                  : "Geopolitics"}
            <span className="bw-page-count"> · {shown.length}</span>
          </span>
          <div className="bw-tools">
            <input
              className="search bw-search"
              placeholder="Search markets…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <div className="toggle">
              <button className={scope === "watch" ? "on" : ""} title="Watchlist" onClick={() => setScope("watch")}>
                ★
              </button>
              <button className={scope === "bets" ? "on" : ""} title="Open bets" onClick={() => setScope("bets")}>
                $
              </button>
              <button className={scope === "all" ? "on" : ""} onClick={() => setScope("all")}>
                All
              </button>
            </div>
            <select className="bw-sort" value={sort} onChange={(e) => setSort(e.target.value as SortKey)}>
              <option value="volume24h">24h volume</option>
              <option value="volume">Volume</option>
              <option value="move">Biggest move</option>
              <option value="endDate">Nearest deadline</option>
            </select>
          </div>
        </div>

        <div className="bw-grid">
          {shown.map((g) => (
            <BrowseCard
              key={g.key}
              group={g}
              live={live}
              watchlist={watchlist}
              bets={groupBets.get(g.key)}
              onToggleWatch={onToggleWatch}
              regionName={regionName}
              regionOfCountry={regionOfCountry}
            />
          ))}
          {!shown.length && (
            <div className="empty">
              {scope === "watch"
                ? "No watchlisted markets here — star some cards first."
                : scope === "bets"
                  ? "No open bets here — log one from any event's $ button."
                  : "No markets match."}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
