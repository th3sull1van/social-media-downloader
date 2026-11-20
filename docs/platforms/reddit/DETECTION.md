# Reddit — Detection

Owned by `src/plugins/reddit/RedditDetector.js`.

- **Host matching:** `matches(context)` is true for `reddit.com` and `redd.it`
  (media host), consumed by the plugin registry.
- **Target detection:** `detectTarget(context)` classifies single posts
  (`/comments/`, `/gallery/` prioritized ahead of feed/profile routes),
  subreddit feeds (`/r/<sub>/`), user profiles (`/u/<user>/`, `/user/<user>/`),
  or generic home/popular/all feeds.
- **Runtime:** plugin declares `runtime.contentScript`; the content script
  matches both `*://*.reddit.com/*` and `*://*.redd.it/*`, using a dual layer
  (server-rendered shreddit DOM + public JSON API).

Markers used: hostname, URL path segments (`/comments/`, `/gallery/`, `/r/<sub>/`, `/u/<user>/`, post
permalink). Unstable internals are isolated inside the plugin (AGENTS §30,
§146).
