import { useEffect, useMemo, useState } from "react";
import { geoNaturalEarth1, geoPath } from "d3-geo";
import { feature } from "topojson-client";
import type { Topology, GeometryCollection } from "topojson-specification";
import type { FeatureCollection } from "geojson";
import type { CatalogEvent, RegionInfo } from "../lib/types";
import { fmtVolume } from "../lib/analytics";

const W = 960;
const H = 470;

interface Props {
  events: CatalogEvent[];
  regions: RegionInfo[];
  selectedRegion: string | null;
  onSelectRegion: (id: string | null) => void;
}

interface Bubble {
  region: RegionInfo;
  x: number;
  y: number;
  r: number;
  count: number;
  volume: number;
  maxMove: number; // max |24h price change| among the region's markets, 0-1
}

export default function WorldMap({ events, regions, selectedRegion, onSelectRegion }: Props) {
  const [world, setWorld] = useState<FeatureCollection | null>(null);

  useEffect(() => {
    fetch("geo/countries-110m.json")
      .then((r) => r.json())
      .then((topo: Topology<{ countries: GeometryCollection }>) => {
        setWorld(feature(topo, topo.objects.countries));
      })
      .catch(() => setWorld(null));
  }, []);

  const projection = useMemo(
    () => geoNaturalEarth1().fitSize([W, H], { type: "Sphere" }),
    [],
  );
  const path = useMemo(() => geoPath(projection), [projection]);

  const bubbles: Bubble[] = useMemo(() => {
    const byRegion = new Map<string, CatalogEvent[]>();
    for (const ev of events) {
      if (!ev.region) continue;
      (byRegion.get(ev.region) ?? byRegion.set(ev.region, []).get(ev.region)!).push(ev);
    }
    const vols = [...byRegion.values()].map((evs) =>
      evs.reduce((s, e) => s + e.volume, 0),
    );
    const maxVol = Math.max(1, ...vols);

    const out: Bubble[] = [];
    for (const region of regions) {
      const evs = byRegion.get(region.id);
      if (!evs?.length) continue;
      const volume = evs.reduce((s, e) => s + e.volume, 0);
      const maxMove = Math.max(
        0,
        ...evs.flatMap((e) => e.markets.map((m) => Math.abs(m.change24h ?? 0))),
      );
      const pt = projection([region.lon, region.lat]);
      if (!pt) continue;
      out.push({
        region,
        x: pt[0],
        y: pt[1],
        r: 9 + 26 * Math.sqrt(volume / maxVol),
        count: evs.length,
        volume,
        maxMove,
      });
    }
    return out.sort((a, b) => b.r - a.r); // draw big first so small stay clickable
  }, [events, regions, projection]);

  const unmapped = events.filter((e) => !e.region).length;

  return (
    <div className="map-panel">
      <svg viewBox={`0 0 ${W} ${H}`} className="world-map" role="img" aria-label="World map of tracked markets">
        <path d={path({ type: "Sphere" }) ?? ""} className="map-sphere" />
        {world?.features.map((f, i) => (
          <path key={i} d={path(f) ?? ""} className="map-country" />
        ))}
        {bubbles.map((b) => {
          const active = selectedRegion === b.region.id;
          const hot = b.maxMove >= 0.05;
          return (
            <g
              key={b.region.id}
              className={`map-bubble${active ? " active" : ""}${hot ? " hot" : ""}`}
              transform={`translate(${b.x},${b.y})`}
              onClick={() => onSelectRegion(active ? null : b.region.id)}
            >
              <title>
                {`${b.region.name}\n${b.count} events · ${fmtVolume(b.volume)} volume` +
                  (hot ? `\nlargest 24h move: ${(b.maxMove * 100).toFixed(1)}pts` : "")}
              </title>
              <circle r={b.r} className="bubble-fill" />
              <circle r={b.r} className="bubble-ring" />
              <text dy="0.35em" className="bubble-count">{b.count}</text>
              {b.r >= 16 && <text dy={b.r + 12} className="bubble-name">{b.region.name}</text>}
            </g>
          );
        })}
      </svg>
      <div className="map-footer">
        {selectedRegion ? (
          <button className="chip chip-active" onClick={() => onSelectRegion(null)}>
            ✕ {regions.find((r) => r.id === selectedRegion)?.name} — clear filter
          </button>
        ) : (
          <span className="map-hint">Click a bubble to filter the catalog by region</span>
        )}
        {unmapped > 0 && (
          <button
            className={`chip${selectedRegion === "__global__" ? " chip-active" : ""}`}
            onClick={() => onSelectRegion(selectedRegion === "__global__" ? null : "__global__")}
          >
            🌐 {unmapped} global / unmapped
          </button>
        )}
      </div>
    </div>
  );
}
