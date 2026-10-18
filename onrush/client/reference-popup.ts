import { MapPopup as UpstreamMapPopup } from '../../src/components/MapPopup';
import { REFERENCE_LAYERS } from './catalog.mjs';
import { validUsgsUrl, USGS_URL } from '../shared/earthquakes.mjs';

const layerKeys: Record<string, string> = {
  base: 'bases', nuclear: 'nuclear', spaceport: 'spaceports', cable: 'cables',
  pipeline: 'pipelines', waterway: 'waterways', datacenter: 'datacenters', datacenterCluster: 'datacenters', mineral: 'minerals',
};

// Reuse the map's popup contract, but keep reference entries independent of
// live context, account gates, chokepoint history and other unported readers.
export class MapPopup extends UpstreamMapPopup {
  private referenceElement: HTMLElement | null = null;
  private closeReference?: () => void;
  private outsideTimer: ReturnType<typeof setTimeout> | null = null;
  private onEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') this.hide(); };
  private onOutside = (event: Event) => { if (!this.referenceElement?.contains(event.target as Node)) this.hide(); };

  override show(data: Parameters<UpstreamMapPopup['show']>[0]): void {
    this.hide('replacement');
    const earthquake = data.type === 'earthquake';
    const layer = REFERENCE_LAYERS.find((entry) => entry.key === layerKeys[data.type]);
    if (!layer && !earthquake) return;
    const item = data.data as unknown as Record<string, unknown>;
    const popup = document.createElement('section');
    popup.className = 'oa-ref-popup';
    popup.setAttribute('role', 'dialog');
    popup.setAttribute('aria-labelledby', 'oa-popup-title');
    const close = document.createElement('button');
    close.className = 'oa-button';
    close.type = 'button';
    close.textContent = 'Close';
    close.setAttribute('aria-label', earthquake ? 'Close earthquake details' : 'Close reference details');
    close.addEventListener('click', () => this.hide());
    const eyebrow = document.createElement('p');
    eyebrow.className = 'oa-eyebrow';
    eyebrow.textContent = earthquake ? 'USGS · PRELIMINARY EARTHQUAKE RECORD' : 'SAVED REFERENCE ENTRY';
    const title = document.createElement('h2');
    title.id = 'oa-popup-title';
    title.textContent = earthquake ? `M${Number(item.magnitude).toFixed(1)} · ${item.place}` : typeof item.name === 'string' ? item.name : layer!.label;
    popup.append(eyebrow, title);
    const details = document.createElement('dl');
    const fields = [['country', 'Recorded country'], ['operator', 'Recorded operator'], ['mineral', 'Mineral'], ['description', 'Description']] as const;
    for (const [key, label] of fields) {
      const value = item[key];
      if (typeof value !== 'string' || !value) continue;
      const term = document.createElement('dt');
      term.textContent = label;
      const description = document.createElement('dd');
      description.textContent = value;
      details.append(term, description);
    }
    if (earthquake) {
      for (const [label, value] of [['Occurred', new Date(Number(item.occurredAt)).toLocaleString()], ['Depth', `${item.depthKm} km`]] as const) {
        const term = document.createElement('dt');
        term.textContent = label;
        const description = document.createElement('dd');
        description.textContent = value!;
        details.append(term, description);
      }
    }
    const limit = document.createElement('p');
    limit.textContent = earthquake ? 'USGS records can be revised. This is a source observation, not an impact or hazard assessment.' : layer!.detail + '. Current operating status and source freshness have not been verified.';
    const source = document.createElement('a');
    source.href = earthquake ? validUsgsUrl(item.sourceUrl) ? String(item.sourceUrl) : USGS_URL : `https://github.com/CannonWest/worldmonitor/blob/${__BUILD_HASH__}/${layer!.file}`;
    source.textContent = earthquake ? 'USGS event record' : 'View bundled source';
    source.target = '_blank';
    source.rel = 'noopener noreferrer';
    popup.append(details, limit, source, close);
    if (window.innerWidth > 600) {
      popup.style.left = `${Math.min(Math.max(12, data.x), window.innerWidth - 332)}px`;
      popup.style.top = `${Math.min(Math.max(12, data.y), Math.max(12, window.innerHeight - 370))}px`;
    }
    document.body.append(popup);
    this.referenceElement = popup;
    close.focus({ preventScroll: true });
    document.addEventListener('keydown', this.onEscape);
    this.outsideTimer = setTimeout(() => document.addEventListener('pointerdown', this.onOutside), 0);
  }

  override hide(...args: Parameters<UpstreamMapPopup['hide']>): void {
    super.hide(...args);
    if (this.outsideTimer !== null) clearTimeout(this.outsideTimer);
    this.outsideTimer = null;
    document.removeEventListener('keydown', this.onEscape);
    document.removeEventListener('pointerdown', this.onOutside);
    const wasOpen = !!this.referenceElement;
    this.referenceElement?.remove();
    this.referenceElement = null;
    if (wasOpen) this.closeReference?.();
  }

  override setOnClose(callback: () => void): void { this.closeReference = callback; }
}
