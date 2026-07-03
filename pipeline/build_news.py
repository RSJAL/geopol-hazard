"""
News feed builder: pulls headlines from a whitelist of reputable outlets
(direct RSS + Google News RSS topic searches), matches articles to catalog
events/regions, scores escalation sentiment with a small lexicon, and writes
news.json for the dashboard.

Quality filter = domain whitelist: an article only appears if its source
domain is in WHITELIST.

Usage:
  python pipeline/build_news.py            # needs dashboard/public/data/catalog.json
  python pipeline/build_news.py --max 400
"""
import argparse
import hashlib
import json
import math
import re
import time
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from pathlib import Path

import requests

# ── Source whitelist (the quality filter) ─────────────────────────────────────
WHITELIST = {
    "reuters.com":      "Reuters",
    "apnews.com":       "AP",
    "bbc.com":          "BBC",
    "bbc.co.uk":        "BBC",
    "aljazeera.com":    "Al Jazeera",
    "theguardian.com":  "The Guardian",
    "dw.com":           "DW",
    "france24.com":     "France 24",
}

DIRECT_FEEDS = [
    "https://feeds.bbci.co.uk/news/world/rss.xml",
    "https://www.aljazeera.com/xml/rss/all.xml",
    "https://www.theguardian.com/world/rss",
    "https://rss.dw.com/rdf/rss-en-world",
    "https://www.france24.com/en/rss",
]

# Google News topic searches (rounded out with region tagging keywords below).
# Google News aggregates Reuters/AP which have no free direct feeds.
GNEWS_QUERIES = [
    "Taiwan China military",
    "Ukraine Russia war",
    "Iran nuclear deal",
    "Israel Lebanon Hezbollah",
    "Strait of Hormuz shipping",
    "North Korea missile",
    "Iran regime Khamenei",
    "Venezuela Maduro",
    "NATO Russia Europe",
    "China Philippines South China Sea",
]

# ── Region tagging: keyword regex → region id (must mirror catalog regions) ──
REGION_PATTERNS = [
    ("taiwan",   r"\btaiwan|taipei\b"),
    ("ukraine",  r"\bukrain|kyiv|zelensk|donbas|donetsk|crimea|kharkiv\b"),
    ("iran",     r"\biran|khamenei|tehran|pahlavi\b"),
    ("levant",   r"\bisrael|lebanon|hezbollah|syria|gaza|beirut|netanyahu\b"),
    ("gulf",     r"\bhormuz|saudi|yemen|houthi|qatar|iraq|gulf\b"),
    ("korea",    r"\bnorth korea|south korea|kim jong|pyongyang|seoul\b"),
    ("china",    r"\bchina|chinese|beijing|xi jinping\b"),
    ("s_asia",   r"\bindia|pakistan|kashmir\b"),
    ("asia_pac", r"\bphilippin|japan|south china sea|indo-pacific|australia\b"),
    ("russia",   r"\brussia|putin|moscow|kremlin\b"),
    ("europe",   r"\bnato\b|\beu\b|europe|germany|france|poland|moldova|baltics\b"),
    ("latam",    r"\bvenezuela|cuba|maduro|caracas|havana\b"),
    ("africa",   r"\bafrica|sudan|libya|sahel|nigeria|ethiopia\b"),
]

# ── Escalation sentiment lexicon ──────────────────────────────────────────────
# negative = escalation ("hot"), positive = de-escalation ("cool")
HOT_WORDS = {
    "war": -2, "invasion": -3, "invade": -3, "invades": -3, "strike": -2,
    "strikes": -2, "attack": -2, "attacks": -2, "attacked": -2, "bomb": -3,
    "bombing": -3, "bombs": -3, "missile": -2, "missiles": -2, "drone": -1,
    "drones": -1, "shelling": -2, "offensive": -2, "escalation": -2,
    "escalates": -2, "clash": -2, "clashes": -2, "casualties": -2, "killed": -2,
    "dead": -2, "deaths": -2, "blockade": -2, "sanctions": -1, "warning": -1,
    "warns": -1, "threat": -2, "threatens": -2, "threatening": -2, "nuclear": -1,
    "warhead": -2, "mobilization": -2, "troops": -1, "seize": -2, "seizes": -2,
    "captures": -2, "captured": -2, "coup": -2, "assassination": -3, "crisis": -1,
    "collapse": -2, "explosion": -2, "raid": -2, "incursion": -2, "hostilities": -2,
    "ultimatum": -2, "retaliation": -2, "retaliate": -2, "airstrike": -3,
    "airstrikes": -3, "shot": -2, "wounded": -2, "evacuate": -1, "evacuation": -1,
}
COOL_WORDS = {
    "ceasefire": 3, "truce": 3, "peace": 2, "deal": 1, "agreement": 2,
    "agrees": 2, "agreed": 2, "talks": 1, "negotiations": 1, "negotiate": 1,
    "diplomacy": 2, "diplomatic": 1, "summit": 1, "accord": 2, "treaty": 2,
    "de-escalation": 3, "withdraw": 1, "withdrawal": 1, "normalize": 2,
    "normalization": 2, "resume": 1, "reopens": 2, "reopen": 2, "stabilize": 2,
    "breakthrough": 2, "compromise": 2, "settlement": 2, "signed": 1, "signs": 1,
    "recognize": 1, "cooperation": 2, "dialogue": 1, "concessions": 1,
    "release": 1, "released": 1, "aid": 1, "humanitarian": 1,
}

STOPWORDS = {
    "will", "the", "a", "an", "of", "to", "in", "on", "by", "before", "after",
    "and", "or", "for", "with", "as", "out", "at", "be", "is", "are", "do",
    "does", "any", "all", "who", "what", "which", "when", "again", "next",
    "new", "end", "leader", "president", "prime", "minister", "country",
    "2025", "2026", "2027", "another", "part", "full", "official", "officially",
}


def _norm_domain(url: str) -> str:
    m = re.search(r"https?://(?:www\.)?([^/]+)/?", url or "")
    if not m:
        return ""
    host = m.group(1).lower()
    parts = host.split(".")
    return ".".join(parts[-2:]) if len(parts) >= 2 else host


def _parse_when(s: str) -> datetime | None:
    if not s:
        return None
    try:
        return parsedate_to_datetime(s).astimezone(timezone.utc)
    except (ValueError, TypeError):
        pass
    try:
        return datetime.fromisoformat(s.replace("Z", "+00:00")).astimezone(timezone.utc)
    except ValueError:
        return None


def _strip_ns(tag: str) -> str:
    return tag.rsplit("}", 1)[-1].lower()


def parse_feed(xml_text: str) -> list[dict]:
    """Tolerant RSS/RDF/Atom parser using stdlib only."""
    out = []
    try:
        root = ET.fromstring(xml_text)
    except ET.ParseError:
        return out
    for el in root.iter():
        if _strip_ns(el.tag) not in ("item", "entry"):
            continue
        title = link = pub = src_name = src_url = desc = ""
        for c in el:
            t = _strip_ns(c.tag)
            if t == "title":
                title = (c.text or "").strip()
            elif t == "link":
                link = (c.text or "").strip() or c.get("href", "")
            elif t in ("pubdate", "date", "published", "updated"):
                pub = pub or (c.text or "").strip()
            elif t == "source":
                src_name = (c.text or "").strip()
                src_url = c.get("url", "")
            elif t in ("description", "summary"):
                desc = (c.text or "").strip()
        if title and link:
            out.append({
                "title": title, "link": link, "pub": pub,
                "src_name": src_name, "src_url": src_url, "desc": desc,
            })
    return out


def sentiment(text: str) -> float:
    """Escalation score in [-1, 1]: negative = hot/escalatory, positive = cool."""
    words = re.findall(r"[a-z][a-z-]+", text.lower())
    score = sum(HOT_WORDS.get(w, 0) + COOL_WORDS.get(w, 0) for w in words)
    return round(math.tanh(score / 4.0), 3)


def event_keywords(events: list[dict]) -> list[tuple[str, set[str], str | None]]:
    """(event_id, significant tokens, region) tuples for headline matching."""
    out = []
    for e in events:
        toks = {
            w for w in re.findall(r"[a-z0-9][a-z0-9-]+", e["groupKey"])
            if w not in STOPWORDS and len(w) >= 3
        }
        if toks:
            out.append((e["id"], toks, e.get("region")))
    return out


def match_events(
    text: str,
    article_regions: list[str],
    ev_keys: list[tuple[str, set[str], str | None]],
    limit: int = 6,
) -> list[str]:
    words = set(re.findall(r"[a-z0-9][a-z0-9-]+", text.lower()))
    scored = []
    for eid, toks, region in ev_keys:
        # region gate: a located event only matches articles about that region
        if region and article_regions and region not in article_regions:
            continue
        hit = len(toks & words)
        if hit >= 2 or (hit == 1 and len(toks) == 1):
            scored.append((hit / len(toks), eid))
    scored.sort(reverse=True)
    return [eid for _, eid in scored[:limit]]


def match_regions(text: str) -> list[str]:
    low = text.lower()
    return [rid for rid, pat in REGION_PATTERNS if re.search(pat, low)]


def fetch(session: requests.Session, url: str) -> str:
    try:
        r = session.get(url, timeout=20)
        r.raise_for_status()
        return r.text
    except requests.RequestException as e:
        print(f"    ! feed failed: {url} ({e})")
        return ""


def build_news(catalog_path: Path, max_articles: int) -> dict:
    catalog = json.loads(catalog_path.read_text(encoding="utf-8"))
    ev_keys = event_keywords(catalog["events"])

    session = requests.Session()
    session.headers["User-Agent"] = "Mozilla/5.0 (geopol-hazard-dashboard news builder)"

    raw: list[dict] = []
    for url in DIRECT_FEEDS:
        print(f"  direct: {_norm_domain(url)}")
        for it in parse_feed(fetch(session, url)):
            it["domain"] = _norm_domain(it["link"]) or _norm_domain(url)
            raw.append(it)
        time.sleep(0.2)

    for q in GNEWS_QUERIES:
        print(f"  gnews : {q}")
        gurl = ("https://news.google.com/rss/search?q="
                + requests.utils.quote(f"{q} when:3d")
                + "&hl=en-US&gl=US&ceid=US:en")
        for it in parse_feed(fetch(session, gurl)):
            it["domain"] = _norm_domain(it["src_url"]) or _norm_domain(it["link"])
            # Google News titles end with " - Source"
            it["title"] = re.sub(r"\s+-\s+[^-]+$", "", it["title"])
            raw.append(it)
        time.sleep(0.3)

    seen_titles: set[str] = set()
    articles = []
    for it in raw:
        if it["domain"] not in WHITELIST:
            continue
        key = re.sub(r"[^a-z0-9]+", "", it["title"].lower())[:80]
        if not key or key in seen_titles:
            continue
        seen_titles.add(key)

        text = it["title"] + " " + it.get("desc", "")[:300]
        regions = match_regions(text)
        event_ids = match_events(text, regions, ev_keys)
        if not regions and not event_ids:
            continue  # not geopolitics-relevant to our catalog

        when = _parse_when(it["pub"])
        articles.append({
            "id": hashlib.sha1(key.encode()).hexdigest()[:12],
            "title": it["title"],
            "url": it["link"],
            "source": WHITELIST[it["domain"]],
            "publishedAt": when.isoformat(timespec="seconds") if when else None,
            "regions": regions,
            "eventIds": event_ids,
            "sentiment": sentiment(text),
        })

    articles.sort(key=lambda a: a["publishedAt"] or "", reverse=True)
    articles = articles[:max_articles]

    return {
        "generatedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "sources": sorted(set(WHITELIST.values())),
        "articles": articles,
    }


def main() -> None:
    ap = argparse.ArgumentParser(description="Build geopolitics news feed JSON")
    ap.add_argument("--max", type=int, default=400)
    ap.add_argument("--out", default=None)
    args = ap.parse_args()

    root = Path(__file__).resolve().parent.parent
    catalog_path = root / "dashboard" / "public" / "data" / "catalog.json"
    out_path = Path(args.out) if args.out else root / "dashboard" / "public" / "data" / "news.json"

    print("Building news feed")
    news = build_news(catalog_path, args.max)
    n = len(news["articles"])
    hot = sum(1 for a in news["articles"] if a["sentiment"] < -0.15)
    cool = sum(1 for a in news["articles"] if a["sentiment"] > 0.15)
    linked = sum(1 for a in news["articles"] if a["eventIds"])
    print(f"  {n} articles | {hot} hot / {cool} cool | {linked} linked to events")
    out_path.write_text(json.dumps(news, separators=(",", ":")), encoding="utf-8")
    print(f"  wrote {out_path} ({out_path.stat().st_size/1024:.0f} KB)")


if __name__ == "__main__":
    main()
