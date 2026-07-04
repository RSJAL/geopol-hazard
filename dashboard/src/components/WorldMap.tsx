import { useEffect, useMemo, useRef, useState } from "react";
import { geoNaturalEarth1, geoPath } from "d3-geo";
import { feature } from "topojson-client";
import type { Topology, GeometryCollection } from "topojson-specification";
import type { FeatureCollection } from "geojson";
import type { CatalogEvent, CountryInfo, RegionInfo, SubregionInfo } from "../lib/types";
import { anchorCountry, fmtVolume } from "../lib/analytics";

const W = 960;
const H = 470;
const MIN_K = 1;
const MAX_K = 10;
// 3-level hierarchy: region → subregion → country, entered at these zooms…
const K_SUB = 2.0;
const K_COUNTRY = 3.4;
// …but a bubble only splits when it holds enough events (skip-level rule)
const SPLIT_MIN = 4;

export type MapFilter = "all" | "watch" | "bets";

/** Personalized bet summary rendered as a small card on the map. */
export interface BetMapCard {
  title: string;
  side: "YES" | "NO";
  shares: number;
  entry: number;
  current: number;
  pnl: number;
  pnlPct: number;
}

interface Props {
  events: CatalogEvent[];
  regions: RegionInfo[];
  subregions: SubregionInfo[];
  countries: CountryInfo[];
  selectedRegion: string | null;
  onSelectRegion: (id: string | null) => void;
  /** all/watchlist/bets scope — lifted so the catalog can honor it too */
  filter: MapFilter;
  onFilterChange: (f: MapFilter) => void;
  /** event to focus (pan/highlight) — set when the user picks an event */
  focusEvent: CatalogEvent | null;
  /** clicking empty map (not a bubble, not a drag) clears the selection */
  onClearFocus: () => void;
  watchlist: Set<string>;
  betEventIds: Set<string>;
  /** eventId → bet summary, for personalized cards on the map */
  betCards: Map<string, BetMapCard>;
}

interface Bubble {
  id: string;
  name: string;
  kind: "region" | "sub" | "country";
  x: number;
  y: number;
  r: number;
  count: number;
  volume: number;
  maxMove: number;
  hasBets: boolean;
  /** set when the bubble holds exactly one event (bets-mode mini cards) */
  soleEventId: string | null;
  /** region-anchored leftovers of a region that split (no anchor country) */
  isRemainder: boolean;
}

interface Transform {
  k: number;
  tx: number;
  ty: number;
}

/** Small personalized bet card drawn on the map (screen-size via 1/k scale). */
function BetCardG({ card, inv }: { card: BetMapCard; inv: number }) {
  const up = card.pnl >= 0;
  return (
    <g className="map-bet-card" transform={`scale(${inv})`} pointerEvents="none">
      <rect x={10} y={-30} width={176} height={60} rx={7} className="bmc-rect" />
      <text x={19} y={-12} className="bmc-title">{card.title.slice(0, 27)}</text>
      <text x={19} y={3}>
        <tspan className="bmc-entry">
          {card.side} {card.shares} @ {card.entry.toFixed(1)}¢
        </tspan>
        <tspan className="bmc-cur" dx="5">now {card.current.toFixed(1)}¢</tspan>
      </text>
      <text x={19} y={19} className={up ? "bmc-up" : "bmc-down"}>
        {up ? "+" : "−"}${Math.abs(card.pnl).toFixed(2)} ({card.pnlPct >= 0 ? "+" : ""}
        {card.pnlPct.toFixed(1)}%)
      </text>
    </g>
  );
}

function clampTransform(t: Transform): Transform {
  const k = Math.min(MAX_K, Math.max(MIN_K, t.k));
  // keep the map covering the viewport
  const tx = Math.min(0, Math.max(W - W * k, t.tx));
  const ty = Math.min(0, Math.max(H - H * k, t.ty));
  return { k, tx, ty };
}

export default function WorldMap({
  events, regions, subregions, countries, selectedRegion, onSelectRegion,
  filter, onFilterChange, focusEvent, onClearFocus, watchlist, betEventIds,
  betCards,
}: Props) {
  const [world, setWorld] = useState<FeatureCollection | null>(null);
  const [disputed, setDisputed] = useState<FeatureCollection | null>(null);
  const [t, setT] = useState<Transform>({ k: 1, tx: 0, ty: 0 });
  const [animate, setAnimate] = useState(false);
  const svgRef = useRef<SVGSVGElement>(null);
  const drag = useRef<{ x: number; y: number; tx: number; ty: number } | null>(null);
  const dragMoved = useRef(false);

  useEffect(() => {
    fetch("geo/countries-50m.json")
      .then((r) => r.json())
      .then((topo: Topology<{ countries: GeometryCollection }>) =>
        setWorld(feature(topo, topo.objects.countries)))
      .catch(() => setWorld(null));
    fetch("geo/disputed-borders.json")
      .then((r) => r.json())
      .then(setDisputed)
      .catch(() => setDisputed(null));
  }, []);

  const projection = useMemo(
    () => geoNaturalEarth1().fitSize([W, H], { type: "Sphere" }),
    [],
  );
  const path = useMemo(() => geoPath(projection), [projection]);

  // ── event filtering for bubble aggregation ──────────────────────────────────
  const visibleEvents = useMemo(() => {
    switch (filter) {
      case "watch": return events.filter((e) => watchlist.has(e.id));
      case "bets":  return events.filter((e) => betEventIds.has(e.id));
      default:      return events;
    }
  }, [events, filter, watchlist, betEventIds]);

  const level = t.k >= K_COUNTRY ? 2 : t.k >= K_SUB ? 1 : 0;

  // events with no inferred region never get a bubble — reachable via the
  // "global" chip below, which drives CatalogPanel's __global__ filter
  const globalCount = visibleEvents.filter((e) => !e.region).length;

  const regionOfCountry = useMemo(
    () => new Map(countries.map((c) => [c.id, c.region])),
    [countries],
  );
  const countryMeta = useMemo(
    () => new Map(countries.map((c) => [c.id, c])),
    [countries],
  );

  // ── 3-level bubble aggregation with density-based level skipping ───────────
  // An event's anchor chain is region → subregion (if its anchor country has
  // one) → country. At the middle zoom a region only splits when it holds
  // enough events (keeps sparse geographies merged, Fig 1); at country zoom
  // everything devolves fully to countries. Watch/bets scopes split
  // immediately — a user's own handful of events should never stay merged.
  const { bubbles, anchorOf } = useMemo(() => {
    const splitMin = filter === "all" ? SPLIT_MIN : 0;

    const chain = (ev: CatalogEvent) => {
      const cid = anchorCountry(ev, regionOfCountry);
      const sub = cid ? countryMeta.get(cid)?.subregion ?? null : null;
      return { cid, sub };
    };

    const regionCounts = new Map<string, number>();
    for (const ev of visibleEvents) {
      if (!ev.region) continue;
      regionCounts.set(ev.region, (regionCounts.get(ev.region) ?? 0) + 1);
    }

    const anchorOf = new Map<string, string>();
    const byAnchor = new Map<string, CatalogEvent[]>();
    const splitRegions = new Set<string>();
    for (const ev of visibleEvents) {
      if (!ev.region) continue;
      let aid = ev.region;
      if (level >= 1) {
        const { cid, sub } = chain(ev);
        if (level >= 2) {
          aid = cid ?? ev.region; // country view: always devolve fully
        } else if ((regionCounts.get(ev.region) ?? 0) > splitMin) {
          aid = sub ?? cid ?? ev.region;
        }
        if (aid !== ev.region || level >= 2) splitRegions.add(ev.region);
      }
      anchorOf.set(ev.id, aid);
      (byAnchor.get(aid) ?? byAnchor.set(aid, []).get(aid)!).push(ev);
    }

    const anchorInfo = new Map<
      string,
      { name: string; lat: number; lon: number; kind: Bubble["kind"] }
    >();
    for (const r of regions) anchorInfo.set(r.id, { ...r, kind: "region" });
    for (const s of subregions) anchorInfo.set(s.id, { ...s, kind: "sub" });
    for (const c of countries) anchorInfo.set(c.id, { ...c, kind: "country" });

    const vols = [...byAnchor.values()].map((evs) => evs.reduce((s, e) => s + e.volume, 0));
    const maxVol = Math.max(1, ...vols);

    const out: Bubble[] = [];
    for (const [aid, evs] of byAnchor) {
      const info = anchorInfo.get(aid);
      if (!info) continue;
      const pt = projection([info.lon, info.lat]);
      if (!pt) continue;
      const isRemainder = info.kind === "region" && splitRegions.has(aid);
      const volume = evs.reduce((s, e) => s + e.volume, 0);
      const base = info.kind === "region" ? 9 : info.kind === "sub" ? 8 : 7;
      const span = info.kind === "region" ? 26 : info.kind === "sub" ? 23 : 20;
      out.push({
        id: aid,
        name: isRemainder ? `${info.name} · other` : info.name,
        kind: info.kind,
        x: pt[0],
        y: pt[1],
        r: base + span * Math.sqrt(volume / maxVol),
        count: evs.length,
        volume,
        maxMove: Math.max(0, ...evs.flatMap((e) => e.markets.map((m) => Math.abs(m.change24h ?? 0)))),
        hasBets: evs.some((e) => betEventIds.has(e.id)),
        soleEventId: evs.length === 1 ? evs[0].id : null,
        isRemainder,
      });
    }
    return { bubbles: out.sort((a, b) => b.r - a.r), anchorOf };
  }, [visibleEvents, regions, subregions, countries, countryMeta, regionOfCountry, projection, level, filter, betEventIds]);

  // ── focus/pan on selected event ─────────────────────────────────────────────
  const focusPoint = useMemo(() => {
    if (!focusEvent?.region) return null; // global events have no map home
    const cid = anchorCountry(focusEvent, regionOfCountry);
    const info = cid
      ? countries.find((x) => x.id === cid)
      : regions.find((x) => x.id === focusEvent.region);
    if (!info) return null;
    return projection([info.lon, info.lat]);
  }, [focusEvent, regionOfCountry, countries, regions, projection]);

  // halo sits on whichever bubble holds the event at the current zoom, drawn
  // OVER the bubbles and larger than them
  const focusAnchorId = focusEvent?.region
    ? anchorOf.get(focusEvent.id) ?? focusEvent.region
    : null;
  const focusBubble = focusAnchorId ? bubbles.find((b) => b.id === focusAnchorId) : null;
  const focusHalo = focusBubble
    ? { x: focusBubble.x, y: focusBubble.y, r: focusBubble.r + 6 }
    : focusAnchorId && focusPoint
      ? { x: focusPoint[0], y: focusPoint[1], r: 20 }
      : null;
  const focusBet = focusEvent ? betCards.get(focusEvent.id) : undefined;

  useEffect(() => {
    if (!focusPoint) return;
    setAnimate(true);
    setT((prev) => {
      const k = Math.max(prev.k, K_COUNTRY + 0.2); // land at country level
      return clampTransform({
        k,
        tx: W / 2 - focusPoint[0] * k,
        ty: H / 2 - focusPoint[1] * k,
      });
    });
    const id = window.setTimeout(() => setAnimate(false), 550);
    return () => window.clearTimeout(id);
  }, [focusPoint]);

  // ── zoom & pan handlers ─────────────────────────────────────────────────────
  const toLocal = (e: { clientX: number; clientY: number }) => {
    const rect = svgRef.current!.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) / rect.width) * W,
      y: ((e.clientY - rect.top) / rect.height) * H,
    };
  };

  // non-passive wheel listener so preventDefault stops the page scrolling
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const { x, y } = toLocal(e);
      setT((prev) => {
        const factor = Math.exp(-e.deltaY * 0.0018);
        const k = Math.min(MAX_K, Math.max(MIN_K, prev.k * factor));
        const scale = k / prev.k;
        return clampTransform({
          k,
          tx: x - (x - prev.tx) * scale,
          ty: y - (y - prev.ty) * scale,
        });
      });
    };
    svg.addEventListener("wheel", onWheel, { passive: false });
    return () => svg.removeEventListener("wheel", onWheel);
  }, []);

  const onPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    (e.target as Element).setPointerCapture?.(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY, tx: t.tx, ty: t.ty };
    dragMoved.current = false;
  };
  const onPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!drag.current) return;
    if (Math.abs(e.clientX - drag.current.x) + Math.abs(e.clientY - drag.current.y) > 4)
      dragMoved.current = true;
    const rect = svgRef.current!.getBoundingClientRect();
    const dx = ((e.clientX - drag.current.x) / rect.width) * W;
    const dy = ((e.clientY - drag.current.y) / rect.height) * H;
    setT(clampTransform({ k: t.k, tx: drag.current.tx + dx, ty: drag.current.ty + dy }));
  };
  const endDrag = () => { drag.current = null; };

  const resetView = () => {
    setAnimate(true);
    setT({ k: 1, tx: 0, ty: 0 });
    window.setTimeout(() => setAnimate(false), 550);
  };

  const inv = 1 / t.k; // inverse scale: keeps bubbles readable while zooming

  return (
    <div className="map-panel">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        className="world-map"
        role="img"
        aria-label="World map of tracked markets"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerLeave={endDrag}
        onClick={() => { if (!dragMoved.current) onClearFocus(); }}
      >
        <g
          transform={`translate(${t.tx},${t.ty}) scale(${t.k})`}
          style={animate ? { transition: "transform 0.5s ease" } : undefined}
        >
          <path d={path({ type: "Sphere" }) ?? ""} className="map-sphere" />
          {world?.features.map((f, i) => (
            <path key={i} d={path(f) ?? ""} className="map-country"
                  style={{ strokeWidth: 0.5 * inv }} />
          ))}
          {disputed?.features.map((f, i) => {
            // nine-dash line keeps bold dashes; land disputes get fine dots
            const nine = String(
              (f.properties as { featurecla?: string } | null)?.featurecla ?? "",
            ).includes("nine-dash");
            return (
              <path
                key={`d${i}`}
                d={path(f) ?? ""}
                className="map-disputed"
                style={{
                  strokeWidth: (nine ? 1.2 : 1.1) * inv,
                  strokeDasharray: nine
                    ? `${5 * inv} ${3.5 * inv}`
                    : `${0.2 * inv} ${2.4 * inv}`,
                  strokeLinecap: "round",
                }}
              />
            );
          })}

          {bubbles.map((b) => {
            // sub/country/remainder bubbles filter with a namespaced prefix
            const filterId = b.isRemainder
              ? `rem:${b.id}`
              : b.kind === "region" ? b.id : b.kind === "sub" ? `sub:${b.id}` : `country:${b.id}`;
            const active = selectedRegion === filterId;
            const hot = b.maxMove >= 0.05;
            const r = b.r * inv;
            // bets mode: a geography holding a single bet shows its card instead
            const soleBet =
              filter === "bets" && b.soleEventId ? betCards.get(b.soleEventId) : undefined;
            return (
              <g
                key={`${b.kind}:${b.id}`}
                className={`map-bubble${active ? " active" : ""}${hot ? " hot" : ""}`}
                transform={`translate(${b.x},${b.y})`}
                onClick={(e) => {
                  e.stopPropagation();
                  onSelectRegion(active ? null : filterId);
                }}
              >
                <title>
                  {`${b.name}\n${b.count} events · ${fmtVolume(b.volume)} volume` +
                    (hot ? `\nlargest 24h move: ${(b.maxMove * 100).toFixed(1)}pts` : "") +
                    (b.hasBets ? "\n$ you have bets here" : "")}
                </title>
                {soleBet ? (
                  <>
                    <circle r={6 * inv} className="bubble-fill" />
                    <circle r={6 * inv} className="bubble-bets" style={{ strokeWidth: 1.6 * inv }} />
                    <BetCardG card={soleBet} inv={inv} />
                  </>
                ) : (
                  <>
                    <circle r={r} className="bubble-fill" />
                    <circle r={r} className="bubble-ring" />
                    {b.hasBets && <circle r={r + 3 * inv} className="bubble-bets" style={{ strokeWidth: 1.6 * inv }} />}
                    <text dy="0.35em" className="bubble-count" style={{ fontSize: 11 * inv }}>
                      {b.count}
                    </text>
                    {(b.r >= 16 || level > 0) && (
                      <text dy={r + 11 * inv} className="bubble-name" style={{ fontSize: 9 * inv }}>
                        {b.name}
                      </text>
                    )}
                  </>
                )}
              </g>
            );
          })}

          {focusHalo && (
            <>
              <circle cx={focusHalo.x} cy={focusHalo.y} r={focusHalo.r * inv} className="focus-halo" />
              {focusBet && (
                <g transform={`translate(${focusHalo.x + focusHalo.r * inv},${focusHalo.y})`}>
                  <BetCardG card={focusBet} inv={inv} />
                </g>
              )}
            </>
          )}
        </g>
      </svg>

      <div className="map-footer">
        <div className="map-filter">
          <button
            className={`chip${filter === "all" ? " chip-active" : ""}`}
            onClick={() => onFilterChange("all")}
          >
            all markets
          </button>
          {globalCount > 0 && (
            <button
              className={`chip${selectedRegion === "__global__" ? " chip-active" : ""}`}
              title="Events with no mapped region — not shown on the map"
              onClick={() =>
                onSelectRegion(selectedRegion === "__global__" ? null : "__global__")}
            >
              ◌ global ({globalCount})
            </button>
          )}
          {(["watch", "bets"] as MapFilter[]).map((f) => (
            <button
              key={f}
              className={`chip${filter === f ? " chip-active" : ""}`}
              onClick={() => onFilterChange(f)}
            >
              {f === "watch" ? "★ watchlist" : "$ my bets"}
            </button>
          ))}
          {selectedRegion && selectedRegion !== "__global__" && (
            <button className="chip chip-active" onClick={() => onSelectRegion(null)}>
              ✕ {selectedRegion.startsWith("country:")
                ? countries.find((c) => c.id === selectedRegion.slice(8))?.name ?? "filter"
                : selectedRegion.startsWith("sub:")
                  ? subregions.find((s) => s.id === selectedRegion.slice(4))?.name ?? "filter"
                  : selectedRegion.startsWith("rem:")
                    ? `${regions.find((r) => r.id === selectedRegion.slice(4))?.name ?? "region"} · other`
                    : regions.find((r) => r.id === selectedRegion)?.name ?? "filter"}
            </button>
          )}
        </div>
        <div className="map-filter">
          <span className="map-hint">
            {level === 2 ? "country view" : level === 1 ? "subregion view" : "region view"}
            {" · scroll to zoom · drag to pan · "}
            <span className="disputed-key">– –</span> disputed borders
          </span>
          {t.k > 1.01 && (
            <button className="chip" onClick={resetView}>⌂ reset</button>
          )}
        </div>
      </div>
    </div>
  );
}
