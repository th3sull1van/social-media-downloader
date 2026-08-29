# ADR-010: Scope Decision — Wire All Three Platforms

## Status
Accepted (2026-08-27)

## Context
The 2026-08-27 audit found that Facebook and Reddit had
no functional scan path: the content script's `scanAll()` only executed Instagram code, the
Facebook GraphQL bridge had no emitter, and the entire Reddit pipeline (scanner, muxer,
RedGifs resolver) had zero production callers. The popup was unreachable (no `default_popup`).

Two honest options existed:

1. **Descope**: remove Facebook/Reddit code, fix docs/manifest, ship Instagram-only.
2. **Wire**: connect the existing (ported, tested-in-isolation) platform code to the runtime.

## Decision
Wire all three platforms. The platform code existed, followed the plugin contract, and was
partially covered by tests; the missing piece was orchestration glue, not implementation.

How each platform was wired:

- **Instagram**: unchanged (already functional). Security hardening only (bridge nonce,
  safe rendering, URL allowlist).
- **Reddit**: content script requests a scan from the service worker (`REDDIT_SCAN`);
  the SW calls `RedditScanner.fetchSubredditPosts/fetchUserSubmissions/fetchPostById`
  (public JSON API, privileged fetch). Items with `metadata.baseUrl` (DASH) or RedGifs
  items are resolved through `RedditPlugin.resolveMedia` in the DownloadManager:
  muxed MP4 blobs are materialized as offscreen blob URLs and downloaded.
- **Facebook**: content script implementation of the photo-tab navigation flow:
  navigate the profile photo tabs (`photos_of`, `photos_by`, `photos_albums`, custom
  albums), scroll each with progressive pagination, harvest rendered DOM photos plus
  embedded `application/json` script payloads. The Comet Router navigation
  helper (`NAVIGATE_FB_TAB`) was added to the Facebook injected script.

## Alternatives considered
- Descope to Instagram-only: smaller surface, but threw away working, tested code and
  contradicted the repository's stated mission (ADR-001/002/003).
- Facebook via GraphQL doc IDs: the `DOC_IDS.FB_*` constants were not verified
  for standalone photo extraction; the documented working path was DOM navigation. Chose the proven path.

## Consequences
- Facebook/Reddit flows require manual browser verification per AGENTS §76 (not possible
  from the audit environment); the audit's *connection* is verified by tests, the
  *behavior against live sites* is not.
- The Reddit muxer is now reachable in production; its known limitations (64-bit MP4
  boxes, stco not rewritten) moved from "dead code" to "documented limitation" — see
  `docs/platforms/reddit/KNOWN_LIMITATIONS.md`.
- The typecheck excludes browser-context classic scripts (content/popup/offscreen/
  main-world); see `tsconfig.json` comments.
