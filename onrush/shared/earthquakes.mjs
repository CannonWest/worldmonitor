// USGS-only first live slice. Keep the upstream Earthquake payload shape so
// MapContainer's existing SVG and deck.gl renderers consume the same records.
export const EARTHQUAKE_KEY = 'seismology:earthquakes:v1';
export const EARTHQUAKE_META_KEY = 'seed-meta:seismology:earthquakes';
export const EARTHQUAKE_PATH = '/api/seismology/v1/list-earthquakes';
export const USGS_URL = 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/4.5_week.geojson';
export const REFRESH_MS = 5 * 60_000;
export const FRESH_MS = 15 * 60_000;
export const RETAIN_MS = 6 * 60 * 60_000;
export const WINDOW_MS = 7 * 24 * 60 * 60_000;
export const MAX_EVENTS = 1000;
const SKEW_MS = 5 * 60_000;

export function validUsgsUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname === 'earthquake.usgs.gov'
      && !url.port && !url.username && !url.password;
  } catch { return false; }
}

export function validEarthquake(eq, generatedAt) {
  return eq && typeof eq.id === 'string' && /^[a-zA-Z0-9:_-]{1,120}$/.test(eq.id)
    && typeof eq.place === 'string' && eq.place.length <= 500
    && Number.isFinite(eq.magnitude) && eq.magnitude >= 4.5 && eq.magnitude <= 10
    && Number.isFinite(eq.depthKm) && eq.depthKm >= -20 && eq.depthKm <= 1000
    && Number.isFinite(eq.location?.latitude) && Math.abs(eq.location.latitude) <= 90
    && Number.isFinite(eq.location?.longitude) && Math.abs(eq.location.longitude) <= 180
    && Number.isSafeInteger(eq.occurredAt) && eq.occurredAt >= generatedAt - WINDOW_MS - SKEW_MS
    && eq.occurredAt <= generatedAt + SKEW_MS && eq.source === 'usgs' && validUsgsUrl(eq.sourceUrl);
}

export function assessEarthquakeSnapshot(value, now = Date.now()) {
  const meta = value?._onrush;
  if (!meta || meta.source !== USGS_URL || meta.schemaVersion !== 1
    || !Number.isSafeInteger(meta.fetchedAt) || meta.fetchedAt <= 0 || meta.fetchedAt > now + SKEW_MS
    || !Number.isSafeInteger(meta.sourceGeneratedAt) || meta.sourceGeneratedAt <= 0
    || meta.sourceGeneratedAt > meta.fetchedAt + SKEW_MS
    || !Array.isArray(value.earthquakes) || value.earthquakes.length > MAX_EVENTS
    || meta.recordCount !== value.earthquakes.length
    || new Set(value.earthquakes.map((eq) => eq?.id)).size !== value.earthquakes.length
    || !value.earthquakes.every((eq) => validEarthquake(eq, meta.sourceGeneratedAt))) return { state: 'invalid' };
  const age = Math.max(0, now - meta.fetchedAt, now - meta.sourceGeneratedAt);
  return { state: age > RETAIN_MS ? 'expired' : age > FRESH_MS ? 'stale' : 'fresh', snapshot: value };
}
