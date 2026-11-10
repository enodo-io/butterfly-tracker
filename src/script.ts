/**
 * Drop-in `<script>` build for sites without a bundler:
 *
 *   <script defer src="https://cdn.jsdelivr.net/npm/@enodo/butterfly-tracker/dist/butterfly-tracker.min.js"
 *     data-url="https://t.example.com" data-type="post" data-id="123"></script>
 *
 * Sends one hit when loaded (data-type defaults to `page`, data-auto="false" to
 * skip it) and exposes `window.ButterflyTracker` for manual hits.
 */
import { createTracker, toHit, trackerUrlFromApiUrl, type Hit } from './index.js';

declare global {
  interface Window {
    ButterflyTracker?: {
      tracker: ReturnType<typeof createTracker>;
      createTracker: typeof createTracker;
      toHit: typeof toHit;
      trackerUrlFromApiUrl: typeof trackerUrlFromApiUrl;
    };
  }
}

const script = document.currentScript as HTMLScriptElement | null;
const data = script?.dataset ?? {};

const tracker = createTracker({
  url: data.url,
  apiUrl: data.apiUrl,
  propertyId: data.property ? parseInt(data.property, 10) : undefined,
});

window.ButterflyTracker = { tracker, createTracker, toHit, trackerUrlFromApiUrl };

if (data.auto !== 'false') {
  const hit: Hit = { t: data.type || 'page' };
  if (data.id) {
    hit.id = data.id;
  }
  if (data.taxonomy) {
    hit.tx = data.taxonomy;
  }
  tracker.hit(hit);
}
