import '../../src/styles/main.css';
import { MapContainer, type MapView } from '@/components/MapContainer';
import { LAYER_REGISTRY } from '@/config/map-layer-definitions';
import type { MapLayers } from '@/types';
import { initI18n } from '@/services/i18n';
import { createEarthquakeFeed } from './earthquakes.mjs';
import type { Earthquake } from '@/services/earthquakes';
import { USGS_URL } from '../shared/earthquakes.mjs';
import { ensureWmSession, installWmSessionFetchInterceptor } from '@/services/wm-session';
import { REFERENCE_LAYERS, readReferenceLayers, writeReferenceLayers } from './catalog.mjs';

const source = `https://github.com/CannonWest/worldmonitor/tree/${__BUILD_HASH__}`;
const storage = {
  getItem: (key: string) => window.localStorage.getItem(key),
  setItem: (key: string, value: string) => window.localStorage.setItem(key, value),
};
const views: Array<[MapView, string]> = [
  ['global', 'Global'], ['america', 'North America'], ['latam', 'Latin America'], ['eu', 'Europe'],
  ['mena', 'Middle East & North Africa'], ['africa', 'Africa'], ['asia', 'Asia'], ['oceania', 'Oceania'],
];

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = ''): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  node.textContent = text;
  return node;
}

function link(label: string, href: string): HTMLAnchorElement {
  const node = element('a', '', label);
  node.href = href;
  node.target = '_blank';
  node.rel = 'noopener noreferrer';
  return node;
}

function button(label: string, action: () => void): HTMLButtonElement {
  const node = element('button', 'oa-button', label);
  node.type = 'button';
  node.addEventListener('click', action);
  return node;
}

export async function startDashboard(): Promise<void> {
  await initI18n({ waitForFullTranslation: true });
  installWmSessionFetchInterceptor();
  const root = document.getElementById('app')!;
  root.replaceChildren();
  root.className = 'oa-app';
  const header = element('header', 'oa-header');
  const identity = element('div', 'oa-identity');
  identity.append(element('span', 'oa-eyebrow', 'ONRUSH DATA'), element('h1', '', 'Awareness'));
  const headerActions = element('div', 'oa-header-actions');
  headerActions.append(element('span', 'oa-reference-badge', 'Earthquakes + reference'));
  const sources = element('dialog', 'oa-source-dialog');
  sources.setAttribute('aria-labelledby', 'oa-sources-title');
  const sourceTitle = element('h2', '', 'Source register');
  sourceTitle.id = 'oa-sources-title';
  sources.append(sourceTitle, element('p', '', 'Bundled reference data from World Monitor. Coordinates and status fields are retained from the saved datasets; they are not current operational observations. Source-specific licence review remains pending.'));
  const table = element('table');
  const tableHead = element('thead');
  const heading = element('tr');
  for (const title of ['Layer', 'Placement & limits', 'Provenance']) heading.append(element('th', '', title));
  tableHead.append(heading);
  const rows = element('tbody');
  for (const layer of REFERENCE_LAYERS) {
    const row = element('tr');
    const provenance = element('td');
    provenance.append(link('Bundled source', `${source}/${layer.file}`));
    row.append(element('td', '', layer.label), element('td', '', layer.detail), provenance);
    rows.append(row);
  }
  const earthquakeSource = element('tr');
  const earthquakeProvenance = element('td');
  earthquakeProvenance.append(link('USGS GeoJSON feed', USGS_URL));
  earthquakeSource.append(element('td', '', 'Earthquakes'), element('td', '', 'USGS M4.5+ · past 7 days. Scheduled every 5 minutes; preliminary records can change. Retrieval and source-generation times are shown separately.'), earthquakeProvenance);
  rows.append(earthquakeSource);
  table.append(tableHead, rows);
  sources.append(table, element('p', 'oa-muted', 'Country outlines reuse the fork’s existing bundled country assets. This reference build does not include detailed map tiles or satellite imagery.'), button('Close source register', () => sources.close()));
  headerActions.append(button('Sources', () => sources.showModal()));
  header.append(identity, headerActions);

  const workspace = element('main', 'oa-workspace');
  const mapSection = element('section', 'oa-map-section');
  mapSection.setAttribute('aria-label', 'World map with earthquake and reference layers');
  const toolbar = element('div', 'oa-map-toolbar');
  const regionLabel = element('label', 'oa-region-label', 'View ');
  const region = element('select');
  region.id = 'oa-region';
  for (const [value, label] of views) {
    const option = element('option', '', label);
    option.value = value;
    region.append(option);
  }
  regionLabel.append(region);
  const rendererStatus = element('span', 'oa-muted', 'Loading map…');
  rendererStatus.id = 'oa-renderer';
  const mapElement = element('div', 'oa-map');
  mapElement.id = 'mapContainer';
  const selected = readReferenceLayers(storage);
  const layers = Object.fromEntries(Object.keys(LAYER_REGISTRY).map((key) => [key, selected[key] === true])) as unknown as MapLayers;
  const map = new MapContainer(mapElement, { zoom: 1, pan: { x: 0, y: 0 }, view: 'global', layers, timeRange: 'all' }, false, { chrome: false });
  region.addEventListener('change', () => { map.setView(region.value as MapView); });
  toolbar.append(regionLabel, button('−', () => map.setZoom(Math.max(1, map.getState().zoom - 0.5))),
    button('+', () => map.setZoom(Math.min(8, map.getState().zoom + 0.5))),
    button('Reset view', () => { region.value = 'global'; map.setView('global', 1); }), rendererStatus);
  toolbar.querySelectorAll('button')[0]?.setAttribute('aria-label', 'Zoom out');
  toolbar.querySelectorAll('button')[1]?.setAttribute('aria-label', 'Zoom in');
  const mapCaption = element('div', 'oa-map-caption', 'USGS EARTHQUAKES + BUNDLED REFERENCE · Infrastructure routes are indicative');
  mapSection.append(toolbar, mapElement, mapCaption);
  const sidebar = element('aside', 'oa-sidebar');
  const layerPanel = element('section', 'oa-card');
  const layerHeading = element('div', 'oa-card-heading');
  const layerCount = element('span', 'oa-muted');
  layerCount.id = 'oa-layer-count';
  layerHeading.append(element('h2', '', 'Reference layers'), layerCount);
  layerPanel.append(layerHeading, element('p', 'oa-muted', 'Zoom in to distinguish individual sites.'));
  let lastGroup = '';
  const updateCount = () => { layerCount.textContent = `${Object.values(selected).filter(Boolean).length} / ${REFERENCE_LAYERS.length}`; };
  for (const layer of REFERENCE_LAYERS) {
    if (lastGroup !== layer.group) {
      layerPanel.append(element('h3', 'oa-layer-group', layer.group));
      lastGroup = layer.group;
    }
    const row = element('label', 'oa-layer-row');
    const input = element('input');
    input.type = 'checkbox';
    input.dataset.layer = layer.key;
    input.checked = selected[layer.key] === true;
    input.addEventListener('change', () => {
      selected[layer.key] = input.checked;
      layers[layer.key as keyof MapLayers] = input.checked;
      map.setLayers(layers);
      writeReferenceLayers(storage, selected);
      updateCount();
    });
    row.append(input, element('span', '', layer.label));
    layerPanel.append(row);
  }
  updateCount();
  const context = element('section', 'oa-card oa-context');
  context.append(element('h2', '', 'Reading this picture'), element('p', '', 'These are saved reference locations and routes. A visible site does not imply current activity, and a route is not evidence of a disruption.'));
  const countryStatus = element('p', 'oa-muted', 'Select a country to highlight it.');
  countryStatus.id = 'oa-country';
  map.onCountryClicked(({ code, name }) => {
    if (code) map.highlightCountry(code);
    countryStatus.textContent = `${name || code || 'Country'} · reference outlines only`;
  });
  context.append(countryStatus);
  const dataPanel = element('section', 'oa-card');
  dataPanel.append(element('h2', '', 'Earthquakes'), element('p', 'oa-muted', 'USGS M4.5+ · past 7 days'));
  const earthquakeToggle = element('input');
  earthquakeToggle.id = 'oa-earthquakes-toggle';
  earthquakeToggle.type = 'checkbox';
  try { earthquakeToggle.checked = storage.getItem('onrush:earthquakes-layer:v1') !== 'false'; }
  catch { earthquakeToggle.checked = true; }
  const earthquakeLabel = element('label', 'oa-layer-row');
  earthquakeLabel.append(earthquakeToggle, element('span', '', 'Show earthquakes'));
  layers.natural = earthquakeToggle.checked;
  earthquakeToggle.addEventListener('change', () => {
    layers.natural = earthquakeToggle.checked;
    map.setLayers(layers);
    try { storage.setItem('onrush:earthquakes-layer:v1', String(earthquakeToggle.checked)); } catch { /* memory state remains usable */ }
  });
  map.setLayers(layers);
  const sessionStatus = element('p', 'oa-muted', 'Connecting…');
  sessionStatus.id = 'oa-session-status';
  const dataStatus = element('p', '', 'Checking earthquake feed…');
  dataStatus.id = 'oa-data-status';
  dataStatus.setAttribute('role', 'status');
  const feedTimes = element('p', 'oa-muted');
  feedTimes.id = 'oa-feed-times';
  const refresh = button('Check again', () => { void checkStartup(); });
  dataPanel.append(earthquakeLabel, sessionStatus, dataStatus, feedTimes,
    link('USGS source', USGS_URL), element('p', 'oa-muted', 'Checks every 5 minutes while this page is visible. Records are preliminary. Weather alerts are pending.'), refresh);
  sidebar.append(layerPanel, context, dataPanel);
  workspace.append(mapSection, sidebar);
  const footer = element('footer', 'oa-footer');
  footer.append(element('span', '', 'Onrush Data LLC · '), link('Based on World Monitor', 'https://github.com/koala73/worldmonitor'),
    link('Source · AGPL-3.0-only', source), link('Licence', '/LICENSE'));
  root.append(header, workspace, footer, sources);

  const feed = createEarthquakeFeed(({ state, snapshot }: { state: string; snapshot: { earthquakes: Earthquake[]; _onrush: { sourceGeneratedAt: number; fetchedAt: number } } | null }) => {
    dataStatus.dataset.state = state;
    const messages: Record<string, string> = {
      missing: 'Earthquake feed has not been seeded. Missing data does not mean zero events.',
      unavailable: snapshot ? 'Refresh unavailable. Showing the last received snapshot; its timestamps have not advanced.' : 'Earthquake data is unavailable. Missing data does not mean zero events.',
      expired: 'The earthquake snapshot has expired. Markers are hidden until a valid refresh arrives.',
    };
    const count = snapshot?.earthquakes.length ?? 0;
    dataStatus.textContent = messages[state] || `${count} ${count === 1 ? 'event' : 'events'} in the USGS M4.5+ seven-day snapshot${state === 'stale' ? ' · STALE' : ''}.`;
    const meta = snapshot?._onrush;
    feedTimes.textContent = meta ? `Source generated: ${new Date(meta.sourceGeneratedAt).toLocaleString()} · Retrieved: ${new Date(meta.fetchedAt).toLocaleString()}` : '';
    // Explicit replacement also clears a legitimate empty collection and an
    // expired snapshot; upstream otherwise preserves old nonempty SVG data.
    map.setEarthquakes((snapshot?.earthquakes ?? []) as Earthquake[], { replaceEmpty: true });
    document.documentElement.dataset.onrushDataReady = 'true';
  });
  async function checkStartup(): Promise<void> {
    refresh.disabled = true;
    const session = await ensureWmSession().catch(() => false);
    sessionStatus.textContent = session ? 'Connection established' : 'Connection unavailable; reference map remains usable';
    await feed.refresh();
    refresh.disabled = false;
  }
  const refreshClock = window.setInterval(() => {
    feed.reassess();
    if (document.visibilityState === 'visible') void feed.tick();
  }, 60_000);
  const resume = () => { if (document.visibilityState === 'visible') void feed.tick(); };
  document.addEventListener('visibilitychange', resume);
  void checkStartup();
  await map.whenRendererReady();
  const attribution = mapElement.querySelector('.map-attribution');
  if (attribution) attribution.replaceChildren(link('Bundled reference outlines', `${source}/public/data`));
  rendererStatus.textContent = 'World map';
  rendererStatus.dataset.renderer = map.isDeckGLActive() ? 'deck' : 'svg';
  document.documentElement.dataset.onrushReady = 'true';
  window.addEventListener('pagehide', (event) => {
    if (!event.persisted) {
      clearInterval(refreshClock);
      document.removeEventListener('visibilitychange', resume);
      feed.stop();
      map.destroy();
    }
  });
}
