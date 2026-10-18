// One contract for the browser boundary and the Worker dispatcher. Expand this
// only when the matching producer, handler and consumer have been verified.
export const STARTUP_METHODS = Object.freeze({
  '/api/wm-session': Object.freeze(['POST', 'OPTIONS']),
  '/api/bootstrap': Object.freeze(['GET', 'OPTIONS']),
  '/api/geo': Object.freeze(['GET', 'OPTIONS']),
});

export const SELECTED_KEYS = Object.freeze(['earthquakes', 'weatherAlerts']);

export function validBootstrapQuery(url) {
  const names = [...url.searchParams.keys()];
  if (new Set(names).size !== names.length || names.some((name) => !['keys', 'tier', 'public'].includes(name))) return false;
  if (url.searchParams.has('public') && url.searchParams.get('public') !== '1') return false;
  const tier = url.searchParams.get('tier');
  const requested = url.searchParams.get('keys');
  if (tier && requested !== null) return false;
  if (tier !== null) return ['fast', 'slow'].includes(tier);
  if (requested !== null) {
    const keys = requested.split(',');
    return keys.length <= SELECTED_KEYS.length && new Set(keys).size === keys.length
      && keys.every((key) => SELECTED_KEYS.includes(key));
  }
  return false; // A bare bootstrap must not regain the upstream registry.
}
