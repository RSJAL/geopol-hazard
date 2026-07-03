import streamlit as st
import plotly.graph_objects as go
from plotly.subplots import make_subplots
from data import ENRICHED_MARKETS, REFERENCE_DATE

# ── Page config ───────────────────────────────────────────────────────────────
st.set_page_config(
    page_title="Geopol Hazard Monitor",
    page_icon="🌍",
    layout="wide",
    initial_sidebar_state="collapsed",
)

# ── Palette ───────────────────────────────────────────────────────────────────
C_BG     = "#0f1117"
C_PANEL  = "#1a1d2e"
C_GRID   = "#2a2d3e"
C_HEAD   = "#0d0f18"
C_ACCENT = "#4fc3f7"
C_SPIKE  = "#ff6b6b"
C_INV    = "#ffa726"
C_NORM   = "#4fc3f7"
C_TEXT   = "#e0e0e0"
C_MUTED  = "#888888"

# ── Global CSS (page skeleton only — no table CSS needed) ─────────────────────
st.markdown(f"""
<style>
  .stApp {{ background-color: {C_BG}; }}
  .block-container {{ padding-top: 1rem; padding-bottom: 2rem; }}
  #MainMenu, footer, header {{ visibility: hidden; }}

  .dash-header {{
      background: {C_PANEL}; border-bottom: 1px solid {C_GRID};
      padding: 0.75rem 1.5rem; border-radius: 8px; margin-bottom: 1rem;
      display: flex; justify-content: space-between; align-items: center;
  }}
  .dash-title  {{ font-size:1.35rem; font-weight:700; color:{C_ACCENT};
                  letter-spacing:.04em; margin:0; }}
  .dash-sub    {{ font-size:.75rem; color:{C_MUTED}; margin:0; }}

  .metric-tile {{
      background:{C_PANEL}; border:1px solid {C_GRID}; border-radius:8px;
      padding:.7rem 1rem; text-align:center;
  }}
  .metric-label {{ font-size:.68rem; color:{C_MUTED}; text-transform:uppercase;
                   letter-spacing:.06em; }}
  .metric-value {{ font-size:1.3rem; font-weight:700; margin-top:.15rem; }}
  .metric-sub   {{ font-size:.70rem; color:{C_MUTED}; margin-top:.1rem; }}

  .card-header {{
      background:{C_PANEL}; border:1px solid {C_GRID}; border-radius:8px 8px 0 0;
      padding:.6rem 1rem .4rem; margin-bottom:0;
  }}
  .card-title {{ font-size:.85rem; font-weight:700; color:{C_TEXT}; margin:0; }}
  .card-cat   {{ font-size:.67rem; color:{C_MUTED}; text-transform:uppercase;
                 letter-spacing:.06em; margin:.15rem 0 0; }}

  .badge     {{ display:inline-block; font-size:.60rem; padding:1px 5px;
                border-radius:3px; font-weight:600; letter-spacing:.04em;
                margin-left:6px; vertical-align:middle; }}
  .badge-inv {{ background:{C_INV}22; color:{C_INV}; border:1px solid {C_INV}66; }}

  .legend-bar {{
      display:flex; gap:1.2rem; font-size:.72rem; color:{C_MUTED};
      margin-bottom:.6rem;
  }}

  .obs-box {{
      background:{C_PANEL}; border:1px solid {C_GRID}; border-radius:8px;
      padding:1rem 1.4rem; margin-top:.5rem;
  }}
  .obs-title {{ font-size:.85rem; font-weight:700; color:{C_ACCENT};
                margin-bottom:.6rem; }}
  .obs-grid  {{ display:grid; grid-template-columns:1fr 1fr; gap:.8rem;
                font-size:.76rem; color:{C_TEXT}; }}

  .dash-footer {{
      text-align:center; color:{C_MUTED}; font-size:.67rem;
      margin-top:1.5rem; padding-top:.5rem; border-top:1px solid {C_GRID};
  }}
  .stPlotlyChart {{ border:none !important; }}
</style>
""", unsafe_allow_html=True)


# ── Plotly figure: table (left) + bar (right) ─────────────────────────────────
def make_market_figure(market: dict) -> go.Figure:
    rows = market["rows"]
    n    = len(rows)

    deadlines  = [r["label"] for r in rows]
    yes_vals   = [f"{r['yes']}%" for r in rows]
    marg_vals  = [
        f"+{r['marginal']}%" if r["marginal"] != r["yes"] else f"{r['marginal']}%"
        for r in rows
    ]
    days_vals  = [f"{r['days']}d" for r in rows]
    impl_vals  = [f"{r['impl_daily']:.3f}%" for r in rows]
    # first row has no prior deadline, so marginal daily == implied daily — mark with em-dash
    marg_d_vals = [
        "—" if i == 0 else f"{r['marg_daily']:.3f}%"
        for i, r in enumerate(rows)
    ]

    fill_impl  = []
    font_impl  = []
    fill_marg  = []
    font_marg  = []
    bar_colors = []

    marg_dailies = [r["marg_daily"] for r in rows]
    peak_marg    = max(marg_dailies)

    for i, r in enumerate(rows):
        # implied daily colouring (cumulative)
        if r["is_peak"]:
            fill_impl.append("#2d1515");  font_impl.append(C_SPIKE)
            bar_colors.append(C_SPIKE)
        elif r["is_inversion"]:
            fill_impl.append("#2d2210");  font_impl.append(C_INV)
            bar_colors.append(C_INV)
        else:
            fill_impl.append(C_PANEL);   font_impl.append(C_TEXT)
            bar_colors.append(C_NORM)

        # marginal daily colouring — highlight cheap incremental windows
        if i == 0:
            fill_marg.append(C_PANEL);   font_marg.append(C_MUTED)
        elif abs(r["marg_daily"] - peak_marg) < 1e-9:
            fill_marg.append("#2d1515");  font_marg.append(C_SPIKE)
        elif r["marg_daily"] < r["impl_daily"] * 0.4:
            fill_marg.append("#102d20");  font_marg.append("#66bb6a")  # cheap: green
        else:
            fill_marg.append(C_PANEL);   font_marg.append(C_TEXT)

    fig = make_subplots(
        rows=1, cols=2,
        column_widths=[0.62, 0.38],
        specs=[[{"type": "table"}, {"type": "bar"}]],
        horizontal_spacing=0.02,
    )

    # ── Table ─────────────────────────────────────────────────────────────────
    fig.add_trace(go.Table(
        header=dict(
            values=["<b>Deadline</b>", "<b>YES</b>", "<b>Marg</b>",
                    "<b>Days</b>", "<b>Impl/day</b>", "<b>Marg/day</b>"],
            fill_color=C_HEAD,
            align=["left", "right", "right", "right", "right", "right"],
            font=dict(color=C_MUTED, size=10),
            line_color=C_GRID,
            height=24,
        ),
        cells=dict(
            values=[deadlines, yes_vals, marg_vals, days_vals, impl_vals, marg_d_vals],
            fill_color=[
                [C_PANEL] * n,
                [C_PANEL] * n,
                [C_PANEL] * n,
                [C_PANEL] * n,
                fill_impl,
                fill_marg,
            ],
            align=["left", "right", "right", "right", "right", "right"],
            font=dict(
                color=[[C_MUTED]*n, [C_TEXT]*n, [C_TEXT]*n,
                       [C_TEXT]*n, font_impl, font_marg],
                size=11,
            ),
            line_color=C_GRID,
            height=27,
        ),
    ), row=1, col=1)

    # ── Bar chart ─────────────────────────────────────────────────────────────
    impl_numeric = [r["impl_daily"] for r in rows]

    fig.add_trace(go.Bar(
        x=deadlines,
        y=impl_numeric,
        marker_color=bar_colors,
        marker_line_width=0,
        text=[f"{v:.3f}%" for v in impl_numeric],
        textposition="outside",
        textfont=dict(size=9, color=C_TEXT),
        hovertemplate="%{x}<br>Implied daily: %{y:.4f}%<extra></extra>",
    ), row=1, col=2)

    height = max(190, n * 33 + 80)

    fig.update_layout(
        paper_bgcolor=C_PANEL,
        plot_bgcolor="rgba(0,0,0,0)",
        margin=dict(l=6, r=10, t=6, b=6),
        height=height,
        showlegend=False,
    )
    fig.update_xaxes(
        row=1, col=2,
        tickfont=dict(size=8, color=C_MUTED),
        tickangle=-35,
        showgrid=False,
        zeroline=False,
        linecolor=C_GRID,
    )
    fig.update_yaxes(
        row=1, col=2,
        tickfont=dict(size=8, color=C_MUTED),
        tickformat=".3f",
        showgrid=True,
        gridcolor=C_GRID,
        zeroline=False,
    )
    return fig


# ── Summary anomaly helpers ───────────────────────────────────────────────────
def _anomaly_stats():
    spike_ratio = 0
    spike_name  = ""
    total_inv   = 0
    for m in ENRICHED_MARKETS:
        impls = [r["impl_daily"] for r in m["rows"]]
        if len(impls) >= 2:
            r = max(impls) / (min(impls) + 1e-9)
            if r > spike_ratio:
                spike_ratio = r
                spike_name  = m["name"]
        total_inv += sum(1 for r in m["rows"] if r["is_inversion"])
    return spike_ratio, spike_name, total_inv


# ════════════════════════════════════════════════════════════════════════════════
#  RENDER
# ════════════════════════════════════════════════════════════════════════════════

# ── Header ────────────────────────────────────────────────────────────────────
st.markdown(f"""
<div class="dash-header">
  <div>
    <p class="dash-title">🌍 POLYMARKET GEOPOLITICAL HAZARD MONITOR</p>
    <p class="dash-sub">
      Implied daily probability by market horizon &nbsp;·&nbsp;
      Cumulative YES% ÷ days from reference date
    </p>
  </div>
  <div style="text-align:right">
    <p class="dash-sub" style="color:{C_ACCENT}; font-size:.85rem; font-weight:600;">
      Reference date: {REFERENCE_DATE.strftime('%b %d, %Y')}
    </p>
    <p class="dash-sub">
      {len(ENRICHED_MARKETS)} markets &nbsp;·&nbsp;
      {sum(len(m['rows']) for m in ENRICHED_MARKETS)} horizon points
    </p>
  </div>
</div>
""", unsafe_allow_html=True)

# ── Summary tiles ─────────────────────────────────────────────────────────────
spike_r, spike_n, total_inv = _anomaly_stats()
t1, t2, t3, t4 = st.columns(4)

with t1:
    st.markdown(f"""
    <div class="metric-tile">
      <div class="metric-label">Markets Tracked</div>
      <div class="metric-value" style="color:{C_ACCENT};">{len(ENRICHED_MARKETS)}</div>
      <div class="metric-sub">{sum(len(m['rows']) for m in ENRICHED_MARKETS)} horizon pts</div>
    </div>""", unsafe_allow_html=True)

with t2:
    st.markdown(f"""
    <div class="metric-tile">
      <div class="metric-label">Sharpest Spike</div>
      <div class="metric-value" style="color:{C_SPIKE};">{spike_r:.0f}×</div>
      <div class="metric-sub">{spike_n[:26]}</div>
    </div>""", unsafe_allow_html=True)

with t3:
    st.markdown(f"""
    <div class="metric-tile">
      <div class="metric-label">Inversions Detected</div>
      <div class="metric-value" style="color:{C_INV};">{total_inv}</div>
      <div class="metric-sub">rate↓ as horizon extends</div>
    </div>""", unsafe_allow_html=True)

with t4:
    st.markdown(f"""
    <div class="metric-tile">
      <div class="metric-label">Q4 Iran Cluster</div>
      <div class="metric-value" style="color:{C_INV};">3</div>
      <div class="metric-sub">markets w/ rising Q4 hazard</div>
    </div>""", unsafe_allow_html=True)

# ── Legend ────────────────────────────────────────────────────────────────────
st.markdown(f"""
<div class="legend-bar" style="margin-top:.7rem;">
  <span><span style="color:{C_SPIKE}; font-weight:700;">■</span>&nbsp;Peak implied daily for market</span>
  <span><span style="color:{C_INV}; font-weight:700;">■</span>&nbsp;Inversion — rate falls as horizon extends</span>
  <span><span style="color:{C_NORM}; font-weight:700;">■</span>&nbsp;Normal</span>
  <span style="margin-left:auto; font-style:italic; font-size:.70rem;">
    Implied daily = cumulative YES% ÷ days from {REFERENCE_DATE.strftime('%b %d')}
  </span>
</div>
""", unsafe_allow_html=True)

# ── Market panels — 2 per row ─────────────────────────────────────────────────
pairs = [ENRICHED_MARKETS[i:i+2] for i in range(0, len(ENRICHED_MARKETS), 2)]

for pair in pairs:
    cols = st.columns(2)
    for col, market in zip(cols, pair):
        with col:
            n_inv  = sum(1 for r in market["rows"] if r["is_inversion"])
            badges = f'<span class="badge badge-inv">{n_inv} INV</span>' if n_inv else ""
            st.markdown(f"""
            <div class="card-header">
              <p class="card-title">{market['name']}{badges}</p>
              <p class="card-cat">{market['category']}</p>
            </div>
            """, unsafe_allow_html=True)
            st.plotly_chart(
                make_market_figure(market),
                use_container_width=True,
                config={"displayModeBar": False},
            )

# ── Cross-market observations ─────────────────────────────────────────────────
st.markdown(f"""
<div class="obs-box">
  <div class="obs-title">⚡ Cross-Market Observations</div>
  <div class="obs-grid">
    <div>
      <span style="color:{C_INV}; font-weight:600;">Q4 Iran cluster:</span>
      Russia Nuclear Test, Iran Leadership Change, and Iran Uranium Surrender
      all show a higher implied daily in Q4 vs Q3 — consistent with a shared
      catalyst (nuclear deal aftermath, UN General Assembly, post-summer
      diplomatic window).
    </div>
    <div>
      <span style="color:{C_SPIKE}; font-weight:600;">Mid-July spike correlation:</span>
      Khamenei Appearance peaks at 1.571%/d before Jul 15, and US–Iran Peace
      Talks spikes at 3.286%/d marginal for Jul 11–17. Likely the same
      scheduled event — a talks round where Khamenei makes his first public
      appearance.
    </div>
    <div>
      <span style="color:{C_INV}; font-weight:600;">Taiwan H2 2027 dilution:</span>
      "By Dec 31 2027" implies 0.024%/d — lower than "By Jun 30 2027"
      (0.033%/d). Adding 6 months dilutes the per-day rate; H2 2027 invasion
      risk is priced near zero. Spread trade: long Dec 27 / short Jun 27
      for 1¢.
    </div>
    <div>
      <span style="color:{C_SPIKE}; font-weight:600;">Hormuz Jul 7 anomaly:</span>
      At 0.167%/d the first 6 days are priced at 1/6th the Jul 8–15 rate
      (1.000%/d). Under constant hazard vs the Jul 15 market, Jul 7 YES
      should be ~6¢ not 1¢. Likely reflects physical constraints
      (mine clearance timeline).
    </div>
  </div>
</div>

<div class="dash-footer">
  Data: Polymarket &nbsp;·&nbsp; Reference date: {REFERENCE_DATE.strftime('%B %d, %Y')}
  &nbsp;·&nbsp; Implied daily = cumulative YES% ÷ days from reference
  &nbsp;·&nbsp; <span style="color:{C_SPIKE};">■</span> PEAK = highest implied daily per market
  &nbsp;·&nbsp; <span style="color:{C_INV};">■</span> INV = rate falls as horizon extends
</div>
""", unsafe_allow_html=True)
