import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { chromium } from 'playwright';
import { expect } from '@playwright/test';

const here = dirname(fileURLToPath(import.meta.url));
const site = resolve(here, '../dist/site');
const webgl = process.env.ONRUSH_TEST_WEBGL === '1';
const evidence = resolve(process.env.ONRUSH_EVIDENCE_DIR || resolve(here, '../dist/evidence', webgl ? 'webgl' : 'svg'));
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.geojson': 'application/geo+json', '.svg': 'image/svg+xml' };

test(`built dashboard (${webgl ? 'real WebGL2, software renderer fixture' : 'SVG and mobile'}): private Worker, controls, persistence and recovery`, { timeout: 120_000 }, async (t) => {
  await mkdir(evidence, { recursive: true });
  const requests = [];
  const redisBatches = [];
  const external = [];
  const errors = [];
  const browserRequests = [];
  const csp = [];
  let apiMode = 'missing';
  let mf;
  let browser;
  const team = 'https://fixture.cloudflareaccess.com';
  const { privateKey, publicKey } = await generateKeyPair('RS256');
  const jwk = await exportJWK(publicKey);
  const token = await new SignJWT({ email: 'fixture@example.invalid' }).setProtectedHeader({ alg: 'RS256', kid: 'test' })
    .setIssuer(team).setAudience('dashboard-fixture').setIssuedAt().setExpirationTime('10m').sign(privateKey);
  const server = createServer(async (incoming, outgoing) => {
    try {
      const headers = new Headers();
      for (const [key, value] of Object.entries(incoming.headers)) {
        if (value !== undefined) headers.set(key, Array.isArray(value) ? value.join(', ') : value);
      }
      // This fixture models the trusted Access edge; the Worker still verifies
      // a real signed token against its mocked JWKS endpoint on every request.
      if (headers.get('cookie')?.includes('CF_Authorization=fixture')) headers.set('cf-access-jwt-assertion', token);
      headers.set('cf-connecting-ip', '203.0.113.42');
      const chunks = [];
      for await (const chunk of incoming) chunks.push(chunk);
      const body = Buffer.concat(chunks);
      const url = origin + incoming.url;
      requests.push({ method: incoming.method, path: incoming.url });
      const response = await mf.dispatchFetch(url, { method: incoming.method, headers,
        ...(!['GET', 'HEAD'].includes(incoming.method) && body.length ? { body } : {}) });
      outgoing.writeHead(response.status, { ...Object.fromEntries(response.headers),
        ...(response.headers.getSetCookie().length ? { 'set-cookie': response.headers.getSetCookie() } : {}) });
      outgoing.end(Buffer.from(await response.arrayBuffer()));
    } catch (error) { outgoing.writeHead(500); outgoing.end(String(error)); }
  });
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  const origin = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => {
    await writeFile(resolve(evidence, 'dashboard-results.json'), JSON.stringify({ requests, redisBatches, external, errors, csp, browserRequests }, null, 2));
    await browser?.close();
    await new Promise((done) => server.close(done));
    await mf?.dispose();
  });
  mf = new Miniflare(convertV4MiniflareOptions({ workers: [{
    name: 'onrush-dashboard-test', modules: true, scriptPath: resolve(here, '../dist/worker.mjs'),
    compatibilityDate: '2026-10-18', compatibilityFlags: ['nodejs_compat'],
    bindings: { APP_ORIGIN: origin, NODE_ENV: 'production', ACCESS_TEAM_DOMAIN: team, ACCESS_AUD: 'dashboard-fixture',
      WM_SESSION_SECRET: 'dashboard-runtime-fixture-only-'.repeat(3),
      UPSTASH_REDIS_REST_URL: 'https://redis.example.invalid', UPSTASH_REDIS_REST_TOKEN: 'fixture' },
    serviceBindings: { ASSETS: async (request) => {
      let pathname = decodeURIComponent(new URL(request.url).pathname);
      if (['/', '/dashboard'].includes(pathname)) pathname = '/index.html';
      const path = resolve(site, '.' + pathname);
      if (!path.startsWith(site + sep)) return new Response('Not found', { status: 404 });
      try { return new Response(await readFile(path), { headers: { 'Content-Type': mime[extname(path)] || 'text/plain' } }); }
      catch { return new Response('Not found', { status: 404 }); }
    } },
    outboundService: async (request) => {
      if (request.url === team + '/cdn-cgi/access/certs') return Response.json({ keys: [{ ...jwk, alg: 'RS256', kid: 'test' }] });
      assert.equal(new URL(request.url).hostname, 'redis.example.invalid');
      const commandsBody = await request.json();
      const batch = Array.isArray(commandsBody[0]);
      const commands = batch ? commandsBody : [commandsBody];
      redisBatches.push(commands);
      const results = commands.map(([command]) => apiMode === 'unavailable' ? { error: 'fixture outage' }
        : { result: String(command).toUpperCase().startsWith('EVAL') ? [29, 30] : null });
      return Response.json(batch ? results : results[0]);
    },
  }] }));
  assert.equal((await mf.dispatchFetch(origin + '/')).status, 401);
  browser = await chromium.launch({ headless: true, ...(webgl ? { args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] } : {}) });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await context.addCookies([{ name: 'CF_Authorization', value: 'fixture', url: origin, httpOnly: true, sameSite: 'Lax' }]);
  await context.route('**/*', async (route) => {
    if (new URL(route.request().url()).origin !== origin) { external.push(route.request().url()); await route.abort(); }
    else await route.continue();
  });
  await context.addInitScript(() => {
    window.__onrushCsp = [];
    document.addEventListener('securitypolicyviolation', (event) => window.__onrushCsp.push({ directive: event.violatedDirective, uri: event.blockedURI }));
    if (!sessionStorage.getItem('onrush-fixture-seeded')) {
      localStorage.setItem('onrush:reference-layers:v1', JSON.stringify({ cables: true, waterways: true, military: true, weather: true, outages: true }));
      localStorage.setItem('wm-map-provider', 'carto');
      localStorage.setItem('worldmonitor-variant', 'finance');
      sessionStorage.setItem('onrush-fixture-seeded', '1');
    }
  });
  if (webgl) {
    // Existing repository recipe (e2e/mcp-news-map.spec.ts): hide GPU identity,
    // as a privacy extension can. Rendering still uses real native WebGL2;
    // this tests the vector path without claiming hardware-GPU verification.
    await context.addInitScript(() => {
      const getExtension = WebGL2RenderingContext.prototype.getExtension;
      WebGL2RenderingContext.prototype.getExtension = function (name) {
        return name === 'WEBGL_debug_renderer_info' ? null : Reflect.apply(getExtension, this, [name]);
      };
    });
  }
  const page = await context.newPage();
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('request', (request) => browserRequests.push(request.url()));
  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    const text = message.text();
    if (text !== 'Failed to load resource: the server responded with a status of 503 (Service Unavailable)') errors.push('console: ' + text);
    t.diagnostic('browser console: ' + text);
  });
  await page.goto(origin + '/dashboard');
  await page.waitForSelector('html[data-onrush-ready="true"][data-onrush-data-ready="true"]');
  const renderer = await page.locator('#oa-renderer').getAttribute('data-renderer');
  t.diagnostic('Desktop renderer: ' + renderer);
  if (webgl) { assert.equal(renderer, 'deck'); await page.waitForSelector('#deckgl-basemap canvas'); }
  else { assert.equal(renderer, 'svg'); await page.waitForSelector('#mapContainer path.country'); }
  assert.equal(await page.title(), 'Onrush Awareness');
  assert.equal(await page.locator('input[data-layer]').count(), 9);
  assert.equal(await page.locator('input[data-layer="weather"]').count(), 0);
  assert.match(await page.locator('#oa-data-status').textContent(), /Earthquake and weather data are not available/);
  assert.match(await page.locator('#oa-session-status').textContent(), /established/);
  assert.ok((await context.cookies()).some((cookie) => cookie.name === 'wm-session' && cookie.httpOnly));
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
  await page.screenshot({ path: resolve(evidence, 'desktop.png'), fullPage: true });
  await page.getByRole('button', { name: 'Sources', exact: true }).click();
  await page.getByRole('dialog', { name: 'Source register' }).waitFor();
  assert.equal(await page.locator('dialog tbody tr').count(), 9);
  await page.screenshot({ path: resolve(evidence, 'sources.png'), fullPage: true });
  await page.getByRole('button', { name: 'Close source register' }).click();
  await page.locator('input[data-layer="cables"]').uncheck();
  if (renderer === 'svg') await expect(page.locator('.cable-path:visible')).toHaveCount(0);
  await page.reload();
  await page.waitForSelector('html[data-onrush-ready="true"]');
  assert.equal(await page.locator('input[data-layer="cables"]').isChecked(), false);
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('onrush:reference-layers:v1')));
  assert.equal(stored.military, undefined);
  assert.equal(stored.cables, false);
  await page.locator('input[data-layer="cables"]').check();
  for (const checkbox of await page.locator('input[data-layer]').all()) await checkbox.check();
  await expect(page.locator('input[data-layer]:checked')).toHaveCount(9);
  if (renderer === 'svg') {
    for (let step = 0; step < 4; step++) await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
    await page.waitForSelector('.base-marker', { timeout: 5000 });
  }
  await page.screenshot({ path: resolve(evidence, 'all-reference-layers.png'), fullPage: true });
  for (const checkbox of await page.locator('input[data-layer]').all()) {
    if (!['cables', 'waterways'].includes(await checkbox.getAttribute('data-layer'))) await checkbox.uncheck();
  }
  await page.getByRole('button', { name: 'Reset view' }).click();
  await page.locator('#oa-region').selectOption('mena');
  if (renderer === 'svg') {
    await page.locator('.waterway-marker:visible').first().click();
    await page.getByRole('dialog', { name: /./ }).waitFor();
    assert.match(await page.locator('.oa-ref-popup').textContent(), /SAVED REFERENCE ENTRY/);
    await page.getByRole('button', { name: 'Close reference details' }).click();
  }
  await page.getByRole('button', { name: 'Reset view' }).click();
  await page.waitForSelector('html[data-onrush-data-ready="true"]');
  apiMode = 'unavailable';
  await page.getByRole('button', { name: 'Check again' }).click();
  await page.getByText('Feed data could not be checked. Try again when the connection is restored.').waitFor();
  await page.screenshot({ path: resolve(evidence, 'unavailable.png'), fullPage: true });
  apiMode = 'missing';
  await page.getByRole('button', { name: 'Check again' }).click();
  await page.getByText('Earthquake and weather data are not available. Missing data does not mean zero events.').waitFor();
  csp.push(...await page.evaluate(() => window.__onrushCsp));
  if (!webgl) {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.reload();
    await page.waitForSelector('html[data-onrush-ready="true"][data-onrush-data-ready="true"]');
    await page.waitForSelector('#mapContainer path.country');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
    await page.screenshot({ path: resolve(evidence, 'mobile.png'), fullPage: true });
    csp.push(...await page.evaluate(() => window.__onrushCsp));
  }
  assert.deepEqual(errors, []);
  assert.deepEqual(external, []);
  assert.deepEqual(csp, []);
  assert.ok(requests.filter((request) => request.path.startsWith('/api/')).every((request) => /^\/api\/(?:bootstrap\?|wm-session$)/.test(request.path)));
  for (const commands of redisBatches.filter((commands) => commands.some(([command]) => command === 'GET'))) {
    assert.deepEqual(commands, [['GET', 'seismology:earthquakes:v1'], ['GET', 'weather:alerts:v1']]);
  }
  await context.close();
});
