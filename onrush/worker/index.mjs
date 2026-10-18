import session from '../../api/wm-session.js';
import bootstrap from '../../api/bootstrap.js';
import { createWorker } from './core.mjs';
import { createGuardedFetch } from './network.mjs';
import { earthquakeHandler, scheduledEarthquakes } from './earthquakes.mjs';

const nativeFetch = (...args) => fetchBeforeGuard(...args);
const fetchBeforeGuard = globalThis.fetch;
globalThis.fetch = createGuardedFetch(nativeFetch);

export default { ...createWorker({ routes: {
  '/api/wm-session': session,
  '/api/bootstrap': bootstrap,
  '/api/seismology/v1/list-earthquakes': earthquakeHandler,
} }), scheduled: scheduledEarthquakes };
