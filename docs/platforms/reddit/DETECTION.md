# Reddit — Detection

Owned by `src/plugins/reddit/RedditDetector.js`.

- **Host matching:** `matches(context)` is true for `reddit.com` and `redd.it`
  (media host), consumed by the plugin registry.
- **Target detection:** `detectTarget(context)` classifies subreddit, user
  profile, or a single post.
- **Runtime:** plugin declares `runtime.contentScript`; scanning uses a dual
  layer (server-rendered shreddit DOM + public JSON API).

Markers used: hostname, URL path segments (`/r/<sub>/`, `/u/<user>/`, post
permalink). Unstable internals are isolated inside the plugin (AGENTS §30,
§146).
