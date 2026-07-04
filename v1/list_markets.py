"""
Inspection tool: list static and live-fetched geopolitical markets.

Modes:
  python list_markets.py           live markets from Gamma API
  python list_markets.py static    static markets from data.py
  python list_markets.py both      both sources, side by side
  python list_markets.py new       live-only (not covered in static data)
"""
import sys
from datetime import date

from data import MARKETS as STATIC_MARKETS, REFERENCE_DATE, enrich
from live_data import fetch_live_markets

W = 72


def _bar(v: float, peak: float, width: int = 18) -> str:
    filled = round(v / peak * width) if peak > 0 else 0
    return "#" * filled + "." * (width - filled)


def print_market(m: dict, label: str = "") -> None:
    em = enrich(m) if "peak_impl" not in m else m
    src = f"[{label}]  " if label else ""
    print(f"\n{src}{em['name']}")
    print(f"  Category: {em['category']}")
    if em.get("source") == "live":
        total_vol = sum(r.get("volume", 0) for r in em["rows"])
        print(f"  Volume:   ${total_vol:,.0f} (all horizons combined)")
    peak = em.get("peak_impl", max(r["impl_daily"] for r in em["rows"]))

    print(f"  {'Deadline':<18} {'YES%':>6}  {'Days':>5}  {'Impl/d':>8}  {'Marg/d':>8}  Chart")
    print(f"  {'-'*18} {'-'*6}  {'-'*5}  {'-'*8}  {'-'*8}  {'-'*18}")
    for i, r in enumerate(em["rows"]):
        flags: list[str] = []
        if r.get("is_peak"):
            flags.append("PEAK")
        if r.get("is_inversion"):
            flags.append("INV")
        if i > 0 and r["marg_daily"] < r["impl_daily"] * 0.4:
            flags.append("CHEAP")
        bar = _bar(r["impl_daily"], peak)
        flag_str = " ".join(flags)
        print(
            f"  {r['label']:<18} {r['yes']:>5.1f}%  {r['days']:>5}  "
            f"{r['impl_daily']:>7.4f}%  {r['marg_daily']:>7.4f}%  {bar}  {flag_str}"
        )


def section(title: str) -> None:
    print(f"\n{'='*W}")
    print(f"  {title}")
    print(f"{'='*W}")


def main() -> None:
    mode = (sys.argv[1].lower() if len(sys.argv) > 1 else "live")

    if mode in ("static", "both"):
        section(f"STATIC MARKETS  - data.py  (reference: {REFERENCE_DATE})")
        for m in STATIC_MARKETS:
            print_market(m, "static")

    if mode in ("live", "both"):
        section(f"LIVE MARKETS  - Gamma API  (reference: {date.today()})")
        print("  Fetching ...", flush=True)
        live = fetch_live_markets()
        n_pts = sum(len(m["rows"]) for m in live)
        print(f"  {len(live)} events  |  {n_pts} horizon points\n")
        for m in sorted(live, key=lambda x: (x["category"], x["name"])):
            print_market(m, "live")
        print(f"\n  Total: {len(live)} events, {n_pts} horizon points")

    if mode == "new":
        section("LIVE-ONLY  - events not covered in static data")
        static_names = {m["name"].lower() for m in STATIC_MARKETS}
        print("  Fetching ...", flush=True)
        live = fetch_live_markets()
        new = [
            m for m in live
            if not any(
                sn in m["name"].lower() or m["name"].lower() in sn
                for sn in static_names
            )
        ]
        print(f"  {len(new)} events not covered by static data\n")
        for m in sorted(new, key=lambda x: (x["category"], x["name"])):
            print_market(m, "new")
        print(f"\n  Total: {len(new)} new events")

    print()


if __name__ == "__main__":
    main()
