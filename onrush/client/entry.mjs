import { installAppFetch } from './network.mjs';
import './styles.css';

// Install before evaluating any upstream module. This entry intentionally
// starts the reusable map, not the full account/analytics/feed application.
installAppFetch();
void import('./dashboard.ts').then(({ startDashboard }) => startDashboard()).catch((error) => {
  console.error('[Onrush] Dashboard startup failed', error);
  const root = document.getElementById('app');
  if (root) {
    root.textContent = 'The reference map could not start. Reload the page to try again.';
    root.setAttribute('role', 'alert');
  }
});
