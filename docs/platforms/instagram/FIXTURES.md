# Instagram — Fixtures

- **Default compact fixtures:** `tests/fixtures/extracted/instagram/*.json`.
  They contain only the allowlisted timeline/story fields required by the real
  normalizer and are the inputs for routine tests and CI.
- **Source HAR:** `tests/fixtures/har/instagram/example-profile.har` is a
  committed sanitized network-shape reference; it is not loaded by the default
  test suite.
- **Private captures:** `fixtures-private/` (git-ignored) hold raw captures for
  explicit before/after replay.
- **Replay tests:** `tests/integration/fixture-replay.test.js` and
  `tests/integration/har-extraction.test.js` exercise compact fixtures;
  `tests/integration/ig-fullres.test.js` covers full-resolution upgrade.
- Regenerate from available local captures with `bun run fixtures:extract` and
  validate with `bun run check:fixtures`. Fixtures follow Capture → Extract →
  Anonymize → Validate → Commit and never contain real credentials or private
  data (SPEC §79, §125).
