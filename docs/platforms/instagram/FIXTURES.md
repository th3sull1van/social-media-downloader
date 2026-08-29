# Instagram — Fixtures

- **Public HAR:** `tests/fixtures/har/instagram/example-profile.har`
  (sanitized, committed) plus expected normalized output in
  `tests/fixtures/har/expected/`.
- **Private captures:** `fixtures-private/` (git-ignored) hold unsanitized
  captures for local replay.
- **Replay tests:** `tests/integration/har-replay.test.js` (GraphQL extraction),
  `tests/integration/har-replay-platforms.test.js`, and
  `tests/integration/ig-fullres.test.js` (full-resolution upgrade).
- Fixtures follow the Capture → Sanitize → Validate → Commit workflow and
  never contain real credentials or private data (SPEC §79, §125).
