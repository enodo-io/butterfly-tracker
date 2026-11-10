/**
 * @enodo/butterfly-tracker — cookieless first-party audience tracker for Butterfly sites.
 *
 * Sends one small `POST {trackerUrl}/h` per page view (text/plain JSON via
 * `navigator.sendBeacon`, `fetch` keepalive fallback). No cookie, no storage, no
 * identifier, credentials omitted: designed for the CNIL audience-measurement
 * exemption, so it does not wait for consent. Never throws, never blocks.
 */

/** Body of a hit. Keys are short on purpose. */
export type Hit = {
  /** Page type: post | page | category | tag | author | home | search | any site-specific type */
  t: string;
  /** Id of the content in the Butterfly API (post, category, term, author) */
  id?: string;
  /** Taxonomy id of a term page */
  tx?: string;
  /** Page index: > 1 (pagination, infinite scroll) is not a view and is not sent */
  pi?: number;
  /** Search query */
  q?: string;
  /** Number of search results (0 marks a zero-result search) */
  n?: number;
  /** Property id, only needed on a shared tracker host */
  p?: number;
  /**
   * Entry: set on the first hit after a full page load (a visit landing on the
   * site, or a full navigation). Set by the tracker, not by callers.
   */
  e?: 1;
  /**
   * Referrer HOSTNAME of the entry hit (never the full URL). Absent for a direct
   * visit. The tracker maps it to a source (Google, Facebook...) and drops it
   * when it is the site itself.
   */
  r?: string;
};

export type Layer = Record<string, unknown>;

export type ToHitOptions = {
  /** Layer keys read for the page type, first match wins. Default `['content.type']`. */
  typeKeys?: string[];
  /**
   * Page types whose `content.id` is a Butterfly post id, sent as `post` so they
   * rank in trending (e.g. `['post', 'recipe']`). Default `['post']`.
   */
  postTypes?: string[];
};

export type TrackerOptions = {
  /** Tracker base URL. `off` / `false` disables. When empty, derived from `apiUrl`. */
  url?: string | null;
  /** Butterfly public API URL, used to derive the tracker URL. */
  apiUrl?: string | null;
  /** Property id, only for a shared tracker host. */
  propertyId?: number;
  /** Master switch (e.g. `!dev`). Default true. */
  enabled?: boolean;
};

export type Tracker = {
  /** Resolved tracker base URL, `null` when disabled. */
  readonly url: string | null;
  /** Sends a hit. Returns true when it was handed to the browser. */
  hit(hit: Hit): boolean;
  /** Maps a data layer (`content.type`, `content.id`…) to a hit and sends it. */
  pageview(layer: Layer, options?: ToHitOptions): boolean;
};

/**
 * Tracker URL derived from the Butterfly API URL, following the domain convention:
 *   https://{id}.pubbtf.eno.do   -> https://{id}.tbtf.eno.do
 *   https://api{x}.example.com   -> https://t{x}.example.com  (api. -> t., apibe. -> tbe.)
 * `null` when the API URL follows neither pattern.
 */
export function trackerUrlFromApiUrl(apiUrl: string | null | undefined): string | null {
  if (!apiUrl) {
    return null;
  }
  let host: string;
  try {
    host = new URL(apiUrl).hostname.toLowerCase();
  } catch {
    return null;
  }
  const own = /^(\d+)\.pubbtf\.eno\.do$/.exec(host);
  if (own) {
    return `https://${own[1]}.tbtf.eno.do`;
  }
  const custom = /^api([a-z0-9-]*)\.(.+\..+)$/.exec(host);
  if (custom) {
    return `https://t${custom[1]}.${custom[2]}`;
  }
  return null;
}

/** Explicit URL when set (`off` / `false` disables), otherwise derived from the API URL. */
export function resolveTrackerUrl(
  url: string | null | undefined,
  apiUrl?: string | null,
): string | null {
  if (url === 'off' || url === 'false') {
    return null;
  }
  if (url) {
    return url.replace(/\/+$/, '');
  }
  return trackerUrlFromApiUrl(apiUrl);
}

/**
 * Maps a data layer to a hit, `null` when there is nothing to count.
 * Reads `content.type` (or `typeKeys`), `content.id`, `content.taxonomy`,
 * `page.index`, `page.query` and `page.results`.
 */
export function toHit(layer: Layer, options: ToHitOptions = {}): Hit | null {
  const typeKeys = options.typeKeys ?? ['content.type'];
  const postTypes = options.postTypes ?? ['post'];

  const type = typeKeys.map((k) => layer[k]).find((v) => typeof v === 'string' && v);
  if (typeof type !== 'string') {
    return null;
  }

  const rawId = layer['content.id'];
  const id =
    (typeof rawId === 'string' && rawId) || typeof rawId === 'number' ? String(rawId) : undefined;
  const isPost = postTypes.includes(type) && id !== undefined && id !== '0';

  const hit: Hit = { t: isPost ? 'post' : type };
  if (id !== undefined) {
    hit.id = id;
  }
  if (typeof layer['content.taxonomy'] === 'string') {
    hit.tx = layer['content.taxonomy'];
  }
  if (typeof layer['page.index'] === 'number') {
    hit.pi = layer['page.index'];
  }
  if (typeof layer['page.query'] === 'string') {
    hit.q = layer['page.query'];
  }
  if (typeof layer['page.results'] === 'number') {
    hit.n = layer['page.results'];
  }
  return hit;
}

/** Hostname of `document.referrer`, lowercase, `undefined` when empty or unparseable. */
export function referrerHost(referrer?: string): string | undefined {
  const value =
    referrer ?? (typeof document === 'undefined' ? '' : String(document.referrer || ''));
  if (!value) {
    return undefined;
  }
  try {
    return new URL(value).hostname.toLowerCase() || undefined;
  } catch {
    return undefined;
  }
}

function send(url: string, body: string): boolean {
  const nav = typeof navigator === 'undefined' ? undefined : navigator;
  if (typeof nav?.sendBeacon === 'function') {
    try {
      if (nav.sendBeacon(url, new Blob([body], { type: 'text/plain' }))) {
        return true;
      }
    } catch {
      // fall through to fetch
    }
  }
  if (typeof fetch === 'function') {
    fetch(url, {
      method: 'POST',
      body,
      keepalive: true,
      credentials: 'omit',
      headers: { 'Content-Type': 'text/plain' },
    }).catch(() => undefined);
    return true;
  }
  return false;
}

export function createTracker(options: TrackerOptions = {}): Tracker {
  const url = options.enabled === false ? null : resolveTrackerUrl(options.url, options.apiUrl);
  let last: string | undefined;
  // The first hit sent after the page load is the entry (one per tracker instance)
  let entrySent = false;

  function hit(input: Hit): boolean {
    try {
      if (!url || typeof window === 'undefined') {
        return false;
      }
      // Pagination / infinite scroll are not new views
      if ((input.pi ?? 1) > 1) {
        return false;
      }
      const { e: _e, r: _r, ...hitInput } = input;
      const payload: Hit = options.propertyId
        ? { ...hitInput, p: options.propertyId }
        : { ...hitInput };
      // Same hit for the same URL twice in a row (effect re-run, data reload): once
      const key = `${window.location.href}\n${JSON.stringify(payload)}`;
      if (key === last) {
        return false;
      }
      last = key;
      if (!entrySent) {
        payload.e = 1;
        const r = referrerHost();
        if (r) {
          payload.r = r;
        }
      }
      const sent = send(`${url}/h`, JSON.stringify(payload));
      if (sent) {
        entrySent = true;
      }
      return sent;
    } catch {
      return false; // analytics must never break the page
    }
  }

  return {
    url,
    hit,
    pageview(layer: Layer, toHitOptions?: ToHitOptions): boolean {
      const h = toHit(layer, toHitOptions);
      return h ? hit(h) : false;
    },
  };
}
