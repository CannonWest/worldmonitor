# Startup boundary (lean port, area 1)

This is the first implementation area, built on the existing Onrush fork and
holding page. It adapts the real upstream session and bootstrap handlers to a
Cloudflare Worker without changing upstream files. The live site remains OA-M0;
this area does not claim a working dashboard or live feeds.

## Request contract

| Path | Methods | Behavior |
|---|---|---|
| `/api/wm-session` | POST, OPTIONS | Upstream HMAC session, HttpOnly host-only cookie and Redis limiter |
| `/api/bootstrap` | GET, OPTIONS | Only earthquakes and weather alerts; missing keys remain explicitly missing |
| `/api/geo` | GET, OPTIONS | Cloudflare country code, or `XX` when unavailable |

All other API paths are refused. Bootstrap accepts `tier=fast`, `tier=slow`, or
`keys=earthquakes,weatherAlerts` (including a single selected key), optionally
`public=1`. The fast tier reads two Redis keys. The slow tier is empty and reads
none. Bare requests, unknown parameters, duplicate parameters/keys and unknown
datasets are refused. `public=1` retains its upstream URL shape; it never bypasses
Access. A missing seed is not evidence of zero events or of a healthy feed.

Every request, including static assets, requires a signed Cloudflare Access JWT
for the configured team issuer and application audience. Tokens require expiry.
Foreign Host/Origin requests are refused. A local bypass requires both
`LOCAL_DEV=1` and a loopback `APP_ORIGIN` matching the request; setting that flag
cannot bypass Access on the public hostname.

The Worker replaces caller-supplied forwarding headers with the edge's
`CF-Connecting-IP` before invoking upstream. Two client IPs therefore retain
separate limiter buckets. API responses use `no-store`, exact-origin credentialed
CORS, and remove upstream shared-CDN cache directives. `@vercel/functions`
`waitUntil` is adapted to the current request's execution context.

Server fetches reject World Monitor hosted domains, including redirect targets.
Cross-origin redirects discard credential headers. The browser adapter rejects
those domains and disabled API routes before issuing a request. Browser redirects
fail closed because their intermediate destinations cannot be inspected safely.

## Browser integration for the next area

`client/network.mjs` is tested but **not yet installed in the dashboard entry**.
The next area must install it before dynamically importing upstream startup:

```js
import { installAppFetch } from './network.mjs';
installAppFetch();
await import('../../src/main.ts');
```

The inner adapter forces `credentials: 'include'` on allowed same-origin API
requests. Upstream deliberately uses `omit` for public bootstrap; behind Access,
that drops the `CF_Authorization` cookie and prevents hydration. Outer upstream
fetch wrappers must delegate to this adapter even on their early-return paths.

This fetch boundary alone does not cover script tags, images, preconnects,
iframes, workers or sockets. The dashboard area must also remove hosted-service
defaults and analytics, filter the resolved panel and map-layer registries,
configure local boundary assets, and verify the actual built page's requests.
Keep the internal runtime variant `full` until validators and server catalogues
support another value consistently; product branding is independent.

## Local verification

Use Node 24. Install root dependencies and the pinned local Worker tooling:

```powershell
npm ci --ignore-scripts --no-audit --no-fund
npm ci --prefix onrush --ignore-scripts --no-audit --no-fund
npm --prefix onrush test
npm --prefix onrush run test:browser
npm --prefix onrush run test:runtime
npm --prefix onrush run check:worker
npm run typecheck:api
node --test api/wm-session.test.mjs api/bootstrap-cors.test.mjs api/bootstrap-auth.test.mjs
```

The browser check needs Chromium (`npx playwright install chromium` if absent).
It proves an HttpOnly fixture cookie survives an upstream-style `omit` request,
while an unadapted request gets 401. It refuses redirects and records zero
external requests. This is a network fixture, not dashboard UI verification.

The integration tests bundle actual upstream handlers with Onrush adapters.
They check session issuance, cookie attributes, authenticated reads, separate IP
limiter keys, missing seeds, Redis failure, strict route/dataset filtering,
Access signature/issuer/audience/expiry, and guarded redirects. The runtime smoke
executes the built Worker in `workerd` with all outbound traffic mocked. It
verifies signed Access JWT fixtures against a mocked certificate endpoint, rejects
the wrong audience and missing tokens, then exercises bootstrap and session minting.
The dry run packages the Worker and holding assets
without uploading them. These checks do not prove deployed Access, production
freshness, seeder operation, refresh behavior, or dashboard rendering.

## Deployment prerequisites

`wrangler.jsonc` deliberately still serves `holding/site`. Its `ACCESS_AUD` must
be set to the existing Access application's audience for this hostname. Required
Worker secrets are `WM_SESSION_SECRET` (at least 32 random characters),
`UPSTASH_REDIS_REST_URL`, and `UPSTASH_REDIS_REST_TOKEN`. Never commit values or
`.dev.vars`. Do not provision upstream World Monitor accounts or keys.

No deploy is part of this area. M0's original configuration stays in
`holding/wrangler.jsonc`. Before deploying the dashboard, complete its own build,
branding/source offer, request audit and static-asset checks. First live feeds
then need owned earthquake/weather producers and reader/refresh verification;
the startup reader does not fetch USGS or NWS on a cache miss.
