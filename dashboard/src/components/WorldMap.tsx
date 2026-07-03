import { useEffect, useMemo, useRef, useState } from "react";
import { geoNaturalEarth1, geoPath } from "d3-geo";
import { feature } from "topojson-client";
import type { Topology, GeometryCollection } from "topojson-specification";
import type { FeatureCollection } from "geojson";
import type { CatalogEvent, CountryInfo, RegionInfo } from "../lib/types";
import { fmtVolume } from "../lib/analytics";

const W = 960;
const H = 470;
const MIN_K = 1;
const MAX_K = 10;
const COUNTRY_ZOOM = 2.4; // zoom level where region bubbles split into countries

export type MapFilter = "all" | "watch" | "bets";

interface Props {
  events: CatalogEvent[];
  regions: RegionInfo[];
  countries: CountryInfo[];
  selectedRegion: string | null;
  onSelectRegion: (id: string | null) => void;
  /** event to focus (pan/highlight) — set when the user picks an event */
  focusEvent: CatalogEvent | null;
  /** clicking empty map (not a bubble, not a drag) clears the selection */
  onClearFocus: () => void;
  watchlist: Set<string>;
  betEventIds: Set<string>;
}

interface Bubble {
  id: string;
  name: string;
  kind: "region" | "country";
  x: number;
  y: number;
  r: number;
  count: number;
  volume: number;
  maxMove: number;
  hasBets: boolean;
}

interface Transform {
  k: number;
  tx: number;
  ty: number;
}

function clampTransform(t: Transform): Transform {
  const k = Math.min(MAX_K, Math.max(MIN_K, t.k));
  // keep the map covering the viewport
  const tx = Math.min(0, Math.max(W - W * k, t.tx));
  const ty = Math.min(0, Math.max(H - H * k, t.ty));
  return { k, tx, ty };
}

export default function WorldMap({
  events, regions, countries, selectedRegion, onSelectRegion,
  focusEvent, onClearFocus, watchlist, betEventIds,
}: Props) {
  const [world, setWorld] = useState<FeatureCollection | null>(null);
  const [disputed, setDisputed] = useState<FeatureCollection | null>(null);
  const [t, setT] = useState<Transform>({ k: 1, tx: 0, ty: 0 });
  const [animate, setAnimate] = useState(false);
  const [filter, setFilter] = useState<MapFilter>("all");
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

  const countryMode = t.k >= COUNTRY_ZOOM;

  // events with no inferred region never get a bubble — reachable via the
  // "global" chip below, which drives CatalogPanel's __global__ filter
  const globalCount = visibleEvents.filter((e) => !e.region).length;

  const bubbles: Bubble[] = useMemo(() => {
    const byAnchor = new Map<string, CatalogEvent[]>();

    for (const ev of visibleEvents) {
      if (countryMode) {
        // pin each event to its PRIMARY country only, so zoomed-in counts
        // sum to the same totals as region view (no double counting)
        const cids = ev.countries?.length ? [ev.countries[0]] : [];
        for (const cid of cids) {
          (byAnchor.get(cid) ?? byAnchor.set(cid, []).get(cid)!).push(ev);
        }
        if (!cids.length && ev.region) {
          // no country match — keep on its region anchor even when zoomed
          (byAnchor.get(ev.region) ?? byAnchor.set(ev.region, []).get(ev.region)!).push(ev);
        }
      } else if (ev.region) {
        (byAnchor.get(ev.region) ?? byAnchor.set(ev.region, []).get(ev.region)!).push(ev);
      }
    }

    const anchorInfo = new Map<string, { name: string; lat: number; lon: number; kind: "region" | "country" }>();
    for (const r of regions) anchorInfo.set(r.id, { ...r, kind: "region" });
    if (countryMode) for (const c of countries) anchorInfo.set(c.id, { ...c, kind: "country" });

    const vols = [...byAnchor.values()].map((evs) => evs.reduce((s, e) => s + e.volume, 0));
    const maxVol = Math.max(1, ...vols);

    const out: Bubble[] = [];
    for (const [aid, evs] of byAnchor) {
      const info = anchorInfo.get(aid);
      if (!info) continue;
      const pt = projection([info.lon, info.lat]);
      if (!pt) continue;
      const volume = evs.reduce((s, e) => s + e.volume, 0);
      const base = countryMode ? 7 : 9;
      const span = countryMode ? 20 : 26;
      out.push({
        id: aid,
        name: info.name,
        kind: info.kind,
        x: pt[0],
        y: pt[1],
        r: base + span * Math.sqrt(volume / maxVol),
        count: evs.length,
        volume,
        maxMove: Math.max(0, ...evs.flatMap((e) => e.markets.map((m) => Math.abs(m.change24h ?? 0)))),
        hasBets: evs.some((e) => betEventIds.has(e.id)),
      });
    }
    return out.sort((a, b) => b.r - a.r);
  }, [visibleEvents, regions, countries, projection, countryMode, betEventIds]);

  // ── focus/pan on selected event ─────────────────────────────────────────────
  const focusPoint = useMemo(() => {
    if (!focusEvent) return null;
    const c = focusEvent.countries?.length
      ? countries.find((x) => x.id === focusEvent.countries[0])
      : regions.find((x) => x.id === focusEvent.region);
    if (!c) return null;
    return projection([c.lon, c.lat]);
  }, [focusEvent, countries, regions, projection]);

  useEffect(() => {
    if (!focusPoint) return;
    setAnimate(true);
    setT((prev) => {
      const k = Math.max(prev.k, 2.6);
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
          {disputed?.features.map((f, i) => (
            <path key={`d${i}`} d={path(f) ?? ""} className="map-disputed"
                  style={{ strokeWidth: 1.1 * inv }} />
          ))}

          {focusPoint && (
            <circle cx={focusPoint[0]} cy={focusPoint[1]} r={18 * inv} className="focus-halo" />
          )}

          {bubbles.map((b) => {
            // country bubbles filter with a "country:" prefix
            const filterId = b.kind === "region" ? b.id : `country:${b.id}`;
            const active = selectedRegion === filterId;
            const hot = b.maxMove >= 0.05;
            const r = b.r * inv;
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
                <circle r={r} className="bubble-fill" />
                <circle r={r} className="bubble-ring" />
                {b.hasBets && <circle r={r + 3 * inv} className="bubble-bets" style={{ strokeWidth: 1.6 * inv }} />}
                <text dy="0.35em" className="bubble-count" style={{ fontSize: 11 * inv }}>
                  {b.count}
                </text>
                {(b.r >= 16 || countryMode) && (
                  <text dy={r + 11 * inv} className="bubble-name" style={{ fontSize: 9 * inv }}>
                    {b.name}
                  </text>
                )}
              </g>
            );
          })}
        </g>
      </svg>

      <div className="map-footer">
        <div className="map-filter">
          {(["all", "watch", "bets"] as MapFilter[]).map((f) => (
            <button
              key={f}
              className={`chip${filter === f ? " chip-active" : ""}`}
              onClick={() => setFilter(f)}
            >
              {f === "all" ? "all markets" : f === "watch" ? "★ watchlist" : "$ my bets"}
            </button>
          ))}
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
          {selectedRegion && selectedRegion !== "__global__" && (
            <button className="chip chip-active" onClick={() => onSelectRegion(null)}>
              ✕ {selectedRegion.startsWith("country:")
                ? countries.find((c) => c.id === selectedRegion.slice(8))?.name ?? "filter"
                : regions.find((r) => r.id === selectedRegion)?.name ?? "filter"}
            </button>
          )}
        </div>
        <div className="map-filter">
          <span className="map-hint">
            {countryMode ? "country view" : "region view"} · scroll to zoom · drag to pan
            {" · "}<span className="disputed-key">– –</span> disputed borders
          </span>
          {t.k > 1.01 && (
            <button className="chip" onClick={resetView}>⌂ reset</button>
          )}
        </div>
      </div>
    </div>
  );
}
