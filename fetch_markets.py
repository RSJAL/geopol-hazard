"""
Semi-automated fetcher: queries Gamma API for geopolitical events across
multiple tags, deduplicates, and prints candidates for dashboard inclusion.

Usage:
  python fetch_markets.py
  python fetch_markets.py --min-vol 10000
  python fetch_markets.py --tag taiwan --tag nuclear
"""
import argparse
import json
from datetime import date, datetime

import requests

GAMMA_BASE = "https://gamma-api.polymarket.com"
TODAY = date.today()

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


def _yes(outcome_prices: str) -> float | None:
    try:
        return round(float(json.loads(outcome_prices)[0]) * 100, 1)
    except Exception:
        return None


def _end(iso: str) -> date | None:
    try:
        return datetime.fromisoformat(iso.replace("Z", "+00:00")).date()
    except Exception:
        return None


def fetch_all(tags: list[str], min_vol: float) -> list[dict]:
    seen: set[str] = set()
    result: list[dict] = []
    for tag in tags:
        print(f"  fetching tag: {tag} ...", flush=True)
        for e in _fetch_tag(tag):
            if e["id"] in seen:
                continue
            seen.add(e["id"])
            active = [
                m for m in e.get("markets", [])
                if (d := _end(m.get("endDateIso") or m.get("endDate") or ""))
                and d > TODAY
                and (m.get("volumeNum") or 0) >= min_vol
            ]
            if active:
                result.append({
                    **e,
                    "_active_markets": sorted(active, key=lambda m: m.get("endDateIso") or ""),
                })
    return result


def print_events(events: list[dict]) -> None:
    # Group by inferred category (first meaningful tag wins)
    cat_order = {
        "Military Conflict": 0, "Military / Nuclear": 1,
        "Diplomacy": 2, "Leadership": 3, "Geopolitics": 4,
    }

    def infer_cat(e: dict) -> str:
        slugs = [t["slug"] for t in e.get("tags", [])]
        for s in slugs:
            mapping = {
                "military-action": "Military Conflict",
                "nuclear": "Military / Nuclear",
                "us-iran": "Diplomacy", "israel-x-iran": "Military Conflict",
                "iranian-leadership-regime": "Leadership", "taiwan": "Military Conflict",
                "ukraine-map": "Military Conflict", "ukraine-peace-deal": "Diplomacy",
            }
            if s in mapping:
                return mapping[s]
        return "Geopolitics"

    by_cat: dict[str, list] = {}
    for e in events:
        cat = infer_cat(e)
        by_cat.setdefault(cat, []).append(e)

    for cat in sorted(by_cat, key=lambda c: cat_order.get(c, 99)):
        items = by_cat[cat]
        print(f"\n{'='*72}")
        print(f"  {cat.upper()}  ({len(items)} events)")
        print(f"{'='*72}")
        for e in sorted(items, key=lambda x: x.get("title", "")):
            mkts = e["_active_markets"]
            tags = [t["slug"] for t in e.get("tags", []) if t["slug"] != "all"]
            print(f"\n  {e['title']}")
            print(f"  Tags : {', '.join(tags[:8])}")
            print(f"  {'End date':<12}  {'YES%':>6}  {'Days':>5}  {'Volume USD':>14}")
            print(f"  {'-'*12}  {'-'*6}  {'-'*5}  {'-'*14}")
            for m in mkts:
                end = _end(m.get("endDateIso") or m.get("endDate") or "")
                yes = _yes(m.get("outcomePrices", "[]"))
                days = (end - TODAY).days if end else "?"
                vol = m.get("volumeNum") or 0
                print(f"  {str(end):<12}  {yes or '?':>5}%  {days:>5}  ${vol:>13,.0f}")


def main() -> None:
    ap = argparse.ArgumentParser(description="Fetch geopolitical Polymarket events")
    ap.add_argument(
        "--min-vol", type=float, default=DEFAULT_MIN_VOL, metavar="N",
        help=f"Minimum market volume USD (default: {DEFAULT_MIN_VOL:,})",
    )
    ap.add_argument(
        "--tag", action="append", dest="tags", metavar="TAG",
        help="Override tag list (repeatable). Defaults to built-in geopolitical tags.",
    )
    args = ap.parse_args()

    tags = args.tags or GEOPOL_TAGS
    print(f"Tags  : {', '.join(tags)}")
    print(f"Min vol: ${args.min_vol:,.0f}  |  Reference date: {TODAY}\n")

    events = fetch_all(tags, args.min_vol)
    print(f"\nUnique events with qualifying markets: {len(events)}")
    print_events(events)
    total_horizons = sum(len(e["_active_markets"]) for e in events)
    print(f"\nTotal: {len(events)} events, {total_horizons} horizon points")


if __name__ == "__main__":
    main()
