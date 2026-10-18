import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createAppFetch, installAppFetch } from '../client/network.mjs';

const origin = 'https://awareness.onrushdata.com';

test('public bootstrap retains Access credentials beneath outer fetch wrappers', async () => {
  const requests = [];
  const appFetch = createAppFetch(async (request) => { requests.push(request); return new Response('ok'); }, origin);
  for (const input of ['/api/bootstrap?tier=fast&public=1', new URL('/api/bootstrap?tier=slow&public=1', origin),
    new Request(origin + '/api/bootstrap?keys=weatherAlerts&public=1', { credentials: 'omit' })]) {
    await appFetch(input, { credentials: 'omit' });
  }
  assert.ok(requests.every((request) => request.credentials === 'include' && request.redirect === 'error'));
});

test('Request inputs retain the body, headers and abort signal', async () => {
  let seen;
  const appFetch = createAppFetch(async (request) => { seen = request; return new Response('ok'); }, origin);
  const controller = new AbortController();
  await appFetch(new Request(origin + '/api/wm-session', { method: 'POST', body: 'fixture', headers: {
    'Content-Type': 'text/plain', 'X-Fixture': 'kept',
  }, signal: controller.signal }));
  assert.equal(await seen.text(), 'fixture');
  assert.equal(seen.headers.get('x-fixture'), 'kept');
  controller.abort();
  assert.equal(seen.signal.aborted, true);
});

test('prohibited hosts, foreign API origins, methods and datasets never reach native fetch', async () => {
  let calls = 0;
  const appFetch = createAppFetch(async () => { calls++; return new Response('ok'); }, origin);
  for (const path of ['https://api.worldmonitor.app/api/bootstrap?tier=fast', 'https://maps.worldmonitor.app/style.json',
    'https://WORLDMONITOR.APP./', '//proxy.worldmonitor.app/rss', 'https://other.example/api/geo',
    '/api/bootstrap', '/api/bootstrap?keys=outages', '/api/bootstrap?keys=earthquakes,earthquakes', '/api/health']) {
    await assert.rejects(appFetch(path));
  }
  await assert.rejects(appFetch('/api/wm-session', { method: 'GET' }));
  assert.equal(calls, 0);
});

test('asset requests keep caller credentials but cannot follow unchecked redirects', async () => {
  let seen;
  const appFetch = createAppFetch(async (request) => { seen = request; return new Response('ok'); }, origin);
  await appFetch('/data/countries.geojson', { credentials: 'same-origin' });
  assert.equal(seen.credentials, 'same-origin');
  assert.equal(seen.redirect, 'error');
});

test('installation preserves native receiver and restores only its own wrapper', async () => {
  const target = { location: { origin }, fetch: async function () { assert.equal(this, target); return new Response('ok'); } };
  const original = target.fetch;
  const restore = installAppFetch(target);
  assert.equal((await target.fetch('/api/geo')).status, 200);
  restore();
  assert.equal(target.fetch, original);
  const restoreAgain = installAppFetch(target);
  const outer = (...args) => original(...args);
  target.fetch = outer;
  restoreAgain();
  assert.equal(target.fetch, outer);
});
