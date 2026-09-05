# Deep Audit Report

Date: 2026-09-05. Baseline: `0374b51` on `main`, six commits ahead of
`origin/main`. The initial working tree and index were clean. No commits or
pushes were made by this audit.

## Executive Summary

| Critical | High | Medium | Low | Informational | Fixed | Remaining confirmed |
| --- | --- | --- | --- | --- | --- | --- |
| 0 | 1 | 2 | 1 | 0 | 4 | 0 |

Three reproduced defects were repaired: credential redaction bypasses, false
success for entirely rejected individual downloads, and archive collisions
changing the parent directory. Two stale architecture statements were corrected
as one documentation finding. These totals describe this audit's confirmed
findings, not a claim that the repository is defect-free.

## Repository Baseline

| Check | Baseline |
| --- | --- |
| Tests | PASS, 31/31 suites through `bun run validate:local` |
| Lint | UNAVAILABLE: no dedicated lint command |
| Typecheck | PASS |
| Build | SKIPPED before edits; executed after edits |
| Fixture/manifest/dependency/i18n gates | PASS |

Baseline evidence: `.artifacts/audit-baseline.log`. Bun 1.4.0 on Windows.
Source is browser JavaScript with ES modules and JSDoc; Bun is development tooling.

## Critical and High Findings

### AUDIT-001 — Error and nested-string logging bypasses credential redaction

**Category:** SECURITY. **Severity:** P1. **Confidence:** HIGH.
**Location:** `src/core/services/LoggingService.js`, `Logger.sanitize`, lines 52–88.

**Evidence / reproduction:** `Logger.sanitize(new Error('Request failed:
token=audit_secret'))` exposed the synthetic secret in both message and stack.
The same string inside `{ nested: [{ message: ... }] }` was also exposed.
The new regression failed before the fix.

**Root cause:** the Error branch returned its projection directly; object
traversal redacted sensitive keys but never sanitized ordinary string values.

**Impact:** an error containing a credential could disclose it to console logs.
This reproduces the sanitizer defect; it does not establish a historical leak
of actual credentials.

**Fix:** pass the Error projection through existing object sanitization and
apply the existing string sanitizer to nested string values. Preserve useful
error names, messages, codes and the bounded stack excerpt.

**Validation:** Error and nested-array regressions plus existing diagnostic
preservation assertions; full local gate. **Status:** FIXED.

## Functional Bugs

### AUDIT-002 — Entirely rejected individual batches report success

**Category:** BUG. **Severity:** P2. **Confidence:** HIGH.
**Location:** `src/core/application/DownloadManager.js`,
`processIndividualDownloads`, lines 520–531.

**Evidence / reproduction:** make the Chrome download callback return a
runtime error for the only item. Production code recorded `failed = 1` and
then set `status = COMPLETED`. The new regression failed with precisely that
actual/expected mismatch.

**Root cause:** unconditional successful finalization after the worker pool.

**Impact:** the UI and green action badge reported completion despite delivering
no items. The ZIP sibling already rejected its all-failed case.

**Fix:** use the existing `FAILED` state and error badge when there are failures
and neither successful nor duplicate-skipped items. Preserve mixed-batch and
all-duplicate behavior, cancellation and current concurrency.

**Validation:** rejected-download regression, existing mixed-failure,
all-duplicate and cancellation coverage, full local gate. **Status:** FIXED.

### AUDIT-003 — Archive collision renames a dotted parent directory

**Category:** BUG. **Severity:** P2. **Confidence:** HIGH.
**Location:** `src/core/application/DownloadManager.js`,
`uniquifyArchivePath`, line 196.

**Evidence / reproduction:** submitting `album.v1/photo` twice returned
`album_2.v1/photo` for the duplicate; expected `album.v1/photo_2`.
The new regression failed with those exact paths.

**Root cause:** extension detection searched the entire path without checking
whether the last period belonged to the final filename.

**Impact:** extensionless colliding entries could move into an unexpected
directory in the ZIP.

**Fix:** only treat a period after the final slash and basename's first
character as an extension separator. **Validation:** new path regression,
existing numbered-extension collisions, ZIP suites, local and HAR gates.
**Status:** FIXED.

## Reliability and Concurrency

Reviewed job admission around the settings await, worker counters, cancellation,
archive session ownership, terminal download events, recovery and serialized
entry/history operations. Existing regression suites exercise stale sessions,
cleanup and interrupted delivery. AUDIT-002 repairs a terminal-state defect.
No new concurrency mechanism or retry policy was introduced.

## Performance

Ran `bun tools/benchmark-downloads.js HEAD`: one warmup and five measured runs
per download case, using the existing offline harness. No performance fix was
justified by these measurements.

## Algorithms and Data Structures

Download accounting uses incremental counters; historical lookup uses a
per-job Set; generic identity deduplication uses a Map. These were already in
the baseline. Archive collision probing remains linear in existing suffixes
per collision, potentially quadratic for a large group sharing one path.
No realistic pathological batch was established in this audit.

## Memory and Resource Management

Reviewed acknowledged 512 KiB transport, reader cancellation/release, OPFS
publication and cleanup, and recovery's active-download snapshot. Existing
resource/stream tests passed. Muxing and binary deduplication still materialize
whole payloads; no browser peak-memory claim is made.

## Database

No backend SQL database was found in the inspected runtime. Applicable state
is `chrome.storage.local` settings/history and extension-origin OPFS resources.
History has a 50,000-entry cap. No user/site storage was modified.

## Security

AUDIT-001 is fixed. Inspected logger callers, path sanitizers, manifest scopes,
the content/main-world nonce check and resource cleanup boundaries. Automated
fixture sanitization and manifest checks passed. This was not a penetration
test; the logger's existing regex policy is not a universal detector of secrets
or private URLs.

## Architecture and Maintainability

Runtime entrypoints connect popup/content messages to the background registry,
platform discovery/resolution, generic download execution and offscreen output.
Platform implementations remain independent. The dependency gate found no
forbidden imports. No production dependency or abstraction was added.

## Testing

Added three regression blocks to two existing suites: two logging input shapes,
one all-rejected batch, and one dotted-directory collision. Each defect failed
before its fix and passed afterward. An intermediate new-test type error was
fixed by constructing a real `MediaItemModel`; no checks were disabled.

## Dependencies

Lockfile: TypeScript 5.9.3, `@types/node` 26.4.0 and `undici-types` 8.3.0.
`bun audit` reported no vulnerabilities in the three checked packages. This
result covers that command's advisory database and installed dependency graph,
not a proof of absence of vulnerabilities. No package upgrades were made.

## Documentation

### AUDIT-004 — Architecture guidance contradicts current ownership

**Category:** DOCUMENTATION. **Severity:** P3. **Confidence:** HIGH.
**Location:** `docs/architecture/permissions.md` and `overview.md`.

**Evidence:** permissions described storage as unused, while `StorageService`
reads/writes settings and history. The overview assigned token harvesting and
GraphQL transport to `meta-shared`, whose actual modules are `MetaCdn` and
`MetaNode`.

**Root cause / impact:** documentation drift misdirected maintenance and
permission review. **Fix:** describe actual storage and module responsibilities.
**Validation:** compare documentation against source and manifest.
**Status:** FIXED. The download guide also records the repaired semantics.

## Fixes Implemented

AUDIT-001 through AUDIT-004 above. Source edits are limited to two Core modules;
no parser, scanner, resolver, permission or platform contract was changed.

## Regression Tests Added

- `tests/core/logging-diagnostics.test.js`: Error and nested-string redaction.
- `tests/core/download-manager.test.js`: all-rejected batch and path collision.

## Performance Measurements

| Offline case | HEAD median | Working-tree median |
| --- | ---: | ---: |
| 1,000 download completions | 2.416 ms | 2.414 ms |
| 10,000 download completions | 27.113 ms | 25.311 ms |
| 10,000-card selection | 4.792 ms | 6.106 ms |

Grid code was unchanged and both versions created zero new nodes. Timing
variation is not attributed to these fixes. The harness's 1,000-versus-1 history
read comparison contrasts two APIs in the current source, not a change made by
this audit. Evidence: `.artifacts/audit-benchmark.log`.

## Final Validation

| Check | Result |
| --- | --- |
| Tests | PASS, 31/31 suites |
| Lint | UNAVAILABLE; `git diff --check` passed |
| Typecheck | PASS, part of `validate:local` |
| Build | PASS, `bun run build:dist`, 71 packaged files |
| Compact fixtures | PASS, 12 fixtures |
| Manifest / architectural dependencies / i18n | PASS, 22 locales |
| Raw HAR | PASS, 3 public + 11 private, 6,486 entries, baseline comparison |
| Dependency audit | PASS, three packages, no reported vulnerabilities |
| Benchmark | EXECUTED; no speedup claim |
| Live browser / real account smoke | NOT RUN |

Evidence: `.artifacts/audit-final-local.log` and `.artifacts/audit-raw.log`.
Raw replay is supplementary compatibility evidence after Core-only changes;
no before/after live-network experiment or new capture was performed.

## Remaining Risks

No live Chrome smoke or actual disk/network failure experiment was performed.
Browser API behavior is simulated by existing tests. Non-deduplicated download
jobs retain their existing browser-handoff completion semantics; this audit's
all-failed repair does not track later network interruption for those jobs.
No exhaustive absence-of-bugs claim is warranted from the inspected paths.

## Unconfirmed Hypotheses

Reddit pagination loops depend on cursor advancement and unique post counts;
a repeating nonempty page could prevent progress. No runtime reproduction or
representative repeated-cursor transport fixture was established here, so this
is an investigation lead, not a confirmed finding or compatibility claim.

## Files Changed

- Modified: two Core source files, two existing test files, three architecture docs.
- Added: this report.
- Totals: 7 modified files, 1 added file, 3 regression blocks, 3 code defects fixed.
- No fixtures, dependencies, manifests or user data changed; no commit or push.
