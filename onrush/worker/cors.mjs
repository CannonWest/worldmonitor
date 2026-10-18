// Bundle-time adapter for both upstream CORS modules. No upstream source edits.
function appOrigin() {
  return process.env.APP_ORIGIN || 'https://awareness.onrushdata.com';
}

export function isAllowedOrigin(origin) {
  return origin === appOrigin();
}

export const isHostedAppOrigin = isAllowedOrigin;

export function isDisallowedOrigin(request) {
  const origin = request.headers.get('origin');
  return origin !== null && !isAllowedOrigin(origin);
}

export function getCorsHeaders(request, methods = 'GET, POST, OPTIONS') {
  return {
    'Access-Control-Allow-Origin': appOrigin(),
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Allow-Methods': methods,
    'Access-Control-Allow-Headers': 'Content-Type, X-WorldMonitor-Key',
    'Access-Control-Max-Age': '3600',
    Vary: 'Origin',
  };
}

export function getOriginDeniedCorsHeaders(request, methods) {
  return getCorsHeaders(request, methods);
}

export function getPublicCorsHeaders(methods = 'GET, OPTIONS') {
  return { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': methods };
}
