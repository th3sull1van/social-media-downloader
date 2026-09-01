# Facebook — Fixtures

- **Default compact fixtures:** `tests/fixtures/extracted/facebook/*.json`.
  They preserve GraphQL, inline JSON, DOM, profile/cover, reel, and CDN query
  shapes needed by the real Facebook paths without retaining the original
  account payload.
- **Source HAR:** `tests/fixtures/har/facebook/example-profile.har` is a
  committed sanitized network-shape reference; it is not loaded by the default
  test suite.
- **Private captures:** `fixtures-private/` (git-ignored) are used only by the
  explicit raw evidence gate.
- **Replay tests:** `tests/integration/har-replay-platforms.test.js` runs the
  compact platform replay by default and raw replay when invoked directly;
  `tests/integration/fb-fullres.test.js` and
  `tests/integration/avatar-replay.test.js` use compact fixtures.
- **Private profile-header regression (2026-08-31):** a user-supplied private
  Facebook capture exposed the target image as `profilePicLarge` and the cover
  as `cover_photo.photo.image` inside `profile_header_renderer.user`. The raw
  capture remains outside the repository; a sanitized API fixture is committed
  at `tests/fixtures/facebook/private-profile-header.json`. The replay now
  yields exactly one target profile-picture item and one cover-photo item and
  excludes facepile avatars.
- **Signed cover regression (2026-08-31):** the same capture exposed a cover
  URL carrying `stp=s720x720` without `cstp`/`ctp`. The URL is signed; removing
  `stp` changes a valid CDN response into HTTP 403. `MetaCdn.upgradeUrl(...,
  'facebook')` must therefore preserve that URL verbatim when no safe max-render
  parameter is available. The raw capture remains outside the repository.
- **Naming guards:** `tests/contracts/facebook-naming.test.js` (authentic CDN
  basenames).

Regenerate with `bun run fixtures:extract` and validate with
`bun run check:fixtures`. Fixtures follow Capture → Extract → Anonymize →
Validate → Commit and never contain real credentials (SPEC §79, §125).
