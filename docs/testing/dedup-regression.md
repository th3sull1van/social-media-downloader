# Dedup regression — 2026-09-05

## Intent

Implement SPECIFICATION.md §48: SHA-256 instead of CRC-32/size for binary
identity; confirm Chrome completion before history; retry a later duplicate after
failure; serialize dedup payloads; use plugin identity/priority in scanner and popup;
copy metadata before merging subreddit membership. No new dependencies.

The single-payload limit reduces memory at the cost of throughput. One entire
file (and native hashing/transport buffers) still needs memory. Incremental hashing
with OPFS staging is deferred until a single-file memory limit is demonstrated.
Worker termination before completion confirmation conservatively leaves history
unconfirmed; a future job may download the file again.

## Regression checks

- `tests/core/storage-dedup.test.js`: equal-length CRC-32 collision with distinct
  SHA-256 digests; known SHA-256 vector and sliced views; legacy history mismatch;
  delayed/early completion, unrelated events, interruption and cancellation;
  failure before blob creation and before ZIP entry acceptance followed by a
  successful duplicate; interrupted ZIP never enters history.
- `tests/integration/pipeline.test.js`: Reddit/Imgur ID collision, distinct Imgur
  collections, unknown hosts/query parameters, preview/video/RedGifs aliases,
  score ranking, missing identities, input immutability, and production popup
  selector with capability disabled or toggle disabled.
- `tests/integration/har-replay-platforms.test.js`: compact/raw DOM scanner output
  passes through real normalization and dedup. Replaying items twice preserves
  the same representatives and never mutates inputs.

## Evidence

`bun run validate:local` passed before and after implementation: 31/31 suites,
fixtures, typecheck, manifest, dependency boundaries and 22 locales.
`bun run test:raw` passed before and after implementation (Instagram, Facebook,
Reddit). Existing compact DOM inputs already represent the affected transport
shape; identity edge cases use synthetic URL inputs, not new captured data.

An additional comparison loaded the pre-change normalizer from Git HEAD and the
working normalizer, replayed the real Reddit scanner, and compared all existing
normalized fields plus filenames/archive paths and dedup representatives. Results:

| Capture identifier | Input media | Unique media | Comparison |
|---|---:|---:|---|
| compact example-feed | 62 | 62 | identical |
| compact reddit-feed | 82 | 79 | identical |
| compact reddit-gallery | 3 | 3 | identical |
| compact reddit-post | 2 | 2 | identical |
| compact reddit-empty-profile | 0 | 0 | identical |
| raw reddit-feed | 10 | 10 | identical |
| raw reddit-gallery | 3 | 3 | identical |
| raw reddit-post | 0 | 0 | identical (no extracted DOM media) |
| raw reddit-empty-profile | 0 | 0 | identical |

The comparison includes IDs, URLs, dimensions, naming, order and metadata;
new optional dedup contract fields are excluded from old/new equality.
No private URLs or captured media are committed.

Browser validation was attempted, but browser-tool security policy blocked
`chrome://extensions/`. Extension reload, popup module loading and real Chrome
file completion remain unverified interactively; no workaround was attempted.
