import { STARTUP_METHODS, validBootstrapQuery } from '../shared/startup-policy.mjs';
import { assertAllowedDestination } from '../worker/network.mjs';

export function createAppFetch(nativeFetch, appOrigin) {
  const origin = new URL(appOrigin).origin;
  return async (input, init) => {
    const target = input instanceof Request ? input : new URL(input, origin);
    const request = new Request(target, init);
    const url = assertAllowedDestination(request.url);
    if (url.pathname.startsWith('/api/')) {
      if (url.origin !== origin) throw new TypeError('API requests must use the application origin');
      if (!STARTUP_METHODS[url.pathname]?.includes(request.method)) throw new TypeError('Route not enabled');
      if (url.pathname === '/api/bootstrap' && !validBootstrapQuery(url)) throw new TypeError('Dataset query not enabled');
      // Access protects even upstream's "public" bootstrap URL. Its omit flag
      // would otherwise discard CF_Authorization. Install this adapter before
      // upstream's fetch wrappers so their early-return paths still reach it.
      return nativeFetch(new Request(request, { credentials: 'include', redirect: 'error' }));
    }
    // Browser manual redirects conceal their Location (opaqueredirect), so
    // fail closed instead of following an unchecked hop to a prohibited host.
    return nativeFetch(new Request(request, { redirect: 'error' }));
  };
}

export function installAppFetch(target = window) {
  const original = target.fetch;
  const guarded = createAppFetch((...args) => Reflect.apply(original, target, args), target.location.origin);
  target.fetch = guarded;
  return () => { if (target.fetch === guarded) target.fetch = original; };
}
