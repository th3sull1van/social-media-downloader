# Reddit — Fixtures

- **Default compact fixtures:** `tests/fixtures/extracted/reddit/*.json`.
  They cover server-rendered posts, galleries, RedGifs, icon filtering, empty
  profiles, and JSON API pagination without retaining the original account
  response.
- **Source HAR:** `tests/fixtures/har/reddit/example-feed.har` is a committed
  sanitized network-shape reference; it is not loaded by the default test
  suite.
- **Private captures:** `fixtures-private/` (git-ignored) are used only by the
  explicit raw evidence gate.
- **Replay tests:** `tests/integration/har-replay-platforms.test.js`,
  `tests/integration/reddit-fullres.test.js`, and `tests/reddit/scanner.test.js`
  use compact fixtures by default. `tests/reddit/muxer-redgifs.test.js` covers
  the media pipeline independently.
- **Tooling:** `tools/extract-fixtures.js` creates the compact set;
  `tools/gen-reddit-gallery-fixture.js` remains available for the historical
  gallery source fixture.

Regenerate with `bun run fixtures:extract` and validate with
`bun run check:fixtures`. Fixtures follow Capture → Extract → Anonymize →
Validate → Commit and never contain real credentials (SPEC §79, §125).
