import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readStartupSnapshot } from '../client/bootstrap.mjs';

test('reachable bootstrap with missing seeds is distinct from an unavailable reader', async () => {
  let target;
  const result = await readStartupSnapshot(async (url, init) => {
    target = { url, init };
    return Response.json({ data: {}, missing: ['earthquakes', 'weatherAlerts'] });
  });
  assert.equal(result.state, 'missing');
  assert.equal(target.url, '/api/bootstrap?tier=fast&public=1');
  assert.equal(target.init.credentials, 'omit'); // inner guard must retain Access
});

test('a received empty event list is a snapshot, without claiming source freshness', async () => {
  const result = await readStartupSnapshot(async () => Response.json({ data: { earthquakes: { earthquakes: [] } }, missing: ['weatherAlerts'] }));
  assert.deepEqual(result, { state: 'received', received: ['earthquakes'] });
});

test('outage, non-JSON and inconsistent envelopes do not masquerade as missing seeds', async () => {
  for (const response of [new Response('outage', { status: 503 }), new Response('not JSON'),
    Response.json({ data: {}, missing: [] }), Response.json({ data: { weatherAlerts: null }, missing: ['earthquakes'] }),
    Response.json({ data: { military: [] }, missing: ['earthquakes'] }),
    Response.json({ data: { earthquakes: [] }, missing: ['earthquakes'] })]) {
    assert.equal((await readStartupSnapshot(async () => response)).state, 'unavailable');
  }
  assert.equal((await readStartupSnapshot(async () => { throw new TypeError('offline'); })).state, 'unavailable');
});
