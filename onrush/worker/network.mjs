export function assertAllowedDestination(value) {
  const url = new URL(value);
  const hostname = url.hostname.toLowerCase().replace(/\.+$/, '');
  if (hostname === 'worldmonitor.app' || hostname.endsWith('.worldmonitor.app')) {
    throw new Error('World Monitor hosted services are disabled');
  }
  if (!['https:', 'http:'].includes(url.protocol)) throw new Error('Unsupported fetch protocol');
  return url;
}

// Check every redirect hop too: a permitted publisher must not redirect us to
// the prohibited hosted service. Cross-origin redirects lose sensitive headers.
export function createGuardedFetch(nativeFetch) {
  return async (input, init) => {
    let request = new Request(input, init);
    if (!request.headers.has('User-Agent')) {
      const headers = new Headers(request.headers);
      headers.set('User-Agent', 'Onrush-Awareness/1.0 (+https://github.com/CannonWest/worldmonitor)');
      request = new Request(request, { headers });
    }
    const redirectMode = request.redirect;
    for (let hop = 0; hop <= 5; hop++) {
      assertAllowedDestination(request.url);
      const response = await nativeFetch(new Request(request, { redirect: 'manual' }));
      if (![301, 302, 303, 307, 308].includes(response.status)) return response;
      const location = response.headers.get('location');
      if (!location) return response;
      let target;
      try { target = assertAllowedDestination(new URL(location, request.url)); }
      catch (error) { await response.body?.cancel(); throw error; }
      if (redirectMode === 'manual') return response;
      if (redirectMode === 'error' || hop === 5) {
        await response.body?.cancel();
        throw new Error('Redirect refused');
      }
      // Do not replay request bodies or credentials to a redirect target.
      if (!['GET', 'HEAD'].includes(request.method)) {
        await response.body?.cancel();
        throw new Error('Body redirect refused');
      }
      const headers = new Headers(request.headers);
      if (target.origin !== new URL(request.url).origin) {
        for (const name of ['authorization', 'cookie', 'host', 'x-api-key', 'x-relay-key', 'x-worldmonitor-key',
          'cf-access-jwt-assertion', 'cf-access-client-id', 'cf-access-client-secret']) headers.delete(name);
      }
      await response.body?.cancel();
      request = new Request(target, { method: request.method, headers, signal: request.signal });
    }
    throw new Error('Redirect limit exceeded');
  };
}
