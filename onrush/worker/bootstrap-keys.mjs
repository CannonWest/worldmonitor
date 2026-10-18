import {
  BOOTSTRAP_CACHE_KEYS as upstreamKeys,
  BOOTSTRAP_TIERS as upstreamTiers,
  PUBLIC_WEATHER_BOOTSTRAP_KEY,
} from '../../shared/bootstrap-tier-keys.js';
import { SELECTED_KEYS } from '../shared/startup-policy.mjs';

// First live slice only. Enabling a panel does not implicitly add a dataset.
export { PUBLIC_WEATHER_BOOTSTRAP_KEY, SELECTED_KEYS };
export const BOOTSTRAP_CACHE_KEYS = Object.freeze(Object.fromEntries(
  SELECTED_KEYS.map((key) => [key, upstreamKeys[key]]),
));
export const BOOTSTRAP_TIERS = Object.freeze(Object.fromEntries(
  SELECTED_KEYS.map((key) => [key, upstreamTiers[key]]),
));

export function bootstrapTierKeyNames(tier) {
  if (!['fast', 'slow', 'on-demand'].includes(tier)) throw new TypeError('Unknown bootstrap tier');
  return SELECTED_KEYS.filter((key) => BOOTSTRAP_TIERS[key] === tier);
}

export function resolveBootstrapRegistry() {
  return { cacheKeys: { ...BOOTSTRAP_CACHE_KEYS }, tiers: { ...BOOTSTRAP_TIERS } };
}
