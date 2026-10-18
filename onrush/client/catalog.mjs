// Only bundled reference layers belong here. A stored setting cannot opt a
// user into a feed whose producer and reader have not been ported.
export const REFERENCE_LAYERS = Object.freeze([
  { key: 'cables', label: 'Undersea cables', group: 'Infrastructure', file: 'src/config/geo-map.ts', detail: 'Indicative routes and landing points', enabled: true },
  { key: 'pipelines', label: 'Pipelines', group: 'Infrastructure', file: 'src/config/pipelines.ts', detail: 'Curated routes; no operating telemetry', enabled: false },
  { key: 'waterways', label: 'Strategic waterways', group: 'Infrastructure', file: 'src/config/geo.ts', detail: 'Reference chokepoints; no vessel counts', enabled: true },
  { key: 'datacenters', label: 'AI data centers', group: 'Infrastructure', file: 'src/config/ai-datacenters.ts', detail: 'Curated facility locations', enabled: false },
  { key: 'bases', label: 'Military bases', group: 'Strategic sites', file: 'src/config/military-bases.ts', detail: 'Curated locations; no activity tracking', enabled: false },
  { key: 'nuclear', label: 'Nuclear sites', group: 'Strategic sites', file: 'src/config/geo-map.ts', detail: 'Reference facilities; no radiation observations', enabled: false },
  { key: 'spaceports', label: 'Spaceports', group: 'Strategic sites', file: 'src/config/geo-map.ts', detail: 'Reference launch locations', enabled: false },
  { key: 'minerals', label: 'Critical minerals', group: 'Strategic sites', file: 'src/config/geo-map.ts', detail: 'Curated projects; no production estimates', enabled: false },
  { key: 'dayNight', label: 'Day / night', group: 'Reference', file: 'src/components/Map.ts', detail: 'Calculated solar terminator', enabled: false },
]);

export const LAYER_STORAGE_KEY = 'onrush:reference-layers:v1';

export function readReferenceLayers(storage) {
  let saved;
  try { saved = JSON.parse(storage.getItem(LAYER_STORAGE_KEY) || 'null'); } catch { /* use defaults */ }
  return Object.fromEntries(REFERENCE_LAYERS.map(({ key, enabled }) => [key,
    saved && typeof saved === 'object' && typeof saved[key] === 'boolean' ? saved[key] : enabled,
  ]));
}

export function writeReferenceLayers(storage, layers) {
  try {
    storage.setItem(LAYER_STORAGE_KEY, JSON.stringify(Object.fromEntries(
      REFERENCE_LAYERS.map(({ key, enabled }) => [key, typeof layers[key] === 'boolean' ? layers[key] : enabled]),
    )));
  } catch { /* The current view still works when storage is unavailable. */ }
}
