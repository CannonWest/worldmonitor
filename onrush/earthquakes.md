# Earthquakes (lean port, area 3)

The first live layer uses the [USGS M4.5+ seven-day GeoJSON feed](https://earthquake.usgs.gov/earthquakes/feed/v1.0/geojson.php).
It keeps the fork's earthquake record shape, canonical Redis key and existing
`MapContainer.setEarthquakes` path for both SVG and deck.gl. The source is USGS
only; NRCan merge/dedup, test-site concern scores and other natural-event feeds
are outside this slice. USGS records remain preliminary and can be revised.

## Producer and reader

The same Worker runs `scheduledEarthquakes` every five minutes (`*/5 * * * *`, UTC)
when `EARTHQUAKES_ENABLED=1`. It makes one bounded, timed USGS request and one
Redis EVAL publication. Source generation must be no older than 15 minutes;
collection counts, event fields, coordinates, IDs and source links are validated.
Non-earthquake seismic events such as quarry blasts are excluded. Malformed,
oversized, redirected, stale or failed responses leave the previous seed intact.

Publication atomically replaces `seismology:earthquakes:v1` and
`seed-meta:seismology:earthquakes`. A delayed job cannot replace a newer source
generation or later retrieval. Data expires after six hours; diagnostic seed
metadata expires after 24 hours. No failure advances the snapshot's clocks.
Structured Worker logs record scheduled time, publication result, record count,
source generation and retrieval, or a generic failure without credential values.

`GET /api/seismology/v1/list-earthquakes` accepts no query parameters. It requires
the same signed Access JWT as assets and other APIs, reads only the owned Redis
key and returns the records with `_onrush` metadata. It never fetches a provider
on a cache miss. Missing seeds return `{state:"missing"}`; a valid empty snapshot
returns zero records; invalid/expired snapshots and Redis errors return 503.
Responses are private `no-store`. The existing bootstrap reader can also consume
this canonical payload, but the dashboard now uses this single-key endpoint.

## Browser behavior

The dashboard reads on startup, supports manual retry and checks every five
minutes while visible. Its minute clock reassesses age even during an outage;
returning to the page checks whether a refresh is due. No browser provider fetch
or persistent event cache is used. The layer preference is stored separately
from the nine reference layers and cannot enable unported natural-event feeds.

Source-generated and retrieved timestamps are shown separately. A snapshot is
stale when either clock is older than 15 minutes. Failed reads retain only the
current page's last good snapshot with an explicit failure label and unchanged
timestamps; after six hours markers are hidden. Valid empty results explicitly
replace old markers. Event details show magnitude, place, occurrence time, depth
and a validated USGS link, without hazard/impact inference or live context calls.

## Verification and operations

Run `npm --prefix onrush test`, `run typecheck`, `run test:runtime`,
`run test:dashboard`, `run test:dashboard:webgl` and `run check:worker`.
The browser checks use signed Access JWT fixtures, mocked Redis and a synthetic
earthquake, including toggle/reload, SVG details, stale/outage/empty/recovery and
390px layout. WebGL uses native WebGL2 with SwiftShader and requires rendered
basemap pixels before screenshots. These fixtures do not establish live freshness
or hardware-GPU performance. The runtime smoke dispatches the actual scheduled
handler through `workerd`, then reads its mocked publication via the private API
and bootstrap. Lua publication semantics must also be observed on owned Redis.

Use the [deployment procedure](startup.md#deployment). Preserve all three existing
secrets and the Access policy. After deployment, observe a successful real cron
log and an authenticated endpoint/page read, then verify a subsequent scheduled
generation and browser refresh. `wrangler tail --config onrush/wrangler.jsonc`
can observe executions. Disabling `EARTHQUAKES_ENABLED` stops producer writes;
remove the cron to unschedule it. Missing or aging data must stay visibly marked.
