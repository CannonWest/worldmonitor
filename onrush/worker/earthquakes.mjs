import { EARTHQUAKE_KEY, EARTHQUAKE_META_KEY, USGS_URL, FRESH_MS, RETAIN_MS, MAX_EVENTS,
  assessEarthquakeSnapshot } from '../shared/earthquakes.mjs';

const MAX_BYTES = 2 * 1024 * 1024;
// Publish data and seed metadata together. A delayed run cannot overwrite a
// newer provider generation (or a later retrieval of the same generation).
export const PUBLISH_EARTHQUAKES = `
local previous = redis.call('GET', KEYS[1])
if previous then
  local ok, old = pcall(cjson.decode, previous)
  if ok and type(old) == 'table' and type(old._onrush) == 'table' then
    local generated = tonumber(old._onrush.sourceGeneratedAt) or 0
    local fetched = tonumber(old._onrush.fetchedAt) or 0
    if generated > tonumber(ARGV[4]) or (generated == tonumber(ARGV[4]) and fetched > tonumber(ARGV[5])) then return 0 end
  end
end
redis.call('SET', KEYS[1], ARGV[1], 'EX', ARGV[3])
redis.call('SET', KEYS[2], ARGV[2], 'EX', 86400)
return 1`;

async function boundedJson(response) {
  if (!response.ok || Number(response.headers.get('content-length')) > MAX_BYTES) {
    await response.body?.cancel();
    throw new Error('Feed response refused');
  }
  const reader = response.body?.getReader();
  if (!reader) throw new Error('Empty response');
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BYTES) throw new Error('Response exceeds size limit');
      chunks.push(value);
    }
  } catch (error) { await reader.cancel(); throw error; }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
}

export function normalizeUsgs(body, fetchedAt = Date.now()) {
  if (body?.type !== 'FeatureCollection' || body.metadata?.status !== 200
    || !Array.isArray(body.features) || body.features.length > MAX_EVENTS
    || body.metadata.count !== body.features.length) throw new Error('Invalid USGS collection');
  const earthquakes = body.features.map((feature) => {
    const p = feature?.properties;
    const c = feature?.geometry?.coordinates;
    if (feature?.type !== 'Feature' || feature.geometry?.type !== 'Point' || !Array.isArray(c)
      || typeof p?.type !== 'string') throw new Error('Invalid USGS event');
    // USGS can also catalogue blasts and other seismic events. They do not
    // belong to the earthquake layer and must not poison the entire refresh.
    if (p.type !== 'earthquake') return null;
    return { id: feature.id, place: p.place, magnitude: p.mag, depthKm: c[2],
      location: { latitude: c[1], longitude: c[0] }, occurredAt: p.time,
      sourceUrl: p.url, source: 'usgs', category: 'earthquake' };
  }).filter(Boolean).sort((a, b) => b.occurredAt - a.occurredAt || String(a.id).localeCompare(String(b.id)));
  const snapshot = { earthquakes, _onrush: { schemaVersion: 1, source: USGS_URL,
    sourceGeneratedAt: body.metadata.generated, fetchedAt, recordCount: earthquakes.length } };
  if (assessEarthquakeSnapshot(snapshot, fetchedAt).state !== 'fresh') throw new Error('Invalid or stale USGS snapshot');
  return snapshot;
}

async function redis(env, command, fetcher) {
  const url = new URL(env.UPSTASH_REDIS_REST_URL);
  if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search
    || !env.UPSTASH_REDIS_REST_TOKEN) throw new Error('Redis not configured');
  const body = await boundedJson(await fetcher(url.href, { method: 'POST', redirect: 'manual',
    headers: { Authorization: `Bearer ${env.UPSTASH_REDIS_REST_TOKEN}`, 'Content-Type': 'application/json',
      'User-Agent': 'Onrush-Awareness/1.0 (+https://github.com/CannonWest/worldmonitor)' },
    body: JSON.stringify(command), signal: AbortSignal.timeout(10_000) }));
  if (!body || body.error || !Object.hasOwn(body, 'result')) throw new Error('Redis command failed');
  return body.result;
}

export async function seedEarthquakes(env, { fetcher = (...args) => fetch(...args), now = Date.now } = {}) {
  const snapshot = normalizeUsgs(await boundedJson(await fetcher(USGS_URL, { redirect: 'manual',
    headers: { Accept: 'application/geo+json, application/json',
      'User-Agent': 'Onrush-Awareness/1.0 (+https://github.com/CannonWest/worldmonitor)' },
    signal: AbortSignal.timeout(15_000) })), now());
  const meta = { seededAt: snapshot._onrush.fetchedAt, recordCount: snapshot.earthquakes.length,
    sourceVersion: 'onrush-usgs-4.5-week-v1', schemaVersion: 1, maxStaleMin: FRESH_MS / 60_000,
    sourceGeneratedAt: snapshot._onrush.sourceGeneratedAt };
  const published = await redis(env, ['EVAL', PUBLISH_EARTHQUAKES, 2, EARTHQUAKE_KEY, EARTHQUAKE_META_KEY,
    JSON.stringify(snapshot), JSON.stringify(meta), RETAIN_MS / 1000,
    snapshot._onrush.sourceGeneratedAt, snapshot._onrush.fetchedAt], fetcher);
  if (published !== 0 && published !== 1) throw new Error('Publication not confirmed');
  return { published: published === 1, ...snapshot._onrush };
}

export async function scheduledEarthquakes(event, env) {
  if (env.EARTHQUAKES_ENABLED !== '1') return;
  try {
    const result = await seedEarthquakes(env);
    console.log(JSON.stringify({ event: 'onrush.earthquakes.seed', scheduledAt: event.scheduledTime, ...result }));
  } catch {
    // Avoid exposing credentials or provider response bodies in logs. Keep the
    // last good snapshot; its retrieval/source clocks continue aging naturally.
    console.error(JSON.stringify({ event: 'onrush.earthquakes.seed', status: 'failed', scheduledAt: event.scheduledTime }));
    throw new Error('Earthquake refresh failed');
  }
}

export async function earthquakeHandler(request, _context, env) {
  if (new URL(request.url).search) return Response.json({ error: 'Query not enabled' }, { status: 400 });
  const raw = await redis(env, ['GET', EARTHQUAKE_KEY], (...args) => fetch(...args));
  if (raw === null) return Response.json({ state: 'missing' });
  const snapshot = typeof raw === 'string' ? JSON.parse(raw) : raw;
  const assessed = assessEarthquakeSnapshot(snapshot);
  if (['invalid', 'expired'].includes(assessed.state)) {
    return Response.json({ error: 'Earthquake snapshot unavailable' }, { status: 503, headers: { 'Retry-After': '30' } });
  }
  return Response.json({ state: assessed.state, ...snapshot });
}
