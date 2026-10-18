import assert from 'node:assert/strict';
import { test } from 'node:test';
import { REFERENCE_LAYERS, readReferenceLayers, writeReferenceLayers, LAYER_STORAGE_KEY } from '../client/catalog.mjs';

test('stale upstream preferences cannot restore unported feeds or unknown layers', () => {
  const layers = readReferenceLayers({ getItem: () => JSON.stringify({ cables: false, bases: true,
    weather: true, military: true, outages: true, protests: true, webcams: true, unknown: true }) });
  assert.equal(layers.cables, false);
  assert.equal(layers.bases, true);
  assert.deepEqual(Object.keys(layers), REFERENCE_LAYERS.map((layer) => layer.key));
  assert.equal(layers.weather, undefined);
  assert.equal(layers.military, undefined);
});

test('unavailable storage and malformed preferences still produce a usable reference view', () => {
  const defaults = readReferenceLayers({ getItem: () => null });
  assert.deepEqual(readReferenceLayers({ getItem: () => { throw new Error('storage blocked'); } }), defaults);
  assert.deepEqual(readReferenceLayers({ getItem: () => '{bad json' }), defaults);
  assert.deepEqual(readReferenceLayers({ getItem: () => JSON.stringify({ cables: 'false', bases: 1 }) }), defaults);
});

test('saved preferences contain only the approved reference set', () => {
  let saved;
  writeReferenceLayers({ setItem(key, value) { saved = { key, value }; } }, { cables: false, military: true });
  assert.equal(saved.key, LAYER_STORAGE_KEY);
  const layers = JSON.parse(saved.value);
  assert.equal(layers.cables, false);
  assert.equal(layers.military, undefined);
  assert.equal(Object.keys(layers).length, REFERENCE_LAYERS.length);
  assert.doesNotThrow(() => writeReferenceLayers({ setItem() { throw new Error('quota'); } }, {}));
});
