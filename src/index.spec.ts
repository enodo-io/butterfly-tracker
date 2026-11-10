import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createTracker,
  referrerHost,
  resolveTrackerUrl,
  toHit,
  trackerUrlFromApiUrl,
} from './index.js';

describe('tracker URL', () => {
  it('derives it from the API URL convention', () => {
    expect(trackerUrlFromApiUrl('https://42.pubbtf.eno.do')).toBe('https://42.tbtf.eno.do');
    expect(trackerUrlFromApiUrl('https://api.touslesresultats.com/')).toBe(
      'https://t.touslesresultats.com',
    );
    expect(trackerUrlFromApiUrl('https://apibe.touslesresultats.com')).toBe(
      'https://tbe.touslesresultats.com',
    );
    expect(trackerUrlFromApiUrl('https://cms.example.com')).toBeNull();
    expect(trackerUrlFromApiUrl('nope')).toBeNull();
    expect(trackerUrlFromApiUrl(undefined)).toBeNull();
  });

  it('explicit URL wins, off disables', () => {
    expect(resolveTrackerUrl('https://stats.example.com/', 'https://42.pubbtf.eno.do')).toBe(
      'https://stats.example.com',
    );
    expect(resolveTrackerUrl('', 'https://42.pubbtf.eno.do')).toBe('https://42.tbtf.eno.do');
    expect(resolveTrackerUrl('off', 'https://42.pubbtf.eno.do')).toBeNull();
  });
});

describe('toHit', () => {
  it('maps the data layer', () => {
    expect(
      toHit({
        'content.type': 'tag',
        'content.id': 'paris',
        'content.taxonomy': 'tags',
        'page.index': 1,
      }),
    ).toEqual({ t: 'tag', id: 'paris', tx: 'tags', pi: 1 });
    expect(toHit({ 'content.type': 'search', 'page.query': 'velo', 'page.results': 0 })).toEqual({
      t: 'search',
      q: 'velo',
      n: 0,
    });
    expect(toHit({})).toBeNull();
  });

  it('supports site-specific type keys and post types', () => {
    const options = { typeKeys: ['page.type', 'content.type'], postTypes: ['post', 'draw'] };
    expect(
      toHit({ 'page.type': 'draw', 'content.type': 'resultat', 'content.id': 7 }, options),
    ).toEqual({ t: 'post', id: '7' });
    expect(toHit({ 'page.type': 'draw', 'content.id': '0' }, options)).toEqual({
      t: 'draw',
      id: '0',
    });
    expect(toHit({ 'content.type': 'archive' }, options)).toEqual({ t: 'archive' });
  });
});

describe('createTracker', () => {
  let sendBeacon: ReturnType<typeof vi.fn>;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    sendBeacon = vi.fn(() => true);
    fetchMock = vi.fn(() => Promise.resolve(new Response()));
    vi.stubGlobal('window', { location: { href: 'https://example.com/a' } });
    vi.stubGlobal('navigator', { sendBeacon });
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sends text/plain JSON with sendBeacon', async () => {
    const tracker = createTracker({ apiUrl: 'https://42.pubbtf.eno.do' });
    expect(tracker.url).toBe('https://42.tbtf.eno.do');
    expect(tracker.pageview({ 'content.type': 'post', 'content.id': 1 })).toBe(true);
    const [url, blob] = sendBeacon.mock.calls[0] as [string, Blob];
    expect(url).toBe('https://42.tbtf.eno.do/h');
    expect(blob.type).toBe('text/plain');
    expect(await blob.text()).toBe('{"t":"post","id":"1","e":1}');
  });

  it('falls back to fetch keepalive without credentials', () => {
    sendBeacon.mockReturnValue(false);
    createTracker({ url: 'https://t.example.com' }).hit({ t: 'home' });
    expect(fetchMock).toHaveBeenCalledWith('https://t.example.com/h', {
      method: 'POST',
      body: '{"t":"home","e":1}',
      keepalive: true,
      credentials: 'omit',
      headers: { 'Content-Type': 'text/plain' },
    });
  });

  it('skips pages > 1, duplicates, disabled and server side', () => {
    const tracker = createTracker({ url: 'https://t.example.com' });
    expect(tracker.hit({ t: 'category', id: '3', pi: 2 })).toBe(false);
    expect(tracker.hit({ t: 'home' })).toBe(true);
    expect(tracker.hit({ t: 'home' })).toBe(false);
    expect(createTracker({ url: 'off' }).hit({ t: 'home' })).toBe(false);
    expect(createTracker({ url: 'https://t.example.com', enabled: false }).hit({ t: 'home' })).toBe(
      false,
    );
    vi.stubGlobal('window', undefined);
    expect(createTracker({ url: 'https://t.example.com' }).hit({ t: 'post', id: '9' })).toBe(false);
    expect(sendBeacon).toHaveBeenCalledTimes(1);
  });

  it('flags only the first sent hit as the entry, with the referrer hostname', async () => {
    vi.stubGlobal('document', { referrer: 'https://www.Google.com/search?q=secret' });
    const tracker = createTracker({ url: 'https://t.example.com' });
    // Skipped hits do not consume the entry
    expect(tracker.hit({ t: 'category', id: '3', pi: 2 })).toBe(false);
    expect(tracker.hit({ t: 'home', e: 1, r: 'forged.com' })).toBe(true);
    window.location.href = 'https://example.com/b';
    expect(tracker.hit({ t: 'post', id: '2' })).toBe(true);
    const bodies = await Promise.all(
      sendBeacon.mock.calls.map(([, blob]) => (blob as Blob).text()),
    );
    expect(bodies).toEqual(['{"t":"home","e":1,"r":"www.google.com"}', '{"t":"post","id":"2"}']);
  });

  it('direct visit: entry without referrer', async () => {
    vi.stubGlobal('document', { referrer: '' });
    createTracker({ url: 'https://t.example.com' }).hit({ t: 'home' });
    expect(await (sendBeacon.mock.calls[0]?.[1] as Blob).text()).toBe('{"t":"home","e":1}');
    expect(referrerHost('not a url')).toBeUndefined();
  });

  it('adds the property id for a shared host and never throws', () => {
    createTracker({ url: 'https://t.example.com', propertyId: 11 }).hit({ t: 'home' });
    sendBeacon.mockImplementation(() => {
      throw new Error('boom');
    });
    fetchMock.mockImplementation(() => {
      throw new Error('boom');
    });
    expect(createTracker({ url: 'https://t.example.com' }).hit({ t: 'x' })).toBe(false);
    expect(sendBeacon).toHaveBeenCalledTimes(2);
  });
});
