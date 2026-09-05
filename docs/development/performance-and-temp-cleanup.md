# Performance and temporary-resource cleanup — 2026-09-04

## Implemented and verified offline

- ZIP resources now follow browser download lifetime instead of a ten-minute timer.
  Generated media uses disk-backed, acknowledged 512 KiB blocks. Session IDs reject
  stale writes; separate resource directories isolate delayed cleanup.
- Worker recovery matches persisted resource URLs against active downloads.
  Failed browser queries fail closed. Tests exercise real manager and offscreen
  paths with browser/OPFS doubles, including cancellation during browser handoff,
  write failure, deletion failure/retry, restart, and consecutive downloads.
- Individual and ZIP completion counters are incremental. Historical membership
  uses one snapshot per job, invalidated on clear. Persistent merge still reads
  the latest history once at job completion, when there are new signatures.
- Grid cards and unchanged images are reused; collective selection only updates
  selection state and ARIA attributes. Empty filters release obsolete observers.
- Reddit DASH receives cancellation signals. Regressions cover absent, smaller
  and larger declared lengths, exact returned bytes, and released reader locks.

## Measurements

Command: `bun tools/benchmark-downloads.js 879ad5a`. Baseline is the pre-change
commit; five measured runs after warmup, using Bun 1.4.0 on Windows. Network calls
and intentional 40 ms pacing are removed equally from both runs. The grid uses
the actual rendering functions with a DOM double. These are CPU/DOM-allocation
measurements, not end-to-end browser download speed.

| Scenario | Before | After |
| --- | ---: | ---: |
| Process 1,000 completions, median elapsed | 8.91 ms | 2.30 ms |
| Process 10,000 completions, median elapsed | 266.36 ms | 26.91 ms |
| Process 10,000 completions, median CPU | 250 ms | 31 ms |
| Select 1,000 cards, median elapsed | 8.76 ms | 0.72 ms |
| Select 10,000 cards, median elapsed | 56.99 ms | 5.00 ms |
| New DOM nodes selecting 10,000 cards | 40,001 | 0 |
| History reads for 1,000 lookups, 50,000 signatures | 1,000 | 1 |

The sampled heap-growth estimate for 10,000 completions was 1.42 MiB before and
0 MiB after. Sampling/GC can hide transient allocations; this is **not** evidence
of zero allocation or a measurement of browser peak memory. Windows CPU timer
resolution also makes small-run CPU measurements unsuitable for comparison.
Full machine-readable results are generated under ignored `.artifacts/benchmark/`.

## Validation evidence

- The first local gate exposed CRLF-expanded fixture byte sizes and missing local
  dependencies. Restored fixture LF bytes, pinned LF with `.gitattributes`, and
  installed existing locked dependencies with `bun install --frozen-lockfile`.
  Fixture content and lockfile were not changed.
- Baseline `bun run validate:local`: 29/29 suites; baseline `bun run test:raw`: passed.
- Post-change `bun run validate:local`: 31/31 suites. `bun run validate:raw`
  passed, inspecting 3 public and 11 private captures (6,486 entries); HAR baseline
  comparison passed. Captures remain ignored and no private data was exported here.
- Compact Instagram inputs drive the grid regression through the real normalizer.
  Existing Instagram, Facebook and Reddit compact replays continue to cover media
  IDs, URLs, dimensions, naming and extraction; ZIP tests check CRC and entry bytes.

## Pending browser evidence: storage attributed to reddit.com

The report identifies the **site's** storage, not extension-origin OPFS. Searches
of the current runtime and available `src` history found no IndexedDB creation
or deletion code. This does not identify the owner of existing site data.
The browser tool blocked access to Chrome's storage settings, so no live before/
after storage measurement or deletion was performed. The site-specific report
must remain unresolved until reproduced.

Manual follow-up: identify the loaded extension build and exact origin/storage
bucket in DevTools Application; record bytes before scanning, after downloading,
and after completion/restart. Repeat with the extension disabled to distinguish
site activity. Inspect database/cache names without exporting private contents.
Only migrate/delete a resource once its extension ownership is demonstrated;
preserve logins, cookies, other site data, and user-downloaded files. Also validate
real rendering/focus and OPFS quota release in the loaded Chrome extension.
