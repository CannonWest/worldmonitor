import assert from 'node:assert/strict';
import { test } from 'node:test';
import { normalizeUsgs, seedEarthquakes, earthquakeHandler, PUBLISH_EARTHQUAKES } from '../worker/earthquakes.mjs';
import { EARTHQUAKE_KEY, EARTHQUAKE_META_KEY, USGS_URL, EARTHQUAKE_PATH, FRESH_MS, RETAIN_MS,
  REFRESH_MS, assessEarthquakeSnapshot } from '../shared/earthquakes.mjs';
import { createEarthquakeFeed } from '../client/earthquakes.mjs';
import { createWorker } from '../worker/core.mjs';
import { createAppFetch } from '../client/network.mjs';
import { usgsFixture, earthquakeFixture } from './earthquake-fixture.mjs';

const env = { APP_ORIGIN: 'https://awareness.onrushdata.com', UPSTASH_REDIS_REST_URL: 'https://redis.example.invalid', UPSTASH_REDIS_REST_TOKEN: 'fixture-only' };

test('USGS normalization preserves upstream map fields and separates source, event and retrieval clocks', () => {
  const now = Date.now();
  const snapshot = normalizeUsgs(usgsFixture(now), now);
  assert.deepEqual(snapshot.earthquakes[0].location, { longitude: 147, latitude: -6 });
  assert.equal(snapshot.earthquakes[0].occurredAt, now - 60_000);
  assert.equal(snapshot._onrush.sourceGeneratedAt, now - 30_000);
  assert.equal(snapshot._onrush.fetchedAt, now);
  assert.equal(assessEarthquakeSnapshot(snapshot, now).state, 'fresh');
  assert.equal(assessEarthquakeSnapshot(snapshot, now + FRESH_MS).state, 'stale');
  assert.equal(assessEarthquakeSnapshot(snapshot, now + RETAIN_MS).state, 'expired');
  const empty = usgsFixture(now);
  empty.features = []; empty.metadata.count = 0;
  assert.equal(normalizeUsgs(empty, now).earthquakes.length, 0);
  const blast = usgsFixture(now);
  blast.features[0].properties.type = 'quarry blast';
  assert.equal(normalizeUsgs(blast, now).earthquakes.length, 0);
});

test('malformed, duplicate, out-of-range, stale and unsafe source records fail the whole publication', () => {
  const now = Date.now();
  for (const mutate of [
    b => { b.metadata.count = 2; }, b => { b.metadata.generated = now - FRESH_MS - 1; },
    b => { b.features[0].geometry.coordinates[1] = 95; }, b => { b.features[0].properties.mag = null; },
    b => { b.features[0].properties.url = 'https://other.example/'; },
    b => { b.features[0].properties.time = '123'; }, b => { b.metadata.generated = now + 600_000; },
    b => { b.features.push(b.features[0]); b.metadata.count = 2; },
  ]) {
    const body = usgsFixture(now); mutate(body);
    assert.throws(() => normalizeUsgs(body, now));
  }
});

test('producer publishes the canonical data and seed metadata atomically, with bounded TTL and generation protection', async () => {
  const calls = [];
  const now = Date.now();
  const result = await seedEarthquakes(env, { now: () => now, fetcher: async (url, init) => {
    calls.push({ url: String(url), init });
    return String(url) === USGS_URL ? Response.json(usgsFixture(now)) : Response.json({ result: 1 });
  } });
  assert.equal(result.published, true);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].init.redirect, 'manual');
  assert.match(calls[0].init.headers['User-Agent'], /Onrush/);
  assert.equal(calls[0].init.headers.Authorization, undefined);
  const command = JSON.parse(calls[1].init.body);
  assert.deepEqual(command.slice(0, 5), ['EVAL', PUBLISH_EARTHQUAKES, 2, EARTHQUAKE_KEY, EARTHQUAKE_META_KEY]);
  assert.equal(JSON.parse(command[5])._onrush.fetchedAt, JSON.parse(command[6]).seededAt);
  assert.equal(command[7], RETAIN_MS / 1000);
  assert.equal(command[8], now - 30_000);
});

test('failed or oversized extraction makes no Redis writes; publication failures do not report success', async () => {
  let calls = 0;
  for (const response of [Response.json(usgsFixture(), { status: 503 }), new Response('not json'),
    Response.json(usgsFixture(), { headers: { 'content-length': String(3 * 1024 * 1024) } })]) {
    await assert.rejects(seedEarthquakes(env, { fetcher: async () => { calls++; return response; } }));
  }
  assert.equal(calls, 3);
  for (const result of [{ error: 'fixture outage' }, { result: 'wrong result' }]) {
    await assert.rejects(seedEarthquakes(env, { fetcher: async url => String(url) === USGS_URL
      ? Response.json(usgsFixture()) : Response.json(result) }));
  }
});

test('private reader distinguishes missing, empty, stale, expired and Redis failure without a provider fallback', async (t) => {
  let raw = null;
  let outage = false;
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async (_url, init) => {
    calls++;
    assert.deepEqual(JSON.parse(init.body), ['GET', EARTHQUAKE_KEY]);
    return Response.json(outage ? { error: 'fixture' } : { result: raw });
  });
  const worker = createWorker({ routes: { [EARTHQUAKE_PATH]: earthquakeHandler }, verifyAccess: async request => request.headers.has('fixture-auth') });
  const request = (suffix = '', auth = true) => new Request(env.APP_ORIGIN + EARTHQUAKE_PATH + suffix, { headers: auth ? { 'fixture-auth': 'yes' } : {} });
  const read = async (suffix = '') => worker.fetch(request(suffix), env, {});
  assert.equal((await worker.fetch(request('', false), env, {})).status, 401);
  assert.equal(calls, 0);
  assert.equal((await read('?page_size=1')).status, 400);
  assert.equal(calls, 0);
  assert.deepEqual(await (await read()).json(), { state: 'missing' });
  const snapshot = earthquakeFixture();
  snapshot.earthquakes = []; snapshot._onrush.recordCount = 0;
  raw = JSON.stringify(snapshot);
  const empty = await read();
  assert.equal(empty.headers.get('cache-control'), 'no-store');
  assert.equal((await empty.json()).state, 'fresh');
  raw = JSON.stringify(earthquakeFixture(Date.now() - FRESH_MS - 1000));
  assert.equal((await (await read()).json()).state, 'stale');
  raw = JSON.stringify(earthquakeFixture(Date.now() - RETAIN_MS - 1000));
  assert.equal((await read()).status, 503);
  outage = true;
  assert.equal((await read()).status, 503);
});

test('browser refresh ages the retained snapshot, coalesces requests, clears real empty results and recovers', async () => {
  let now = Date.now();
  let body = earthquakeFixture(now);
  let fail = false;
  let requests = 0;
  let view;
  const feed = createEarthquakeFeed(value => { view = value; }, { now: () => now, fetcher: async (path) => {
    assert.equal(path, EARTHQUAKE_PATH); requests++;
    return fail ? new Response('outage', { status: 503 }) : Response.json(body);
  } });
  await Promise.all([feed.refresh(), feed.refresh()]);
  assert.equal(requests, 1);
  assert.equal(view.state, 'fresh');
  const fetchedAt = view.snapshot._onrush.fetchedAt;
  now += FRESH_MS + 1; feed.reassess();
  assert.equal(view.state, 'stale');
  fail = true; await feed.tick();
  assert.equal(view.state, 'unavailable');
  assert.equal(view.snapshot._onrush.fetchedAt, fetchedAt);
  now += RETAIN_MS; feed.reassess();
  assert.equal(view.snapshot, null);
  fail = false; body = earthquakeFixture(now); body.earthquakes = []; body._onrush.recordCount = 0;
  await feed.refresh(); assert.equal(view.state, 'fresh'); assert.equal(view.snapshot.earthquakes.length, 0);
  body = { state: 'missing' }; await feed.refresh(); assert.equal(view.state, 'missing'); assert.equal(view.snapshot, null);
  now += REFRESH_MS; body = earthquakeFixture(now); await feed.tick(); assert.equal(view.snapshot.earthquakes.length, 1);
  body._onrush.sourceGeneratedAt = 0; await feed.refresh(); assert.equal(view.state, 'unavailable');
  feed.stop(); const before = requests; await feed.refresh(); assert.equal(requests, before);
});

test('browser earthquake reader retains Access credentials and cannot follow redirects', async () => {
  let sent;
  const fetcher = createAppFetch(async request => { sent = request; return Response.json({ state: 'missing' }); }, env.APP_ORIGIN);
  await fetcher(EARTHQUAKE_PATH, { credentials: 'omit' });
  assert.equal(sent.credentials, 'include'); assert.equal(sent.redirect, 'error');
});
