# Changelog

## [1.2.1] — 2026-09-25

### Fixed

- **Instagram Zero-Post & Rate-Limited Resolution**:
  - Implemented DOM script inspection (`profile_id`, `page_id`, `props.id`) in injected script to resolve the target numeric user ID directly when `web_profile_info` is rate-limited (HTTP 429).
  - Added DOM metadata and header avatar fallback with CDN upgrading via `upgradeCdnUrl` for zero-post or unindexed profiles.
  - Corrected `scanHighlights` and `scanAllPosts` to properly handle `status === 'empty'` without throwing false failure exceptions.
- **Download Management**:
  - Added state reconciliation, download ledger accounting, and interruption recovery in `DownloadManager`.
- **Facebook Navigation**:
  - Preserved authentic target profile name and metadata across album navigation.
- **Content Context**:
  - Safeguarded avatar icon URL reuse across extension context invalidation.

### Security & Validation

- Added strict HAR cookie value sanitization checks enforcing `<REDACTED>` placeholders.
- Sanitized public HAR test fixtures and validated against compact and public HAR suites.

## [1.2.0] — 2026-08-31

### Added

- Compact, deterministic and anonymized fixtures extracted from local HAR
  captures for routine parser, scanner and normalizer tests.
- Fail-closed fixture validation with allowlisted extraction and sensitive-data
  checks.
- An explicit raw HAR evidence gate for platform and network changes, while
  keeping large private captures out of the default validation path.
- Process-isolated parallel test execution through `bun run test:parallel`.

### Improved

- Reduced the default validation input from large private captures to the
  versioned compact fixture set.
- Hardened ZIP packaging, storage and MP4 processing paths while preserving
  browser-only execution.
- Clarified fixture, sanitization, CI and browser-smoke workflows in the
  documentation.

### Fixed

- Restored and hardened Instagram, Facebook and Reddit profile/avatar media
  discovery.
- Preserved signed Facebook CDN cover URLs and selected the best render
  available in captured payloads without invalidating signatures.
- Stabilized Facebook profile naming and photo-tab scanning without allowing a
  full-page reload during navigation.
- Removed dead platform bridges and obsolete diagnostic/tooling artifacts.

### Validation

- Compact fixture gate: 12 fixtures validated.
- Automated suite: 29/29 suites passed.
- Raw HAR replay and comparison: passed against the available local captures.

## [1.1.0] — 2026-08-30

See the [GitHub release](https://github.com/th3sull1van/social-media-downloader/releases/tag/v1.1.0)
for the previous release notes.
