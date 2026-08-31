# Facebook — Fixtures

- **Public HAR:** `tests/fixtures/har/facebook/example-profile.har`
  (sanitized) plus expected output in `tests/fixtures/har/expected/`.
- **Private captures:** `fixtures-private/` (git-ignored).
- **Replay tests:** `tests/integration/har-replay-platforms.test.js`,
  `tests/integration/fb-fullres.test.js`.
- **Naming guards:** `tests/contracts/facebook-naming.test.js` (authentic CDN
  basenames).

Fixtures follow Capture → Sanitize → Validate → Commit and never contain real
credentials (SPEC §79, §125).
