"""
Catalog builder: scans Polymarket Gamma API for active geopolitical events
across a set of tags (keyset pagination), normalizes them, infers category
and map region, and writes a JSON catalog consumed by the dashboard.

Usage:
  python pipeline/build_catalog.py                        # writes dashboard/public/data/catalog.json
  python pipeline/build_catalog.py --out path.json
  python pipeline/build_catalog.py --min-vol 1000 --tag taiwan --tag nuclear
"""
import argparse
import json
import re
import sys
import time
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Optional

import requests

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
    "middle-east",
    "foreign-policy",
]

DEFAULT_MIN_VOL = 1_000

# ── Category inference (first matching tag wins) ──────────────────────────────
TAG_TO_CATEGORY = [
    ("military-action",           "Military Conflict"),
    ("ukraine-map",               "Military Conflict"),
    ("russia-capture",            "Military Conflict"),
    ("israel-x-iran",             "Military Conflict"),
    ("taiwan",                    "Military Conflict"),
    ("nuclear",                   "Military / Nuclear"),
    ("ukraine-peace-deal",        "Diplomacy"),
    ("diplomacy-ceasefire",       "Diplomacy"),
    ("peace-deal",                "Diplomacy"),
    ("us-iran",                   "Diplomacy"),
    ("trump-iran",                "Diplomacy"),
    ("iranian-leadership-regime", "Leadership"),
    ("khamenei",                  "Leadership"),
    ("prime-minister",            "Leadership"),
    ("commodities",               "Economic / Trade"),
    ("oil",                       "Economic / Trade"),
    ("strait-of-hormuz",          "Economic / Shipping"),
]

# ── Region inference ──────────────────────────────────────────────────────────
# Order matters: more specific regions first. Each entry:
#   (region_id, display_name, lat, lon, tag_keywords, title_regex)
REGIONS = [
    ("taiwan",   "Taiwan Strait",   23.7,  121.0,
     {"taiwan"}, r"\btaiwan|taipei|lai ching-te|cho jung-tai\b"),
    ("ukraine",  "Ukraine",         49.0,   32.0,
     {"ukraine", "ukraine-map", "ukraine-peace-deal", "kupyansk", "donestk", "zelenskyy", "zelensky"},
     r"\bukrain|donbas|donetsk|crimea|kyiv|zelensk|kostyantynivka|kupiansk\b"),
    ("iran",     "Iran",            32.4,   53.7,
     {"iran", "us-iran", "trump-iran", "khamenei", "mojtaba", "mojtaba-khamenei",
      "ayatollah", "iranian-leadership-regime", "reza-pahlavi", "shah"},
     r"\biran|khamenei|pahlavi|tehran|persian\b"),
    ("levant",   "Israel / Levant", 32.8,   35.2,
     {"israel", "lebanon", "hezbollah", "litani", "syria", "gaza", "palestine"},
     r"\bisrael|lebanon|hezbollah|litani|syria|gaza|beirut|al-sharaa\b"),
    ("gulf",     "Persian Gulf",    26.5,   52.0,
     {"strait-of-hormuz", "saudi-arabia", "yemen", "houthis", "qatar", "iraq"},
     r"\bhormuz|saudi|yemen|houthi|qatar|iraq|uae|emirates\b"),
    ("korea",    "Korean Peninsula", 38.5, 127.0,
     {"north-korea", "south-korea"}, r"\bkorea|kim jong\b"),
    ("china",    "China",           35.0,  105.0,
     {"china", "xi-jinping"}, r"\bchina|chinese|xi jinping|beijing\b"),
    ("s_asia",   "South Asia",      25.0,   78.0,
     {"india", "pakistan"}, r"\bindia|pakistan|kashmir|modi\b"),
    ("asia_pac", "Asia-Pacific",    12.0,  122.0,
     {"japan", "philippines", "australia"}, r"\bjapan|philippin|australia|indo-pacific\b"),
    ("russia",   "Russia",          55.7,   37.6,
     {"russia", "putin"}, r"\brussia|putin|moscow|kremlin\b"),
    ("europe",   "Europe",          50.0,   10.0,
     {"eu", "nato", "europe", "albania", "germany", "france", "uk", "poland", "moldova", "armenia"},
     r"\bnato\b|\beu\b|europe|albania|german|france|french|britain|moldova|armenia|balkan"),
    ("latam",    "Latin America",  -10.0,  -60.0,
     {"venezuela", "cuba", "maduro", "brazil", "mexico", "colombia",
      "communist-party-of-cuba", "miguel-diaz-canel", "castro"},
     r"\bvenezuela|cuba|maduro|brazil|mexico|colombia|bolivia|argentina\b"),
    ("africa",   "Africa",           5.0,   20.0,
     {"africa", "morocco", "nigeria", "ethiopia", "sudan", "egypt", "libya"},
     r"\bafrica|morocco|nigeria|ethiopia|sudan|egypt|libya|sahel\b"),
    ("n_america", "North America",  45.0, -100.0,
     {"canada", "greenland", "panama"}, r"\bcanada|greenland|panama\b"),
]


# ── Country inference (for zoomed-in map bubbles) ─────────────────────────────
# country_id: ISO-ish slug; (name, lat, lon, keyword regex over title+tags)
COUNTRIES = [
    ("TWN", "Taiwan",        23.7,  121.0, r"\btaiwan|taipei\b"),
    ("UKR", "Ukraine",       49.0,   32.0, r"\bukrain|kyiv|zelensk|donbas|donetsk|crimea|kostyantynivka|kupiansk|lyman|kharkiv|sumy|zaporizh"),
    ("RUS", "Russia",        58.0,   60.0, r"\brussia|putin|moscow|kremlin\b"),
    ("IRN", "Iran",          32.4,   53.7, r"\biran|khamenei|pahlavi|tehran\b"),
    ("ISR", "Israel",        31.4,   35.0, r"\bisrael|netanyahu|idf\b"),
    ("LBN", "Lebanon",       33.9,   35.9, r"\blebanon|hezbollah|litani|beirut\b"),
    ("SYR", "Syria",         35.0,   38.5, r"\bsyria|damascus|al-sharaa\b"),
    ("CHN", "China",         35.0,  105.0, r"\bchina|chinese|xi jinping|beijing\b"),
    ("PRK", "North Korea",   40.0,  127.0, r"\bnorth korea|kim jong|dprk|pyongyang\b"),
    ("KOR", "South Korea",   36.5,  128.0, r"\bsouth korea|seoul\b"),
    ("IND", "India",         22.0,   79.0, r"\bindia|modi|delhi\b"),
    ("PAK", "Pakistan",      30.0,   69.5, r"\bpakistan|islamabad\b"),
    ("JPN", "Japan",         36.5,  138.5, r"\bjapan|tokyo\b"),
    ("PHL", "Philippines",   12.5,  122.5, r"\bphilippin|manila\b"),
    ("AUS", "Australia",    -25.0,  134.0, r"\baustralia|canberra|albanese\b"),
    ("SAU", "Saudi Arabia",  24.0,   45.0, r"\bsaudi|riyadh|mbs\b"),
    ("YEM", "Yemen",         15.5,   47.5, r"\byemen|houthi|sanaa\b"),
    ("IRQ", "Iraq",          33.0,   43.5, r"\biraq|baghdad\b"),
    ("QAT", "Qatar",         25.3,   51.2, r"\bqatar|doha\b"),
    ("ARE", "UAE",           24.0,   54.0, r"\buae\b|\bemirates|abu dhabi|dubai\b"),
    ("EGY", "Egypt",         26.5,   30.0, r"\begypt|cairo|sisi\b"),
    ("TUR", "Turkey",        39.0,   35.0, r"\bturkey|türkiye|erdogan|ankara\b"),
    ("VEN", "Venezuela",      7.5,  -66.0, r"\bvenezuela|maduro|caracas|delcy\b"),
    ("CUB", "Cuba",          21.5,  -79.5, r"\bcuba|havana|diaz-canel|castro\b"),
    ("BRA", "Brazil",       -10.5,  -52.5, r"\bbrazil|lula|brasilia\b"),
    ("MEX", "Mexico",        23.5, -102.5, r"\bmexico|sheinbaum\b"),
    ("COL", "Colombia",       4.0,  -73.0, r"\bcolombia|bogota|petro\b"),
    ("ARG", "Argentina",    -35.0,  -65.0, r"\bargentina|milei\b"),
    ("USA", "United States", 39.5,  -98.5, r"\bunited states\b|\bu\.?s\.?a?\b|\bwhite house|pentagon\b"),
    ("CAN", "Canada",        58.0, -103.0, r"\bcanada|ottawa|carney\b"),
    ("GRL", "Greenland",     72.0,  -41.0, r"\bgreenland|nuuk\b"),
    ("PAN", "Panama",         8.5,  -80.5, r"\bpanama\b"),
    ("GBR", "United Kingdom", 53.5,  -2.5, r"\bbritain|british|\buk\b|united kingdom|starmer|london\b"),
    ("FRA", "France",        46.5,    2.5, r"\bfrance|french|macron|paris\b"),
    ("DEU", "Germany",       51.0,   10.0, r"\bgerman|merz|berlin\b"),
    ("POL", "Poland",        52.0,   19.5, r"\bpoland|warsaw|tusk\b"),
    ("MDA", "Moldova",       47.0,   28.5, r"\bmoldova|transnistria\b"),
    ("BLR", "Belarus",       53.5,   28.0, r"\bbelarus|lukashenko\b"),
    ("ARM", "Armenia",       40.3,   45.0, r"\barmenia|yerevan\b"),
    ("AZE", "Azerbaijan",    40.3,   47.7, r"\bazerbaijan|baku|aliyev\b"),
    ("GEO", "Georgia",       42.0,   43.5, r"\bgeorgia(n)? (govern|parliament|protest)|tbilisi\b"),
    ("ALB", "Albania",       41.0,   20.0, r"\balbania|edi rama|tirana\b"),
    ("SRB", "Serbia",        44.0,   21.0, r"\bserbia|vucic|belgrade|kosovo\b"),
    ("MAR", "Morocco",       32.0,   -6.0, r"\bmorocco|rabat|akhannouch\b"),
    ("NGA", "Nigeria",        9.5,    8.0, r"\bnigeria|abuja|tinubu\b"),
    ("ETH", "Ethiopia",       9.0,   39.5, r"\bethiopia|addis ababa|abiy\b"),
    ("SDN", "Sudan",         15.5,   30.0, r"\bsudan|khartoum|rsf\b"),
    ("LBY", "Libya",         27.0,   17.0, r"\blibya|tripoli|haftar\b"),
    ("AFG", "Afghanistan",   33.8,   66.0, r"\bafghan|taliban|kabul\b"),
]

_WS_RE = re.compile(
    r"\s+(by|before|on or before|prior to|in|at|during|through|until)?\s*"
    r"((january|february|march|april|may|june|july|august|september|october|"
    r"november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)\s*"
    r"\d{0,2},?\s*)?(20\d\d)?\s*[?.!…’]*\s*$",
    re.IGNORECASE,
)


def group_key(title: str) -> str:
    """Normalize a title to a grouping stem so 'X by July 31?', 'X before
    2027?', and 'X by...?' cluster together."""
    t = title.strip().lower()
    t = re.sub(r"\bby\s*(\.\.\.|…)\s*\??$", "", t)      # 'by...?'
    t = re.sub(r"\bbefore 20\d\d\s*\??$", "", t)
    t = re.sub(r"\bin 20\d\d\s*\??$", "", t)
    t = re.sub(r"\bby (end of )?(the year|20\d\d)\s*\??$", "", t)
    t = _WS_RE.sub("", t)                                   # 'by July 31?' etc.
    t = re.sub(r"[^a-z0-9 ]+", " ", t)
    t = re.sub(r"\s+", " ", t).strip()
    return t


def infer_countries(tag_slugs: list[str], title: str) -> list[str]:
    """Country ids matched from the title/tags, most-specific signals only."""
    text = title.lower() + " " + " ".join(tag_slugs)
    out = []
    for cid, _, _, _, pattern in COUNTRIES:
        if re.search(pattern, text):
            out.append(cid)
    return out


def infer_category(tag_slugs: list[str]) -> str:
    tagset = set(tag_slugs)
    for slug, cat in TAG_TO_CATEGORY:
        if slug in tagset:
            return cat
    return "Geopolitics"


def infer_region(tag_slugs: list[str], title: str) -> Optional[str]:
    tagset = set(tag_slugs)
    lower = title.lower()
    # Pass 1: tag match (specific-first)
    for rid, _, _, _, tags, _ in REGIONS:
        if tagset & tags:
            return rid
    # Pass 2: title keyword match
    for rid, _, _, _, _, pattern in REGIONS:
        if re.search(pattern, lower):
            return rid
    return None  # "global" bucket — shown off-map


def parse_iso_date(iso: Optional[str]) -> Optional[date]:
    if not iso:
        return None
    try:
        return datetime.fromisoformat(iso.replace("Z", "+00:00")).date()
    except ValueError:
        return None


def parse_prices(outcome_prices) -> Optional[float]:
    """YES price in percent (0-100), from the JSON-string outcomePrices field."""
    try:
        if isinstance(outcome_prices, str):
            outcome_prices = json.loads(outcome_prices)
        return round(float(outcome_prices[0]) * 100, 2)
    except (ValueError, TypeError, IndexError, json.JSONDecodeError):
        return None


def parse_token_ids(clob_token_ids) -> list[str]:
    try:
        if isinstance(clob_token_ids, str):
            clob_token_ids = json.loads(clob_token_ids)
        return list(clob_token_ids or [])
    except (ValueError, TypeError, json.JSONDecodeError):
        return []


def fetch_tag_events(session: requests.Session, tag: str, today: date,
                     max_pages: int = 30) -> list[dict]:
    """Keyset-paginate all open events for a tag with future end dates."""
    out: list[dict] = []
    cursor: Optional[str] = None
    for _ in range(max_pages):
        params: dict = {
            "tag_slug": tag,
            "closed": "false",
            "limit": 100,
            "end_date_min": str(today),
        }
        if cursor:
            params["after_cursor"] = cursor
        r = session.get(f"{GAMMA_BASE}/events/keyset", params=params, timeout=30)
        r.raise_for_status()
        body = r.json()
        events = body.get("events") or []
        out.extend(events)
        cursor = body.get("next_cursor")
        if not cursor or len(events) < 100:
            break
        time.sleep(0.15)  # be polite
    return out


def normalize_market(m: dict, today: date) -> Optional[dict]:
    end = parse_iso_date(m.get("endDateIso") or m.get("endDate"))
    if not end or end <= today:
        return None
    yes = parse_prices(m.get("outcomePrices"))
    if yes is None:
        return None
    tokens = parse_token_ids(m.get("clobTokenIds"))
    return {
        "id":            m.get("id"),
        "question":      m.get("question", ""),
        "groupItemTitle": m.get("groupItemTitle") or "",
        "endDate":       str(end),
        "days":          (end - today).days,
        "yes":           yes,
        "bestAsk":       m.get("bestAsk"),
        "lastTradePrice": m.get("lastTradePrice"),
        "change24h":     m.get("oneDayPriceChange"),
        "spread":        m.get("spread"),
        "volume":        round(m.get("volumeNum") or 0),
        "volume1wk":     round(float(m.get("volume1wk") or 0)),
        "liquidity":     round(float(m.get("liquidity") or 0)) if m.get("liquidity") else 0,
        "yesTokenId":    tokens[0] if tokens else None,
    }


def classify(markets: list[dict]) -> str:
    """horizon = same question at >=2 deadlines; categorical = >=2 buckets, one
    deadline; binary = single market."""
    distinct_ends = {m["endDate"] for m in markets}
    if len(distinct_ends) >= 2:
        return "horizon"
    if len(markets) >= 2:
        return "categorical"
    return "binary"


def build_catalog(tags: list[str], min_vol: float) -> dict:
    today = date.today()
    session = requests.Session()
    session.headers["User-Agent"] = "geopol-hazard-dashboard/0.1 (catalog builder)"

    seen: set[str] = set()
    events_out: list[dict] = []

    for tag in tags:
        print(f"  fetching tag: {tag} ...", flush=True)
        for e in fetch_tag_events(session, tag, today):
            eid = str(e.get("id"))
            if eid in seen:
                continue
            seen.add(eid)

            markets = []
            for raw in e.get("markets", []):
                nm = normalize_market(raw, today)
                if nm and nm["volume"] >= min_vol:
                    markets.append(nm)
            if not markets:
                continue
            markets.sort(key=lambda m: (m["endDate"], -m["volume"]))

            tag_slugs = [t.get("slug", "") for t in (e.get("tags") or [])]
            title = (e.get("title") or "Unknown").strip()
            events_out.append({
                "id":        eid,
                "slug":      e.get("slug", ""),
                "title":     title,
                "category":  infer_category(tag_slugs),
                "region":    infer_region(tag_slugs, title),
                "countries": infer_countries(tag_slugs, title),
                "groupKey":  group_key(title),
                "type":      classify(markets),
                "tags":      [s for s in tag_slugs if s and s != "all"],
                "volume":    round(float(e.get("volume") or 0)),
                "volume24h": round(float(e.get("volume24hr") or 0)),
                "liquidity": round(float(e.get("liquidity") or 0)),
                "endDate":   str(parse_iso_date(e.get("endDate")) or ""),
                "markets":   markets,
            })

    events_out.sort(key=lambda e: -e["volume"])
    return {
        "generatedAt":   datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "referenceDate": str(today),
        "tags":          tags,
        "minVolume":     min_vol,
        "regions": [
            {"id": rid, "name": name, "lat": lat, "lon": lon}
            for rid, name, lat, lon, _, _ in REGIONS
        ],
        "countries": [
            {"id": cid, "name": name, "lat": lat, "lon": lon}
            for cid, name, lat, lon, _ in COUNTRIES
        ],
        "events": events_out,
    }


def main() -> None:
    ap = argparse.ArgumentParser(description="Build geopolitics market catalog JSON")
    ap.add_argument("--out", default=None, help="Output path (default: dashboard/public/data/catalog.json)")
    ap.add_argument("--min-vol", type=float, default=DEFAULT_MIN_VOL)
    ap.add_argument("--tag", action="append", dest="tags")
    args = ap.parse_args()

    root = Path(__file__).resolve().parent.parent
    out_path = Path(args.out) if args.out else root / "dashboard" / "public" / "data" / "catalog.json"
    out_path.parent.mkdir(parents=True, exist_ok=True)

    tags = args.tags or GEOPOL_TAGS
    print(f"Building catalog | tags: {len(tags)} | min vol: ${args.min_vol:,.0f}")
    catalog = build_catalog(tags, args.min_vol)

    n_ev = len(catalog["events"])
    n_mk = sum(len(e["markets"]) for e in catalog["events"])
    n_hz = sum(1 for e in catalog["events"] if e["type"] == "horizon")
    n_unmapped = sum(1 for e in catalog["events"] if e["region"] is None)
    print(f"  {n_ev} events | {n_mk} markets | {n_hz} horizon-type | {n_unmapped} unmapped region")

    out_path.write_text(json.dumps(catalog, separators=(",", ":")), encoding="utf-8")
    print(f"  wrote {out_path} ({out_path.stat().st_size/1024:.0f} KB)")


if __name__ == "__main__":
    main()
