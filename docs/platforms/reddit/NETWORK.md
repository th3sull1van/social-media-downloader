# Reddit — Network

- **JSON endpoints:** subreddit hot feed (`/r/<sub>/hot.json`), user submissions
  (`/u/<user>/submitted.json`, and a `/search.json` fallback via `author:`
  query), and single-post lookup — all requested with `raw_json=1` and paginated
  by `after` cursors in `RedditScanner.js`.
- **Media hosts:** `i.redd.it`, `preview.redd.it`, `redditmedia.com`,
  `v.redd.it` (DASH), and `redgifs.com`.
- **RedGifs API:** `RedGifsResolver.js` fetches a temporary bearer token from
  `api.redgifs.com/v2/auth/temporary` and queries
  `api.redgifs.com/v2/gifs/<id>` for the HD/SD direct MP4.
- **Host permissions:** `*://*.reddit.com/*`, `*://*.redd.it/*`,
  `*://*.redgifs.com/*`.
Credentials/cookies are never committed; captures only via the sanitized HAR
workflow (SPEC §79).
