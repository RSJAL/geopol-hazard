# Geopol Hazard Monitor

Polymarket geopolitics dashboard. **Read `PROGRESS.md` first** — it has the full
project outline, design decisions, odds math, map-anchoring rules, API facts,
operational gotchas, and roadmap.

Quick facts:
- Live: https://rsjal.github.io/geopol-hazard/ · Repo: RSJAL/geopol-hazard (public)
- Frontend: `dashboard/` (React+Vite+TS) — `cd dashboard && npm run dev|build`
- Data: `python pipeline/build_catalog.py` then `python pipeline/build_news.py`
  (writes to `dashboard/public/data/`); a 30-min GitHub Actions cron does the same
  and triggers the Pages deploy. build_news also pulls 16 whitelisted X accounts
  via nitter.net (fails soft per account if the mirror is down).
- Private design docs live in `Design Docs/*.docx` (gitignored); legacy Streamlit
  prototype in `v1/` (kept, unused).
- Always `git pull --rebase` before pushing (catalog bot commits to main every
  30 min). In rebase conflicts on the data JSONs: `--ours` = the bot's side,
  `--theirs` = your commit — take `--theirs` when your commit changed the
  pipeline/schema (the next cron refreshes prices anyway).
- PowerShell 5.1 mangles quoted `git commit -m` messages — use `git commit -F <file>`.
- Verify UI changes with headless Chrome screenshots against `vite preview`
  (use a fresh port; stopped preview tasks can orphan node servers that serve
  stale builds — kill via `Get-NetTCPConnection -LocalPort <p> | Stop-Process`).
  Append `?demo=1` to seed in-memory sample bets so the bets/portfolio UI is
  headless-verifiable. Routes: `#/markets` (Browse layout; `#/browse` legacy
  alias), `#/portfolio`, `#/event/:id`.
- Odds convention: total odds are the display default; daily odds are
  compounded (`1 − (1−P)^(1/days)`), never `P/days`.
