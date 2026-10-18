import { EARTHQUAKE_PATH, REFRESH_MS, assessEarthquakeSnapshot } from '../shared/earthquakes.mjs';

// No disk cache: a failed read retains only this page's bounded last good
// snapshot, and never advances its source/retrieval clocks.
export function createEarthquakeFeed(onChange, { fetcher = (...args) => fetch(...args), now = Date.now } = {}) {
  let lastGood = null;
  let readState = 'loading';
  let lastAttempt = -Infinity;
  let pending;
  let stopped = false;
  function report() {
    if (stopped) return;
    const assessed = lastGood ? assessEarthquakeSnapshot(lastGood, now()) : null;
    const snapshot = assessed && ['fresh', 'stale'].includes(assessed.state) ? lastGood : null;
    onChange({ state: readState === 'unavailable' ? 'unavailable'
      : assessed?.state === 'expired' ? 'expired' : snapshot ? assessed.state : readState, snapshot });
  }
  function refresh() {
    if (pending || stopped) return pending;
    lastAttempt = now();
    pending = (async () => {
      try {
        const response = await fetcher(EARTHQUAKE_PATH, { credentials: 'include', signal: AbortSignal.timeout(10_000) });
        if (!response.ok) throw new Error('Reader unavailable');
        const body = await response.json();
        if (body?.state === 'missing' && !body.earthquakes && !body._onrush) {
          lastGood = null;
          readState = 'missing';
        } else {
          const assessed = assessEarthquakeSnapshot(body, now());
          if (!['fresh', 'stale'].includes(assessed.state)) throw new Error('Snapshot unavailable');
          lastGood = body;
          readState = assessed.state;
        }
      } catch { readState = 'unavailable'; }
      finally { pending = undefined; report(); }
    })();
    return pending;
  }
  return { refresh, reassess: report,
    tick() { report(); if (now() - lastAttempt >= REFRESH_MS) return refresh(); },
    stop() { stopped = true; },
  };
}
