import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { createWorker } from '../worker/core.mjs';
import { createAccessVerifier } from '../worker/access.mjs';
import { createGuardedFetch } from '../worker/network.mjs';
import { waitUntil } from '../worker/execution.mjs';
import { root, workerBuildOptions } from '../build-worker.mjs';

const origin = 'https://awareness.onrushdata.com';
const env = { APP_ORIGIN: origin };
const context = { waitUntil() {} };
const request = (path, init = {}) => new Request(origin + path, init);
const allowed = async () => true;
const routeResponse = () => Response.json({ ok: true });

test('Access denial protects assets as well as API; local bypass cannot apply on public host', async () => {
  const worker = createWorker({ routes: {}, verifyAccess: async () => false });
  for (const path of ['/', '/style.css', '/api/bootstrap?tier=fast&public=1']) {
    assert.equal((await worker.fetch(request(path), { ...env, LOCAL_DEV: '1' }, context)).status, 401);
  }
});

test('reject foreign origins and hosts before invoking handlers', async () => {
  let calls = 0;
  const worker = createWorker({ routes: { '/api/bootstrap': () => { calls++; return routeResponse(); } }, verifyAccess: allowed });
  assert.equal((await worker.fetch(request('/api/bootstrap?tier=fast', { headers: { Origin: 'https://evil.example' } }), env, context)).status, 403);
  assert.equal((await worker.fetch(new Request('https://other.example/api/bootstrap?tier=fast'), env, context)).status, 403);
  assert.equal(calls, 0);
});

test('authenticated assets, local geo and same-origin preflight do not call upstream', async () => {
  const worker = createWorker({ routes: {}, verifyAccess: allowed });
  const asset = await worker.fetch(request('/'), { ...env, ASSETS: { fetch: async () => new Response('holding fixture') } }, context);
  assert.equal(await asset.text(), 'holding fixture');
  assert.equal(asset.headers.get('cache-control'), 'no-store');
  assert.equal(asset.headers.get('x-robots-tag'), 'noindex, nofollow');
  assert.match(asset.headers.get('content-security-policy'), /connect-src 'self';/);
  assert.match(asset.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  const geoRequest = request('/api/geo');
  Object.defineProperty(geoRequest, 'cf', { value: { country: 'GB' } });
  assert.deepEqual(await (await worker.fetch(geoRequest, env, context)).json(), { country: 'GB' });
  assert.deepEqual(await (await worker.fetch(request('/api/geo'), env, context)).json(), { country: 'XX' });
  const preflight = await worker.fetch(request('/api/bootstrap', { method: 'OPTIONS', headers: { Origin: origin } }), env, context);
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get('access-control-allow-origin'), origin);
  assert.equal(preflight.headers.get('access-control-allow-credentials'), 'true');
});

test('only selected paths, methods and datasets reach upstream', async () => {
  const worker = createWorker({ routes: { '/api/bootstrap': routeResponse }, verifyAccess: allowed });
  for (const query of ['', '?keys=outages', '?tier=fast&keys=earthquakes', '?tier=fast&tier=slow', '?keys=', '?tier=FAST', '?tier=fast&public=0']) {
    assert.equal((await worker.fetch(request('/api/bootstrap' + query), env, context)).status, 400, query);
  }
  assert.equal((await worker.fetch(request('/api/bootstrap?keys=earthquakes'), env, context)).status, 200);
  assert.equal((await worker.fetch(request('/api/bootstrap?tier=slow&public=1'), env, context)).status, 200);
  assert.equal((await worker.fetch(request('/api/health'), env, context)).status, 404);
  assert.equal((await worker.fetch(request('/api/bootstrap?tier=fast', { method: 'POST' }), env, context)).status, 405);
});

test('edge IP overwrites forwarded IP spoofing and preserves separate client buckets', async () => {
  const seen = [];
  const worker = createWorker({ routes: { '/api/wm-session': (req) => {
    seen.push(req.headers);
    return routeResponse();
  } }, verifyAccess: allowed });
  for (const ip of ['203.0.113.11', '203.0.113.12']) {
    await worker.fetch(request('/api/wm-session', { method: 'POST', headers: {
      'cf-connecting-ip': ip, 'x-real-ip': 'spoof', 'x-forwarded-for': 'spoof', 'x-wm-edge-proof': 'spoof',
    } }), env, context);
  }
  assert.deepEqual(seen.map((headers) => headers.get('x-real-ip')), ['203.0.113.11', '203.0.113.12']);
  assert.ok(seen.every((headers) => !headers.has('cf-connecting-ip') && !headers.has('x-forwarded-for') && !headers.has('x-wm-edge-proof')));
});

test('private responses remain no-store; failures are retryable and do not reveal exception text', async () => {
  const worker = createWorker({ routes: { '/api/bootstrap': () => new Response('ok', { headers: {
    'Cache-Control': 'public, max-age=600', 'CDN-Cache-Control': 'public, s-maxage=600', 'Access-Control-Allow-Origin': '*',
  } }), '/api/wm-session': () => { throw new Error('sensitive detail'); } }, verifyAccess: allowed });
  const response = await worker.fetch(request('/api/bootstrap?tier=fast'), env, context);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.get('cdn-cache-control'), null);
  assert.equal(response.headers.get('access-control-allow-origin'), origin);
  assert.equal(response.headers.get('access-control-allow-credentials'), 'true');
  assert.equal(response.headers.get('vary'), 'Origin');
  const failure = await worker.fetch(request('/api/wm-session', { method: 'POST' }), env, context);
  assert.equal(failure.status, 503);
  assert.equal(failure.headers.get('retry-after'), '5');
  assert.ok(!(await failure.text()).includes('sensitive detail'));
});

test('background work stays with the request execution context', async () => {
  const seen = [[], []];
  const worker = createWorker({ routes: { '/api/bootstrap': async () => {
    await Promise.resolve();
    waitUntil(Promise.resolve('done'));
    return routeResponse();
  } }, verifyAccess: allowed });
  await Promise.all(seen.map((bucket) => worker.fetch(request('/api/bootstrap?tier=slow'), env, {
    waitUntil: (promise) => bucket.push(promise),
  })));
  for (const bucket of seen) {
    assert.equal(bucket.length, 1);
    assert.equal(await bucket[0], 'done');
  }
  assert.throws(() => waitUntil(Promise.resolve()), /No active Worker/);
});

test('Access verifies signature, issuer, audience and expiry with a real signed fixture', async () => {
  const { privateKey, publicKey } = await generateKeyPair('RS256');
  const jwk = await exportJWK(publicKey);
  const verify = createAccessVerifier(() => createLocalJWKSet({ keys: [{ ...jwk, alg: 'RS256', kid: 'test' }] }));
  const team = 'https://example.cloudflareaccess.com';
  const accessEnv = { ACCESS_TEAM_DOMAIN: team, ACCESS_AUD: 'our-audience' };
  const sign = (audience, expiry = '5m') => new SignJWT({ email: 'fixture@example.invalid' })
    .setProtectedHeader({ alg: 'RS256', kid: 'test' }).setIssuer(team).setAudience(audience)
    .setIssuedAt().setExpirationTime(expiry).sign(privateKey);
  const authRequest = (token) => request('/', { headers: { 'cf-access-jwt-assertion': token } });
  assert.equal(await verify(authRequest(await sign('our-audience')), accessEnv), true);
  assert.equal(await verify(authRequest(await sign('someone-else')), accessEnv), false);
  assert.equal(await verify(authRequest(await sign('our-audience', '-1s')), accessEnv), false);
  assert.equal(await verify(authRequest('forged'), accessEnv), false);
  const noExpiry = await new SignJWT({}).setProtectedHeader({ alg: 'RS256', kid: 'test' })
    .setIssuer(team).setAudience('our-audience').sign(privateKey);
  assert.equal(await verify(authRequest(noExpiry), accessEnv), false);
  const wrongIssuer = await new SignJWT({}).setProtectedHeader({ alg: 'RS256', kid: 'test' })
    .setIssuer('https://other.cloudflareaccess.com').setAudience('our-audience').setExpirationTime('5m').sign(privateKey);
  assert.equal(await verify(authRequest(wrongIssuer), accessEnv), false);
  assert.equal(await verify(authRequest(await sign('our-audience')), { ACCESS_TEAM_DOMAIN: team }), false);
  assert.equal(await verify(authRequest(await sign('our-audience')), { ...accessEnv, ACCESS_TEAM_DOMAIN: 'https://attacker.example' }), false);
});

test('network guard rejects prohibited hosts and redirect hops before issuing their requests', async () => {
  const seen = [];
  const guarded = createGuardedFetch(async (req) => {
    seen.push(req.url);
    return new Response(null, { status: 302, headers: { Location: 'https://api.worldmonitor.app/api/wm-session' } });
  });
  for (const host of ['worldmonitor.app', 'api.worldmonitor.app', 'proxy.worldmonitor.app', 'MAPS.WORLDMONITOR.APP.']) {
    await assert.rejects(guarded('https://' + host), /hosted services/);
  }
  assert.equal(seen.length, 0);
  await assert.rejects(guarded('https://publisher.example/feed'), /hosted services/);
  assert.deepEqual(seen, ['https://publisher.example/feed']);
});

test('permitted redirect strips credentials before reaching a different origin', async () => {
  const seen = [];
  const guarded = createGuardedFetch(async (req) => {
    seen.push(req);
    return seen.length === 1 ? new Response(null, { status: 302, headers: { Location: 'https://other.example/feed' } }) : new Response('ok');
  });
  const result = await guarded('https://publisher.example/feed', { headers: {
    Authorization: 'fixture', Cookie: 'fixture', 'Cf-Access-Jwt-Assertion': 'fixture', Accept: 'text/xml',
  } });
  assert.equal(await result.text(), 'ok');
  assert.equal(seen[1].headers.get('authorization'), null);
  assert.equal(seen[1].headers.get('cookie'), null);
  assert.equal(seen[1].headers.get('cf-access-jwt-assertion'), null);
  assert.equal(seen[1].headers.get('accept'), 'text/xml');
  assert.match(seen[1].headers.get('user-agent'), /Onrush-Awareness/);
});

test('bundled real upstream bootstrap reads exactly the two selected keys, empty slow reads none, Redis failures are 503', async (t) => {
  const outfile = resolve(root, 'onrush/dist/test-handlers.mjs');
  await build({ ...workerBuildOptions, platform: 'node', entryPoints: undefined, outfile,
    stdin: { contents: "export {default as bootstrap} from './api/bootstrap.js'; export {default as session} from './api/wm-session.js';", resolveDir: root, loader: 'js' },
  });
  process.env.APP_ORIGIN = origin;
  process.env.NODE_ENV = 'production';
  process.env.UPSTASH_REDIS_REST_URL = 'https://redis.example.invalid';
  process.env.UPSTASH_REDIS_REST_TOKEN = 'local-test-fixture';
  process.env.WM_SESSION_SECRET = 'local-session-fixture-only-'.repeat(3);
  const { bootstrap, session } = await import(pathToFileURL(outfile).href);
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  const batches = [];
  globalThis.fetch = async (input, init) => {
    assert.equal(new URL(typeof input === 'string' ? input : input.url).hostname, 'redis.example.invalid');
    const commands = JSON.parse(init.body);
    batches.push(commands);
    return Response.json(commands.map(([, key]) => ({ result: key === 'seismology:earthquakes:v1' ? JSON.stringify({ earthquakes: [{ id: 'fixture' }] }) : null })));
  };
  const worker = createWorker({ routes: { '/api/bootstrap': bootstrap }, verifyAccess: allowed });
  const fast = await worker.fetch(request('/api/bootstrap?tier=fast&public=1', { headers: { Origin: origin } }), env, context);
  assert.equal(fast.status, 200);
  assert.deepEqual(batches[0], [['GET', 'seismology:earthquakes:v1'], ['GET', 'weather:alerts:v1']]);
  const data = await fast.json();
  assert.equal(data.data.earthquakes.earthquakes[0].id, 'fixture');
  assert.deepEqual(data.missing, ['weatherAlerts']);
  const slow = await worker.fetch(request('/api/bootstrap?tier=slow&public=1'), env, context);
  assert.deepEqual(await slow.json(), { data: {}, missing: [] });
  assert.equal(batches.length, 1);
  globalThis.fetch = async () => Response.json([{ error: 'fixture Redis outage' }]);
  assert.equal((await worker.fetch(request('/api/bootstrap?tier=fast&public=1'), env, context)).status, 503);

  const limiterCommands = [];
  globalThis.fetch = async (input, init) => {
    const body = JSON.parse(init?.body ?? await input.clone().text());
    const isBatch = Array.isArray(body[0]);
    const commands = isBatch ? body : [body];
    limiterCommands.push(...commands);
    const results = commands.map(([command, key]) => ({ result: command.toUpperCase().startsWith('EVAL')
      ? [29, 30] : key === 'seismology:earthquakes:v1' ? JSON.stringify({ earthquakes: [] }) : null }));
    return Response.json(isBatch ? results : results[0]);
  };
  const sessionWorker = createWorker({ routes: { '/api/bootstrap': bootstrap, '/api/wm-session': session }, verifyAccess: allowed });
  const mint = await sessionWorker.fetch(request('/api/wm-session', { method: 'POST', headers: { Origin: origin, 'cf-connecting-ip': '203.0.113.71' } }), env, context);
  assert.equal(mint.status, 200, await mint.clone().text());
  const cookie = mint.headers.getSetCookie().find((value) => value.startsWith('wm-session='));
  assert.ok(cookie?.includes('HttpOnly') && cookie.includes('Secure') && cookie.includes('SameSite=Lax'));
  assert.ok(!cookie.includes('Domain='));
  const authenticated = await sessionWorker.fetch(request('/api/bootstrap?keys=earthquakes', { headers: {
    Origin: origin, Cookie: cookie.split(';')[0], 'cf-connecting-ip': '203.0.113.72',
  } }), env, context);
  assert.equal(authenticated.status, 200);
  assert.equal((await authenticated.json()).data.earthquakes.earthquakes.length, 0);
  const commandsText = JSON.stringify(limiterCommands);
  assert.ok(commandsText.includes('203.0.113.71') && commandsText.includes('203.0.113.72'));
});
