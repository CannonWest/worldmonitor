import { verifyAccess as verifyAccessToken } from './access.mjs';
import { withExecution } from './execution.mjs';
import { STARTUP_METHODS, validBootstrapQuery } from '../shared/startup-policy.mjs';

function json(body, status = 200, extra = {}) {
  return Response.json(body, { status, headers: { 'Cache-Control': 'no-store', ...extra } });
}

export function createWorker({ routes, verifyAccess = verifyAccessToken }) {
  return {
    async fetch(request, env, context) {
      const url = new URL(request.url);
      const configuredOrigin = env.APP_ORIGIN || 'https://awareness.onrushdata.com';
      if (url.origin !== configuredOrigin) return json({ error: 'Host not configured' }, 403);
      const origin = request.headers.get('origin');
      if (origin !== null && origin !== configuredOrigin) return json({ error: 'Origin not allowed' }, 403);
      const local = env.LOCAL_DEV === '1' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
      if (!local && !(await verifyAccess(request, env))) return json({ error: 'Access authentication required' }, 401);

      if (!url.pathname.startsWith('/api/')) {
        if (!env.ASSETS) return json({ error: 'Assets not configured' }, 503);
        return env.ASSETS.fetch(request);
      }
      const methods = STARTUP_METHODS[url.pathname];
      if (!methods) return json({ error: 'Route not enabled' }, 404);
      if (!methods.includes(request.method)) return json({ error: 'Method not allowed' }, 405, { Allow: methods.join(', ') });
      if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: {
        'Access-Control-Allow-Origin': configuredOrigin,
        'Access-Control-Allow-Credentials': 'true',
        'Access-Control-Allow-Methods': methods.join(', '),
        'Access-Control-Allow-Headers': 'Content-Type, X-WorldMonitor-Key',
        'Cache-Control': 'no-store',
      } });
      if (url.pathname === '/api/geo') return json({ country: request.cf?.country || 'XX' });
      if (url.pathname === '/api/bootstrap' && !validBootstrapQuery(url)) return json({ error: 'Dataset query not enabled' }, 400);

      // On Workers this header is supplied by the trusted edge. Never inherit a
      // caller's x-real-ip / forwarding proof into upstream's Vercel adapter.
      const headers = new Headers(request.headers);
      for (const name of ['x-real-ip', 'x-forwarded-for', 'x-wm-edge-proof']) headers.delete(name);
      headers.set('x-real-ip', request.headers.get('cf-connecting-ip') || 'unknown');
      headers.delete('cf-connecting-ip');
      const adapted = new Request(request, { headers });
      const handler = routes[url.pathname];
      if (!handler) return json({ error: 'Route not prepared' }, 503);
      try {
        const response = await withExecution(context, () => handler(adapted, context));
        // Access is private. Upstream CDN headers do not authorize shared caches.
        const secured = new Response(response.body, response);
        secured.headers.set('Cache-Control', 'no-store');
        secured.headers.delete('CDN-Cache-Control');
        secured.headers.delete('Cloudflare-CDN-Cache-Control');
        secured.headers.set('Access-Control-Allow-Origin', configuredOrigin);
        secured.headers.set('Access-Control-Allow-Credentials', 'true');
        const vary = new Set((secured.headers.get('Vary') || '').split(',').map((value) => value.trim()).filter(Boolean));
        vary.add('Origin');
        secured.headers.set('Vary', [...vary].join(', '));
        return secured;
      } catch {
        return json({ error: 'Service temporarily unavailable' }, 503, { 'Retry-After': '5' });
      }
    },
  };
}
