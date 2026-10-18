# Reference dashboard (lean port, area 2)

Area 2 connects the startup Worker to a small Onrush browser entry, reusing World
Monitor's `MapContainer`, D3/SVG renderer, MapLibre/deck.gl renderer and bundled
datasets. The full upstream application stays in the repository. No upstream
implementation file is changed. The dashboard uses the same Access-protected
hostname and Worker as the original OA-M0 holding page.

The built page provides nine reference layers: cables, pipelines, waterways, AI
data centers, bases, nuclear sites, spaceports, critical minerals and day/night.
It includes region/zoom controls, persisted layers, reference details, a source
register, distinct branding, a licence link and a source offer pinned to the
build's Git commit. Saved locations and statuses do not establish current
activity or disruption. Source-specific data licence review remains pending.

## Integration boundaries

`client/entry.mjs` installs the fetch guard before evaluating upstream modules.
`dashboard.ts` starts the reusable map directly. It does not start `src/main.ts`,
`App.ts`, the full panel registry, accounts, analytics, notifications, MCP, media
or the desktop lifecycle. Panels follow separately with their ported producers.

The Onrush Vite configuration redirects variant/basemap modules and map popups
to additive adapters. It pins the runtime variant to `full`. Persisted variant
and CARTO/PMTiles choices cannot restore another catalogue or remote provider.
The basemap is a local country-outline style. Existing country/TopoJSON assets
are copied unchanged; an empty local override disables the upstream hosted
boundary default. No new boundaries or imagery sources are introduced. Detailed
tiles and the Solomon imagery stack remain later map work.

Only catalogue keys are restored or saved; all other renderer layers start
false. Reference popups show bundled descriptions/provenance without invoking
chokepoint history, live context, premium gates or unported readers. The original
upstream popup implementation and data remain unchanged.

The entry mints an owned session and reads the fast bootstrap tier (two Redis
GETs). It skips the empty slow tier. The response reader distinguishes missing
seeds, a received snapshot and an unavailable/malformed response. A snapshot
does not establish freshness; live overlays are not yet wired. Reference
interaction remains usable during an API outage, with a retry control.

Worker asset responses carry `no-store`, `noindex`, `nosniff`, a same-origin CSP,
no frames and restricted browser permissions. Inline styles support the map
renderers; scripts are self-only. Environment-file loading is disabled, and the
ordinary `VITE_*` prefix is not exposed to this build.

## Reproduce the proof

From the repository root after the installs in [startup.md](startup.md):

```powershell
npm --prefix onrush test
npm --prefix onrush run typecheck
npm --prefix onrush run build
npm --prefix onrush run test:browser
npm --prefix onrush run test:runtime
npm --prefix onrush run test:dashboard
npm --prefix onrush run test:dashboard:webgl
npm --prefix onrush run check:worker
npm run typecheck
npm run lint:boundaries
npm run typecheck:api
```

The dashboard tests drive real production assets through the built Worker in
`workerd`. A local bridge models the trusted Access edge; the Worker verifies a
signed JWT against mocked JWKS. Redis is mocked too. No live credentials or
providers are used. External browser requests are aborted and fail the test;
CSP violations and uncaught errors also fail. The intentional outage returns 503.

The SVG drive covers desktop/390px layouts, country paths, layer removal,
persistence/reload, a waterway popup, source register, session cookies, missing
seeds, outage and recovery. The WebGL drive renders native WebGL2 with SwiftShader
and the repository's GPU-identity privacy fixture (`e2e/mcp-news-map.spec.ts`). It
requires the deck renderer and exercises local worker/basemap assets, controls,
persistence and recovery under CSP. It does not establish hardware-GPU performance.

Screenshots and request/CSP/error logs go under `onrush/dist/evidence/svg/` and
`webgl/`. `ONRUSH_EVIDENCE_DIR` overrides one run's destination. PR screenshots
must identify the tested commit and be refreshed after further UI changes.

The dry run packages the dashboard without uploading. Local proof does not
establish deployed Access, live freshness/refresh, source terms clearance or
production GPU behavior. Deployment is a separate authorized action using the
[startup deployment procedure](startup.md#deployment); no seeder runs with it.
