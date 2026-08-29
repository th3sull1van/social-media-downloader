# Reddit — Fixtures

- **Public HAR:** `tests/fixtures/har/reddit/example-feed.har` (sanitized) plus
  expected output in `tests/fixtures/har/expected/`.
- **Private captures:** `fixtures-private/` (git-ignored) — e.g.
  `reddit-private-profile.har` used by the scanner test.
- **Replay tests:** `tests/integration/har-replay-platforms.test.js`,
  `tests/integration/reddit-fullres.test.js`, `tests/reddit/scanner.test.js`
  (JSON API + DOM + pagination + dedup).
- **Media pipeline tests:** `tests/reddit/muxer-redgifs.test.js`
  (muxing + RedGifs resolver).
- **Tooling:** `tools/replay-reddit.js`, `tools/gen-reddit-gallery-fixture.js`,
  `tools/replay-canonical.js`.

Fixtures follow Capture → Sanitize → Validate → Commit and never contain real
credentials (SPEC §79, §125).
