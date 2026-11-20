# Changelog

## [1.2.2] — 2026-11-17

### Fixed

- **Instagram Navigation, Pagination & Media Detection**:
  - Removed unintended `isScanCancelled`/`scanGeneration` resets in `history.pushState`/`replaceState` hooks so sub-navigation (e.g. carousel `?img_index=` updates) emits `SMD_IG_NAVIGATION_CHANGED` without aborting active scans; content script gates scan cancellation on genuine target changes.
  - Added cursor-loop (`seenCursors`) and empty-page guards to `fetchAllPosts`.
  - Wrapped `FETCH_IG_PROFILE` handler in structured `try/catch` and removed an incompatible Doc ID (`28449850404637481`) from `PolarisStoriesV3HighlightsPageQuery`, routing active stories through `PolarisStoriesV3ReelPageStandaloneQuery`.
  - Expanded non-profile route exclusion in `InstagramDetector` so `/p/` and `/reel/` consistently classify as `post`.
  - Tolerated benign GraphQL partial `field_exception` warnings in `fetchAllPosts` and `fetchHighlights` when every edge/item carries intact media (avoiding false `scanFailed` banners on complete scans), and updated Relay `DOC_IDS` with November 2026 captures while keeping earlier IDs as fallbacks.
- **Facebook Walker, CDN & Photo-Only Capabilities**:
  - Added `visited` `Set` cycle protection in `fbWalkAndHarvest`, shared `fbSelectBestRender` selection prioritizing larger signed renders over smaller `viewer_image` thumbnails, and removed coarse 6+ digit numeric collision matching in `fbLookupFullRes`.
  - Fixed `MetaCdn.upgradeUrl` to overwrite `ctp` cleanly via `searchParams.set` and aligned `FacebookPlugin` (`media.video: false`, removed unused video tab) and `/people/` / `/pages/` target detection.
  - Intercepted `URL` and `Request` inputs in Facebook main-world `fetch` hook and guarded `XHR` `responseType` reads (`""` / `"text"`).
- **Reddit Scanner, Muxer & RedGifs**:
  - Prioritized `/comments/` and `/gallery/` single-post detection ahead of `/r/` and `/u/` routes in `RedditDetector` and `content.js`.
  - Unwrapped `crosspost_parent_list[0]` in `RedditScanner.parseApiPostObject`, handled `v.redd.it` posts when `is_video` is omitted, skipped `status === 'failed'` gallery slides (normalizing `jpeg` to `jpg`), added `isDirectImageCandidate` host/path filtering, and added `seenCursors` + no-progress guards to pagination.
  - Updated `RedditVideoMuxer` with `CMAF_AUDIO_128`/`64` fallbacks, a 2-slot static mux semaphore, `size === 0` extend-to-EOF MP4 box support, rejection of fragmented (`moof`) or multi-`mdat` MP4 streams, multi-track `readMaxTrackId`, `stco` overflow checks, and multi-part `Blob` output.
  - Hardened `RedGifsResolver` with coalesced token promises, `AbortSignal` forwarding, 401 token reset fix, strict ID/URL validation, and surfaced background resolution errors without CORS fallback.
- **Core, Background, Offscreen & UI Reliability**:
  - Added protocol allowlisting (`https:`/`http:`/`blob:`) in `DownloadManager.downloadUrl` and platform-scoped `isAllowedMediaUrl` in `content.js`.
  - Prevented empty ZIP creation when `completed === 0 && skippedDuplicates > 0 && failed > 0`, propagated `opfs_quota_exceeded`/`opfs_unavailable` failures, deferred `uniquifyArchivePath` until right before `ArchiveService.addFileStream` (releasing slots on failure), and added `SHOW_DOWNLOAD_IN_FOLDER`, `TRIGGER_SCAN_PAGE`, `ZIP_OFFSCREEN_PROGRESS` sender/field validation, and `pendingBlobUrls` recovery.
  - Truncated ZIP entry filename segments at 200 UTF-8 bytes in `src/offscreen/offscreen.js` (keeping ZIP paths and headers consistent).
  - Fixed Shadow DOM modal focus trapping (`uiShadow.activeElement`), open/close focus restoration, HTML attribute escaping, popup incremental grid accessibility/selection summaries, and i18n keys across all 22 locales.

### Security & Validation

- Replaced `JSON.parse(JSON.stringify(...))` with a `WeakSet`-guarded clone supporting cycles and `BigInt`, and expanded secret key/regex redaction (`sessionid`, `c_user`, `xs`, `datr`, `lsd`, `jazoest`, `_nc_ohc`, `oh`, `api_key`, JSON pairs, Bearer tokens) in `LoggingService`.
- Used CSPRNG (`crypto.randomUUID()`) for `BRIDGE_NONCE` in `content.js` with `Math.random()` replay fallback, locked main-world `session.nonce` on first handshake, added `*://*.redd.it/*` to content script matches, and split `web_accessible_resources` per platform in `manifest.json`.
- Tightened `har-validation.js`, `fixture-validation.js`, `manifest-check.js`, and scrubbed remaining header/form tokens (`x-fb-lsd`, `x-csrftoken`, `fb_dtsg`, `jazoest`, `lsd`) from committed public HAR fixtures and `tests/fixtures/har/expected/baseline.json`.

### Tooling & Type Checking

- Included all browser scripts (`src/content/`, `src/popup/`, `src/offscreen/`, and main-world scripts) in `tsconfig.json` (`tsc --noEmit`: 0 errors) and enabled DEFLATE compression + stale artifact cleanup in `tools/build-dist.js`.

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
