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

## Highlights regression (2026-09-06)

`instagram-highlights-v3.json` projects a 2026-09-05 capture: the tray,
Stories V3 GraphQL media connection, and a profile feed author. Generate it
with `bun tools/extract-fixtures.js --source=<local-capture.har> --highlights`.
`tests/integration/instagram-highlights.test.js` executes the actual main-world
and content scripts, covering profile lookup with simulated REST 429, author
identity, cancellation, empty/error responses, and legacy REST fallback.

Replay the source with `bun tools/replay-instagram-highlights.js <local-capture.har>`.
Before the fix, the captured transport produced zero items and incorrectly
reported success. After the fix, all 26 occurrences match the captured item
payloads and order, with no uncaptured media request. Existing ID deduplication
produces 24 unique highlights; compact replay also checks normalized fields
and archive paths. The REST 429 scenario is simulated from the supplied console
report, not a captured HTTP response.

Validation: `bun run validate:local` passed 32 suites; `bun run validate:raw`
passed before and after (3 public and 11 private captures, 6,486 entries).
`bun run build:dist` passed. Live Chrome scanning found 24 highlights (23 videos
and one image). A two-item ZIP attempt did not show completion; end-to-end
download remains unconfirmed, and automated extension reload was blocked by
the browser's protected-page policy.
