const LS_KEY = "geopol-watchlist";
const URL_PARAM = "w";

/** Load watchlist: URL param wins (shareable links), else localStorage. */
export function loadWatchlist(): string[] {
  const fromUrl = new URLSearchParams(window.location.search).get(URL_PARAM);
  if (fromUrl) {
    const ids = fromUrl.split(".").filter(Boolean);
    if (ids.length) {
      persist(ids); // adopt shared list locally
      return ids;
    }
  }
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) return JSON.parse(raw);
  } catch {
    /* corrupted storage — start fresh */
  }
  return [];
}

export function persist(ids: string[]): void {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(ids));
  } catch {
    /* storage unavailable (private mode) — URL sharing still works */
  }
  const url = new URL(window.location.href);
  if (ids.length) url.searchParams.set(URL_PARAM, ids.join("."));
  else url.searchParams.delete(URL_PARAM);
  window.history.replaceState(null, "", url.toString());
}

export function shareUrl(ids: string[]): string {
  const url = new URL(window.location.href);
  if (ids.length) url.searchParams.set(URL_PARAM, ids.join("."));
  else url.searchParams.delete(URL_PARAM);
  return url.toString();
}
