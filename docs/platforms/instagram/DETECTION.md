# Instagram — Detection

Owned by `src/plugins/instagram/InstagramDetector.js`.

- **Host matching:** `matches(context)` is true for `instagram.com` (and its
  CDN/asset hosts used in-target) — consumed by the plugin registry.
- **Target detection:** `detectTarget(context)` classifies the current page:
  profile, post (permalink), carousel, stories, highlights, or a generic page.
- **Runtime:** the plugin declares `runtime.mainWorld`; the content script
  injects `src/plugins/instagram/main-world/injected.js` to bridge to the
  page-context Polaris (Instagram web) runtime.

Markers used: hostname, URL path segments (`/p/`, `/reel/`, `/stories/`,
`/videos/`), and in-page GraphQL payloads harvested by the main-world bridge.
These are unstable site internals and are intentionally isolated inside the
plugin (AGENTS §30, §146).
