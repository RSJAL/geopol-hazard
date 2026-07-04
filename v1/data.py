from datetime import date

REFERENCE_DATE = date(2026, 7, 1)

MARKETS = [
    {
        "name": "China Invades Taiwan",
        "category": "Military Conflict",
        "rows": [
            {"label": "By Dec 31 2026",  "yes": 4,  "days": 183},
            {"label": "By Jun 30 2027",  "yes": 12, "days": 364},
            {"label": "By Dec 31 2027",  "yes": 13, "days": 548},
        ],
    },
    {
        "name": "Strait of Hormuz Normalisation",
        "category": "Economic / Shipping",
        "rows": [
            {"label": "By Jul 7",  "yes": 1,  "days": 6},
            {"label": "By Jul 15", "yes": 14, "days": 14},
            {"label": "By Jul 31", "yes": 30, "days": 30},
            {"label": "By Dec 31", "yes": 83, "days": 183},
        ],
    },
    {
        "name": "US–Iran Final Nuclear Deal",
        "category": "Diplomacy",
        "rows": [
            {"label": "By Jul 31", "yes": 2,  "days": 30},
            {"label": "By Aug 13", "yes": 9,  "days": 43},
            {"label": "By Aug 18", "yes": 20, "days": 48},
            {"label": "By Aug 31", "yes": 24, "days": 61},
            {"label": "By Sep 30", "yes": 32, "days": 91},
            {"label": "By Dec 31", "yes": 47, "days": 183},
        ],
    },
    {
        "name": "Russia Nuclear Test",
        "category": "Military / Nuclear",
        "rows": [
            {"label": "By Sep 30", "yes": 3, "days": 91},
            {"label": "By Dec 31", "yes": 9, "days": 183},
        ],
    },
    {
        "name": "Israel Airspace Closure",
        "category": "Military Conflict",
        "rows": [
            {"label": "By Jul 7",  "yes": 1,  "days": 6},
            {"label": "By Jul 15", "yes": 3,  "days": 14},
            {"label": "By Jul 31", "yes": 8,  "days": 30},
            {"label": "By Aug 31", "yes": 15, "days": 61},
        ],
    },
    {
        "name": "Russia Captures Kostyantynivka",
        "category": "Military Conflict",
        "rows": [
            {"label": "By Jul 31", "yes": 34, "days": 30},
            {"label": "By Sep 30", "yes": 69, "days": 91},
            {"label": "By Dec 31", "yes": 83, "days": 183},
        ],
    },
    {
        "name": "Mojtaba Khamenei Public Appearance",
        "category": "Leadership",
        "rows": [
            {"label": "By Jul 15", "yes": 22, "days": 14},
            {"label": "By Jul 31", "yes": 27, "days": 30},
            {"label": "By Aug 31", "yes": 36, "days": 61},
            {"label": "By Sep 30", "yes": 44, "days": 91},
        ],
    },
    {
        "name": "Iran Leadership Change",
        "category": "Leadership",
        "rows": [
            {"label": "By Jul 31",      "yes": 3,  "days": 30},
            {"label": "By Sep 30",      "yes": 7,  "days": 91},
            {"label": "By Dec 31",      "yes": 16, "days": 183},
            {"label": "By Jun 30 2027", "yes": 25, "days": 364},
        ],
    },
    {
        "name": "Next Round US–Iran Peace Talks",
        "category": "Diplomacy",
        "rows": [
            {"label": "By Jul 3",  "yes": 5,  "days": 2},
            {"label": "By Jul 10", "yes": 12, "days": 9},
            {"label": "By Jul 17", "yes": 35, "days": 16},
            {"label": "By Jul 31", "yes": 65, "days": 30},
        ],
    },
    {
        "name": "Iran Surrenders Uranium Stockpile",
        "category": "Diplomacy / Nuclear",
        "rows": [
            {"label": "By Jul 31", "yes": 2,  "days": 30},
            {"label": "By Dec 31", "yes": 18, "days": 183},
        ],
    },
]


def enrich(market: dict) -> dict:
    """Add computed fields: impl_daily, marg_daily, marginal, anomaly flags."""
    rows = market["rows"]
    enriched = []
    prev_yes  = 0
    prev_days = 0
    prev_impl = None
    impl_values = [r["yes"] / r["days"] for r in rows]
    peak_impl   = max(impl_values)

    for row in rows:
        impl       = row["yes"] / row["days"]
        marg       = row["yes"] - prev_yes
        delta_days = row["days"] - prev_days
        # first row: marginal window == full window, so marg_daily == impl_daily
        marg_daily = marg / delta_days if delta_days > 0 else impl

        is_peak      = abs(impl - peak_impl) < 1e-9
        is_inversion = prev_impl is not None and impl < prev_impl

        enriched.append({
            **row,
            "marginal":     marg,
            "impl_daily":   impl,
            "marg_daily":   marg_daily,
            "is_peak":      is_peak,
            "is_inversion": is_inversion,
        })
        prev_yes  = row["yes"]
        prev_days = row["days"]
        prev_impl = impl

    return {**market, "rows": enriched, "peak_impl": peak_impl}


ENRICHED_MARKETS = [enrich(m) for m in MARKETS]
