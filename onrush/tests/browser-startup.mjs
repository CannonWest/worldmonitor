import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';

test('browser retains an HttpOnly Access cookie despite upstream omit, and refuses redirect hops', { timeout: 30_000 }, async (t) => {
  let redirectTargetHits = 0;
  const modules = new Map(await Promise.all([
    ['client/network.mjs', '../client/network.mjs'],
    ['shared/startup-policy.mjs', '../shared/startup-policy.mjs'],
    ['worker/network.mjs', '../worker/network.mjs'],
  ].map(async ([path, file]) => ['/onrush/' + path, await readFile(new URL(file, import.meta.url), 'utf8')])));
  const server = createServer((request, response) => {
    const url = new URL(request.url, 'http://localhost');
    if (url.pathname === '/') {
      // Local fixture only; production Access supplies a Secure cookie over HTTPS.
      response.writeHead(200, { 'Content-Type': 'text/html', 'Set-Cookie': 'CF_Authorization=local-fixture; HttpOnly; SameSite=Lax; Path=/' });
      response.end('<!doctype html><title>Startup test fixture</title>');
    } else if (modules.has(url.pathname)) {
      response.writeHead(200, { 'Content-Type': 'text/javascript' });
      response.end(modules.get(url.pathname));
    } else if (url.pathname === '/api/bootstrap') {
      const authenticated = request.headers.cookie?.includes('CF_Authorization=local-fixture');
      response.writeHead(authenticated ? 200 : 401, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ authenticated: !!authenticated }));
    } else if (url.pathname === '/redirect') {
      response.writeHead(302, { Location: '/redirect-target' });
      response.end();
    } else if (url.pathname === '/redirect-target') {
      redirectTargetHits++;
      response.end('unexpected');
    } else { response.writeHead(404); response.end(); }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  let browser;
  t.after(async () => {
    await browser?.close();
    await new Promise((resolve) => server.close(resolve));
  });
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const origin = `http://127.0.0.1:${server.address().port}`;
  const externalAttempts = [];
  // Independent test safety net: the test can never contact an external host.
  await page.route('**/*', async (route) => {
    if (new URL(route.request().url()).origin !== origin) {
      externalAttempts.push(route.request().url());
      await route.abort();
    } else await route.continue();
  });
  await page.goto(origin);
  const result = await page.evaluate(async () => {
    const nativeStatus = (await fetch('/api/bootstrap?tier=fast&public=1', { credentials: 'omit' })).status;
    const { installAppFetch } = await import('/onrush/client/network.mjs');
    installAppFetch();
    const guarded = await fetch('/api/bootstrap?tier=fast&public=1', { credentials: 'omit' });
    let redirectRefused = false;
    try { await fetch('/redirect'); } catch { redirectRefused = true; }
    let hostedRefused = false;
    try { await fetch('https://api.worldmonitor.app/api/bootstrap?tier=fast'); } catch { hostedRefused = true; }
    return { nativeStatus, status: guarded.status, body: await guarded.json(),
      cookieVisible: document.cookie.includes('CF_Authorization'), redirectRefused, hostedRefused };
  });
  assert.deepEqual(result, { nativeStatus: 401, status: 200, body: { authenticated: true },
    cookieVisible: false, redirectRefused: true, hostedRefused: true });
  assert.equal(redirectTargetHits, 0);
  assert.deepEqual(externalAttempts, []);
});
