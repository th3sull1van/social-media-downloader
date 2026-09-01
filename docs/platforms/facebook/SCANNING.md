# Facebook — Scanning

- **Primary sources:** Facebook's internal Comet GraphQL tree and photo-tab
  DOM navigation.
- **Normalization:** `FacebookNormalizer.js` converts raw photo nodes into
  canonical `MediaItem`s.
- **Targets:** profile media, albums, collections, photo tabs; **multi-tab**
  behavior is handled in the content script (album/photo source-tab identity is
  preserved).
- **Capabilities:** `scan.profile`, `scan.album`, `scan.collection`,
  `media.gallery`, `media.video`; `scan.pagination` where the feed is paged.
- **Invariants:** album identity, collection identity, source-tab identity and
  observable media ordering are preserved (SPEC §88, AGENTS §82).
- **SPA navigation:** tab changes use the Comet router when available; guarded
  synthetic tab clicks and `history.pushState` are fallbacks that do not permit
  the anchor's default full-page reload.
