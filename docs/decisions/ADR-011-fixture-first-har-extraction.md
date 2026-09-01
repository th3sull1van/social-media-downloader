# ADR-011 — Fixture-first HAR extraction

## Status

Accepted

## Context

The project uses browser HAR captures to validate Instagram, Facebook, and
Reddit behavior. Several local captures are large and contain account- or
session-specific data. Loading all of them in every test run made the default
feedback loop unnecessarily slow and made it harder to guarantee that test
inputs were safe to share.

The production parsers still need realistic response relationships, signed URL
shapes, dimensions, ordering, and platform-specific payload structures. Replacing
HAR replay with hand-written objects would lose that evidence.

## Decision

Use a two-level fixture workflow:

1. Keep raw captures only in the ignored `fixtures-private/` directory.
2. Extract the smallest allowlisted payload required by each real production
   path with `tools/extract-fixtures.js`.
3. Deterministically anonymize IDs, names, URLs, timestamps, and response
   metadata while preserving relationships and structural URL parameters.
4. Validate every committed compact fixture with
   `tools/validation/fixture-check.js`, which fails closed on sensitive keys,
   secret-like values, executable markup, unsafe source metadata, and invalid
   metadata.
5. Make `tests/fixtures/extracted/` the default input for routine tests and CI.
6. Retain raw HAR replay as an explicit evidence gate (`bun run validate:raw`)
   for platform, parser, resolver, extraction, and sanitization changes.

Compact fixtures carry versioned metadata (`fixtureType`, `sourceCaptureId`,
`extractionVersion`, and `sanitizationVersion`) so regeneration remains
auditable and deterministic.

## Alternatives considered

- Parse every private HAR on every test run: rejected because it is slow,
  non-portable, and unnecessarily exposes raw account data to routine tooling.
- Replace HARs with hand-written synthetic objects: rejected because it does
  not exercise the real extraction/normalization path or preserve captured
  response relationships.
- Commit sanitized full HARs: rejected because payload size and accidental
  retention of unrelated private data remain too high.
- Use a generic external HAR-minification dependency: rejected because an
  allowlist is safer, deterministic, and sufficient for the current shapes.

## Consequences

Positive:

- The default suite uses roughly 5.4 MB of compact inputs instead of loading
  roughly 890 MB of private captures.
- Fixture validation and tests are substantially faster and safer to run in CI.
- Raw evidence remains available for investigating drift and validating the
  extractor itself.

Trade-offs:

- A new response shape requires regeneration or addition of a compact fixture.
- Compact fixtures can no longer prove that unrelated raw response fields are
  preserved; the explicit raw gate covers that concern.
- The extractor and sanitization validator are now part of the maintained test
  tooling and must be tested when changed.
