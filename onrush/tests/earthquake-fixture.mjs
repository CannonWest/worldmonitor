import { normalizeUsgs } from '../worker/earthquakes.mjs';

export function usgsFixture(now = Date.now()) {
  return { type: 'FeatureCollection', metadata: { status: 200, generated: now - 30_000, count: 1 },
    features: [{ type: 'Feature', id: 'us-fixture-one', geometry: { type: 'Point', coordinates: [147, -6, 12] },
      properties: { type: 'earthquake', mag: 5.1, time: now - 60_000, place: 'Fixture earthquake near Papua New Guinea',
        url: 'https://earthquake.usgs.gov/earthquakes/eventpage/us-fixture-one' } }] };
}
export function earthquakeFixture(now = Date.now()) { return normalizeUsgs(usgsFixture(now), now); }
