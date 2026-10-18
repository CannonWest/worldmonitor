import { createRemoteJWKSet, jwtVerify } from 'jose';

export function createAccessVerifier(resolveKeys = (url) => createRemoteJWKSet(url, { timeoutDuration: 5000 })) {
  const keys = new Map();
  return async function verifyAccess(request, env) {
    const token = request.headers.get('cf-access-jwt-assertion');
    const team = env.ACCESS_TEAM_DOMAIN;
    const audience = env.ACCESS_AUD;
    if (!token || !team || !audience) return false;
    let issuer;
    try {
      const url = new URL(team);
      if (url.protocol !== 'https:' || !/^[a-z0-9-]+\.cloudflareaccess\.com$/.test(url.hostname)
        || url.port || url.pathname !== '/' || url.search || url.hash || url.username || url.password) return false;
      issuer = url.origin;
    } catch { return false; }
    try {
      let key = keys.get(issuer);
      if (!key) {
        key = resolveKeys(new URL('/cdn-cgi/access/certs', issuer));
        keys.set(issuer, key);
      }
      await jwtVerify(token, key, { issuer, audience, algorithms: ['RS256'], requiredClaims: ['exp'] });
      return true;
    } catch { return false; }
  };
}

export const verifyAccess = createAccessVerifier();
