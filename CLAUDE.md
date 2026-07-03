# Geopol Hazard Monitor

Polymarket geopolitics dashboard. **Read `PROGRESS.md` first** — it has the full
project outline, design decisions, API facts, operational gotchas, and roadmap.

Quick facts:
- Live: https://rsjal.github.io/geopol-hazard/ · Repo: RSJAL/geopol-hazard (public)
- Frontend: `dashboard/` (React+Vite+TS) — `cd dashboard && npm run dev|build`
- Data: `python pipeline/build_catalog.py` then `python pipeline/build_news.py`
  (writes to `dashboard/public/data/`); a 30-min GitHub Actions cron does the same
  and triggers the Pages deploy.
- The `*.docx` design docs are intentionally gitignored (private roadmap).
- Always `git pull --rebase` before pushing (catalog bot commits to main every
  30 min; in rebase conflicts `--ours` = the bot's side).
- Verify UI changes with headless Chrome screenshots against `vite preview`.
