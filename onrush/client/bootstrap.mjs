import { SELECTED_KEYS } from '../shared/startup-policy.mjs';

// This entry has one bootstrap consumer and no persistent feed cache. Validate
// the response envelope explicitly: an HTTP 200 with missing seeds is useful
// evidence of a reachable reader, not of zero events or of fresh source data.
export async function readStartupSnapshot(fetcher = fetch) {
  const unavailable = () => ({ state: 'unavailable', received: [] });
  try {
    const response = await fetcher('/api/bootstrap?tier=fast&public=1', {
      credentials: 'omit', signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) return unavailable();
    const body = await response.json();
    if (!body || !body.data || typeof body.data !== 'object' || Array.isArray(body.data) || !Array.isArray(body.missing)) return unavailable();
    const received = Object.keys(body.data);
    const coverage = [...received, ...body.missing];
    if (coverage.length !== SELECTED_KEYS.length || new Set(coverage).size !== coverage.length
      || !coverage.every((key) => SELECTED_KEYS.includes(key)) || received.some((key) => body.data[key] == null)) return unavailable();
    return { state: received.length ? 'received' : 'missing', received };
  } catch { return unavailable(); }
}
