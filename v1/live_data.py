"""
Live data module: fetches geopolitical Polymarket events from the Gamma API
and returns a MARKETS-compatible list with live YES prices.

Usage as a module:
    from live_data import fetch_live_markets, get_live_enriched

    markets = fetch_live_markets()          # raw rows, same shape as MARKETS
    enriched = get_live_enriched()          # enriched, same shape as ENRICHED_MARKETS
"""
import json
from datetime import date, datetime
from typing import Optional

import requests

from data import enrich

GAMMA_BASE = "https://gamma-api.polymarket.com"

GEOPOL_TAGS = [
    "geopolitics",
    "macro-geopolitics",
    "military-action",
    "nuclear",
    "us-iran",
    "israel-x-iran",
    "iranian-leadership-regime",
    "taiwan",
    "ukraine-map",
    "ukraine-peace-deal",
]

DEFAULT_MIN_VOL = 5_000

_TAG_TO_CATEGORY: dict[str, str] = {
    "military-action":           "Military Conflict",
    "nuclear":                   "Military / Nuclear",
    "us-iran":                   "Diplomacy",
    "israel-x-iran":             "Military Conflict",
    "iranian-leadership-regime": "Leadership",
    "khamenei":                  "Leadership",
    "taiwan":                    "Military Conflict",
    "ukraine-map":               "Military Conflict",
    "ukraine-peace-deal":        "Diplomacy",
    "iran":                      "Diplomacy",
    "russia":                    "Military Conflict",
    "middle-east":               "Geopolitics",
}


def _yes(outcome_prices: str) -> Optional[float]:
    try:
        return round(float(json.loads(outcome_prices)[0]) * 100, 1)
    except Exception:
        return None


def _parse_date(iso: str) -> Optional[date]:
    try:
        return datetime.fromisoformat(iso.replace("Z", "+00:00")).date()
    except Exception:
        return None


def _label(end_date: date, ref_year: int) -> str:
    year = f" {end_date.year}" if end_date.year != ref_year else ""
    return f"By {end_date.strftime('%b')} {end_date.day}{year}"


def _category(tags: list[dict]) -> str:
    for t in tags:
        cat = _TAG_TO_CATEGORY.get(t["slug"])
        if cat:
            return cat
    return "Geopolitics"


def _fetch_tag(tag: str, max_pages: int = 10) -> list[dict]:
    out: list[dict] = []
    offset = 0
    for _ in range(max_pages):
        r = requests.get(
            f"{GAMMA_BASE}/events",
            params={"tag_slug": tag, "closed": "false", "limit": 100, "offset": offset},
            timeout=10,
        )
        r.raise_for_status()
        page = r.json()
        if not page:
            break
        out.extend(page)
        if len(page) < 100:
            break
        offset += 100
    return out


def fetch_live_markets(
    tags: list[str] = GEOPOL_TAGS,
    min_volume: float = DEFAULT_MIN_VOL,
    reference_date: Optional[date] = None,
) -> list[dict]:
    """
    Fetch geopolitical events from Polymarket and return a list in the same
    shape as MARKETS in data.py: [{name, category, source, rows}].

    Each row: {label, yes, days, end_date, volume}
    """
    ref = reference_date or date.today()
    seen: set[str] = set()
    markets: list[dict] = []

    for tag in tags:
        for e in _fetch_tag(tag):
            if e["id"] in seen:
                continue
            seen.add(e["id"])

            rows: list[dict] = []
            for m in sorted(
                e.get("markets", []),
                key=lambda x: x.get("endDateIso") or x.get("endDate") or "",
            ):
                end = _parse_date(m.get("endDateIso") or m.get("endDate") or "")
                if not end or end <= ref:
                    continue
                yes = _yes(m.get("outcomePrices", "[]"))
                if yes is None:
                    continue
                vol = m.get("volumeNum") or 0
                if vol < min_volume:
                    continue
                rows.append({
                    "label":    _label(end, ref.year),
                    "yes":      yes,
                    "days":     (end - ref).days,
                    "end_date": str(end),
                    "volume":   vol,
                })

            # Require at least 2 distinct end dates — drops categorical multi-outcome
            # markets (same deadline, different outcome buckets) and single-point events.
            distinct_ends = {r["end_date"] for r in rows}
            if len(distinct_ends) >= 2:
                markets.append({
                    "name":     e.get("title", "Unknown").rstrip(" by...?"),
                    "category": _category(e.get("tags", [])),
                    "source":   "live",
                    "rows":     rows,
                })

    return markets


def get_live_enriched(
    tags: list[str] = GEOPOL_TAGS,
    min_volume: float = DEFAULT_MIN_VOL,
    reference_date: Optional[date] = None,
) -> list[dict]:
    """Fetch + enrich — drop-in replacement for ENRICHED_MARKETS in app.py."""
    return [enrich(m) for m in fetch_live_markets(tags, min_volume, reference_date)]
