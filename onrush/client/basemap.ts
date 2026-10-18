// Keep upstream's configuration interface, with only the local reference style
// active in this build. Persisted provider choices cannot restore a remote CDN.
export type MapProvider = 'auto' | 'pmtiles' | 'openfreemap' | 'carto';
export type PMTilesTheme = 'black' | 'dark' | 'grayscale' | 'light' | 'white';
export type OpenFreeMapTheme = 'dark' | 'positron';
export type CartoTheme = 'dark-matter' | 'voyager' | 'positron';
export const R2_BASE = '';
export const hasPMTilesUrl = false;
export const FALLBACK_DARK_STYLE = '/data/reference-style.json';
export const FALLBACK_LIGHT_STYLE = FALLBACK_DARK_STYLE;
export const MAP_PROVIDER_OPTIONS = [{ value: 'openfreemap', label: 'Bundled reference map' }];
export const MAP_THEME_OPTIONS = Object.fromEntries(['auto', 'pmtiles', 'openfreemap', 'carto'].map((key) => [key, [{ value: 'dark', label: 'Dark' }]]));
export function getMapProvider(): MapProvider { return 'openfreemap'; }
export function getMapTheme(_provider: MapProvider): string { return 'dark'; }
export function setMapProvider(_provider: MapProvider): void {}
export function setMapTheme(_provider: MapProvider, _theme: string): void {}
export function isLightMapTheme(_theme: string): boolean { return false; }
export function asPMTilesTheme(_theme: string): PMTilesTheme { return 'dark'; }
