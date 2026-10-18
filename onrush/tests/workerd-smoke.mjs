import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { usgsFixture } from './earthquake-fixture.mjs';
import { EARTHQUAKE_KEY, EARTHQUAKE_PATH, USGS_URL } from '../shared/earthquakes.mjs';

const origin = 'https://awareness.onrushdata.com';
const team = 'https://fixture.cloudflareaccess.com';
const { privateKey, publicKey } = await generateKeyPair('RS256');
const jwk = await exportJWK(publicKey);
const sign = (audience) => new SignJWT({ email: 'fixture@example.invalid' })
  .setProtectedHeader({ alg: 'RS256', kid: 'test' }).setIssuer(team).setAudience(audience)
  .setIssuedAt().setExpirationTime('5m').sign(privateKey);
const token = await sign('our-audience');
const authHeaders = { Origin: origin, 'cf-access-jwt-assertion': token };
const reads = [];
let seeded;
let providerFailed = false;
const mf = new Miniflare(convertV4MiniflareOptions({ workers: [{
  name: 'onrush-test', modules: true,
  scriptPath: fileURLToPath(new URL('../dist/worker.mjs', import.meta.url)),
  compatibilityDate: '2026-10-18', compatibilityFlags: ['nodejs_compat'],
  bindings: {
    APP_ORIGIN: origin, NODE_ENV: 'production', EARTHQUAKES_ENABLED: '1',
    ACCESS_TEAM_DOMAIN: team, ACCESS_AUD: 'our-audience',
    WM_SESSION_SECRET: 'local-runtime-fixture-only-'.repeat(3),
    UPSTASH_REDIS_REST_URL: 'https://redis.example.invalid', UPSTASH_REDIS_REST_TOKEN: 'local-runtime-fixture',
  },
  outboundService: async (req) => {
    if (req.url === team + '/cdn-cgi/access/certs') {
      return Response.json({ keys: [{ ...jwk, alg: 'RS256', kid: 'test' }] });
    }
    if (req.url === USGS_URL) return providerFailed ? new Response('fixture outage', { status: 503 }) : Response.json(usgsFixture());
    assert.equal(new URL(req.url).hostname, 'redis.example.invalid');
    const body = await req.json();
    const batch = Array.isArray(body[0]);
    const commands = batch ? body : [body];
    reads.push(...commands);
    const results = commands.map((command) => {
      if (command[0] === 'EVAL' && command[3] === EARTHQUAKE_KEY) {
        seeded = JSON.parse(command[5]);
        return { result: 1 };
      }
      return { result: String(command[0]).toUpperCase().startsWith('EVAL') ? [29, 30]
        : command[1] === EARTHQUAKE_KEY ? JSON.stringify(seeded ?? { earthquakes: [{ id: 'runtime-fixture' }] }) : null };
    });
    return Response.json(batch ? results : results[0]);
  },
}] }));
try {
  const unauthenticated = await mf.dispatchFetch(origin + '/api/bootstrap?tier=fast&public=1');
  assert.equal(unauthenticated.status, 401);
  const otherAudience = await mf.dispatchFetch(origin + '/api/bootstrap?tier=fast&public=1', {
    headers: { ...authHeaders, 'cf-access-jwt-assertion': await sign('other-application') },
  });
  assert.equal(otherAudience.status, 401);
  assert.equal(reads.length, 0);
  const slow = await mf.dispatchFetch(origin + '/api/bootstrap?tier=slow&public=1', { headers: authHeaders });
  assert.equal(slow.status, 200, await slow.clone().text());
  assert.deepEqual(await slow.json(), { data: {}, missing: [] });
  assert.equal(reads.length, 0);
  const fast = await mf.dispatchFetch(origin + '/api/bootstrap?tier=fast&public=1', { headers: authHeaders });
  assert.equal(fast.status, 200, await fast.clone().text());
  assert.equal((await fast.json()).data.earthquakes.earthquakes[0].id, 'runtime-fixture');
  const mint = await mf.dispatchFetch(origin + '/api/wm-session', { method: 'POST', headers: { ...authHeaders, 'cf-connecting-ip': '203.0.113.19' } });
  assert.equal(mint.status, 200, await mint.clone().text());
  assert.ok(mint.headers.get('set-cookie').includes('wm-session='));
  const denied = await mf.dispatchFetch(origin + '/api/bootstrap?tier=fast', { headers: { Origin: 'https://evil.example' } });
  assert.equal(denied.status, 403);
  const worker = await mf.getWorker();
  assert.equal((await worker.scheduled({ cron: '*/5 * * * *' })).outcome, 'ok');
  const earthquakes = await mf.dispatchFetch(origin + EARTHQUAKE_PATH, { headers: authHeaders });
  assert.equal(earthquakes.status, 200, await earthquakes.clone().text());
  const payload = await earthquakes.json();
  assert.equal(payload.state, 'fresh');
  assert.equal(payload.earthquakes[0].magnitude, 5.1);
  const firstSnapshot = JSON.stringify(seeded);
  providerFailed = true;
  assert.notEqual((await worker.scheduled({ cron: '*/5 * * * *' })).outcome, 'ok');
  assert.equal(JSON.stringify(seeded), firstSnapshot);
  const bootstrapSeed = await mf.dispatchFetch(origin + '/api/bootstrap?tier=fast&public=1', { headers: authHeaders });
  assert.equal(bootstrapSeed.status, 200, await bootstrapSeed.clone().text());
  assert.deepEqual((await bootstrapSeed.json()).data.earthquakes._onrush, payload._onrush);
  console.log('PASS workerd: signed Access JWT, audience rejection, bootstrap fast/slow, session mint, origin rejection, real scheduled handler -> mocked publication -> private earthquake read; failed extraction retains the snapshot. All outbound traffic mocked.');
} finally { await mf.dispose(); }
