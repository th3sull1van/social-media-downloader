# CI validation

CI runs `bun install --frozen-lockfile` followed by `bun run validate`.

The routine CI gate is fixture-first: it validates the compact, sanitized
fixtures under `tests/fixtures/extracted/` and never requires private captures
or repeatedly parses large account HARs. The committed HARs under
`tests/fixtures/har/` remain sanitized source/network evidence; they are not
the default input for the full test suite.

## Required CI checks

- compact fixture discovery, metadata validation, and secret scanning;
- public HAR inventory and sanitization checks;
- TypeScript check;
- complete test runner;
- manifest integrity;
- architectural dependency rules;
- locale parity;
- compact replay suites included by `tests/run-tests.js`;

## Local validation

The normal local gate is:

```bash
bun run validate:local
```

`validate:local` writes `.artifacts/har-report.json`, which is ignored by Git.
It uses compact fixtures for tests and only scans the committed public HAR
inventory.

When a behavior is not represented, extract a minimal fixture from a local raw
capture with:

```bash
bun run fixtures:extract
bun run check:fixtures
```

The extractor is allowlist-based and deterministic. Do not copy a private
capture unchanged or add real account data to version control.

## Raw evidence gate

Changes to network extraction, parsers, normalizers, scanners, resolvers,
fixture tooling, or sanitization also require the explicit raw gate when the
relevant local captures are available:

```bash
bun run validate:raw
```

This gate reads `fixtures-private/`, compares raw replay behavior, and is
intentionally separate from routine CI so that large captures do not dominate
every test run. If the relevant raw capture is unavailable, report raw
validation as `UNVERIFIED`; the compact gate must still pass.

## What HAR replay does not prove

Compact and raw replay validate captured parser and normalization behavior. They
do not prove Chrome extension loading, CSP, popup rendering, service-worker
lifecycle, real downloads, or host-page CSS isolation. Browser smoke coverage
must remain a separate opt-in layer until a supported browser runner is added.
