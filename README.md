# butterfly-tracker

Cookieless first-party audience tracker for **Enodo Butterfly** sites. One tiny
`POST {tracker}/h` per page view; the Butterfly CMS turns them into realtime stats and
trending / rising / top posts (`sort=trending` on the public API).

- No cookie, no localStorage, no identifier, credentials omitted: built for the CNIL
  audience-measurement exemption, so it does **not** wait for consent.
- `navigator.sendBeacon` (text/plain, no CORS preflight), `fetch` keepalive fallback.
- Never throws, never blocks, no-op on the server. ~1.3 kB gzipped.

## Install

```bash
npm install @enodo/butterfly-tracker
```

## Usage

```ts
import { createTracker } from '@enodo/butterfly-tracker';

// Tracker URL derived from the API URL: {id}.pubbtf.eno.do -> {id}.tbtf.eno.do,
// api{x}.example.com -> t{x}.example.com. Or pass `url` explicitly ('off' disables).
const tracker = createTracker({ apiUrl: 'https://api.example.com', enabled: !dev });

tracker.pageview({ 'content.type': 'post', 'content.id': 123 });

// Or a raw hit
tracker.hit({ t: 'category', id: '4' });
```

`toHit(layer, { typeKeys, postTypes })` adapts site-specific layers: e.g.
`{ typeKeys: ['page.type', 'content.type'], postTypes: ['post', 'recipe'] }` sends recipe
pages (whose `content.id` is a Butterfly post) as `post` so they rank in trending.

Pagination / infinite scroll (`page.index > 1`) and the same hit twice in a row for the
same URL are not sent.

## Without a bundler

```html
<script defer src="https://cdn.jsdelivr.net/npm/@enodo/butterfly-tracker/dist/butterfly-tracker.min.js"
  data-url="https://t.example.com" data-type="post" data-id="123"></script>
```

Sends one hit on load (`data-type` defaults to `page`, `data-auto="false"` to skip) and
exposes `window.ButterflyTracker`.

## Without JavaScript

Visitors without JavaScript can be counted with a 1×1 pixel, the same hit keys as a
query string on `GET /h.gif`:

```html
<noscript>
  <img src="https://t.example.com/h.gif?t=post&id=123" alt="" width="1" height="1"
    style="position:absolute">
</noscript>
```

`<noscript>` only renders when JavaScript is off, so it never doubles the script's hit.
It counts the view and the visitor, but not the traffic source: without JavaScript the
page cannot read `document.referrer`, so no `e` / `r` is sent.

## Hit

| key | meaning |
| --- | --- |
| `t` | page type: post, page, category, tag, author, home, search, or any site type |
| `id` | id of the content in the Butterfly API (post, category, term, author) |
| `tx` | taxonomy id of a term page |
| `pi` | page index |
| `q`, `n` | search query, number of results |
| `p` | property id, only on a shared tracker host |
| `e` | entry: `1` on the first hit after a page load (set by the tracker) |
| `r` | referrer hostname of the entry hit, never the full URL (set by the tracker) |
