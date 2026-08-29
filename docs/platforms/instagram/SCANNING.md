# Instagram — Scanning

- **Primary sources:** Instagram's internal GraphQL (Polaris) payloads captured
  from the page-context runtime, and, where needed, DOM inspection.
- **Normalization:** `InstagramNormalizer.js` converts raw GraphQL nodes into
  canonical `MediaItem`s (posts, carousel slides, reels, stories, highlights,
  profile picture).
- **Targets:** profile, single post/permalink, carousel, reels, stories,
  highlights, profile picture. Scan modes are exposed through capabilities
  (`scan.post`, `scan.stories`, `scan.highlights`, `media.avatar`).
- **Pagination:** `scan.pagination` drives cursor/end-cursor traversal of the
  profile feed.
- **Ordering:** carousel and story ordering are preserved invariants
  (SPEC §88, AGENTS §82).

The heavy lifting lives in the content script + main-world bridge
(`src/content/content.js`, `main-world/injected.js`); the plugin owns the
normalization contract and capabilities.
