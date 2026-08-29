# Facebook — Detection

Owned by `src/plugins/facebook/FacebookDetector.js`.

- **Host matching:** `matches(context)` is true for `facebook.com` (and
  `fbcdn.net` media hosts), consumed by the plugin registry.
- **Target detection:** `detectTarget(context)` classifies profile, album,
  collection, photo-tab, or generic page.
- **Runtime:** plugin declares `runtime.mainWorld`; the content script injects
  `src/plugins/facebook/main-world/injected.js` to reach the page-context Comet
  runtime.

Markers used: hostname, URL path segments (`/photos/`, `/albums/`), and Comet
GraphQL payloads. Unstable site internals are isolated inside the plugin
(AGENTS §30, §146).
