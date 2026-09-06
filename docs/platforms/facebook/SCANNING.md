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
- **Output identity:** retain the recognized profile name across album/photo
  navigation, including `/media/set/`, `/albums`, and `/photo`. Collection
  routes without a profile identity must not become a new target. Both popup
  state and download naming consume this retained identity; generic GraphQL
  collection labels cannot replace a profile-header name.
- **Regression (2026-09-06):** the current checkout lacked the earlier name
  pinning protection. Real content-script replay reproduced `Example Profile`
  becoming `Avaliações_feitas`; the restored protection preserves it across
  four collection routes while allowing navigation to another profile.
  `avatar-replay.test.js` also checks the resulting folder and archive paths.
  Validation: `bun run validate:local` passed 32/32 suites; `bun run validate:raw`
  passed against the same HAR baseline before and after; `bun run build:dist`
  passed. The title/navigation regression is a deterministic DOM scenario;
  no new live Facebook download was performed for this fix.
