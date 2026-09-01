# Fixture validation matrix

This matrix is the source of truth for regression inputs. Versioned compact
fixtures are the default test inputs; raw HAR captures are source evidence and
an explicit local validation gate for changes that affect capture extraction or
platform behavior.

## Fixture classes

| Class | Location | Versioned | Default test input | Use |
|---|---|---:|---|---|
| Compact extracted fixture | `tests/fixtures/extracted/<platform>/*.json` | Yes | Yes | Fast CI and deterministic parser/scanner/normalizer replay |
| Sanitized source HAR | `tests/fixtures/har/<platform>/*.har` | Yes | No | Public network-shape evidence and HAR checks |
| Private raw capture | `fixtures-private/*.har` | No | No | Local before/after raw replay; never commit |
| Synthetic unit fixture | Test source or focused fixture | Maybe | Yes, when appropriate | Contract and edge-case tests |

Compact fixtures contain only the allowlisted fields required by the production
path. They carry `fixtureVersion`, `fixtureType`, `sourceCaptureId`,
`extractionVersion`, `sanitizationVersion`, and `sanitized: true`. The source
capture identifier is descriptive and does not contain a local path, account
identifier, or secret hash.

## Current compact fixtures

| Platform | Fixture | Scenario/code paths |
|---|---|---|
| Instagram | `instagram/example-profile.json` | Public profile timeline and signed CDN URLs |
| Instagram | `instagram/instagram-profile.json` | Profile pagination, posts, carousels, stories, full-resolution upgrade |
| Instagram | `instagram/instagram-profile-v2.json` | Alternate profile payload and story/highlight extraction |
| Facebook | `facebook/facebook-profile.json` | GraphQL photos, profile/cover candidates, JSON scripts, DOM anchors, signed URLs |
| Facebook | `facebook/facebook-reels.json` | Reel payloads and photo exclusion |
| Facebook | `facebook/facebook-206x206.json` | Downscaled CDN request regression |
| Reddit | `reddit/example-feed.json` | Server-rendered feed, image, RedGifs, icon/style-asset exclusion |
| Reddit | `reddit/reddit-feed.json` | Feed/profile discovery and pagination |
| Reddit | `reddit/reddit-post.json` | Single-post scanning |
| Reddit | `reddit/reddit-gallery.json` | Gallery slide extraction and preview-to-fullres upgrade |
| Reddit | `reddit/reddit-empty-profile.json` | Suspicious empty-profile result guard |
| Reddit | `reddit/reddit-private-profile.json` | JSON API profile pagination and deduplication |

The generated manifest records exact byte sizes and the extraction source. The
complete compact set is validated with:

```bash
bun run check:fixtures
```

## Current private captures

Counts below were produced by scanning `log.entries` and classifying response bodies with `tools/har-replay.js` on 2026-08-28. They are inventory data, not permanent expected output.

| Platform | HAR | Entries | Relevant shapes | Replay |
|---|---|---:|---|---|
| Facebook | `fixtures-private/facebook-profile.har` | 1,340 | 106 Facebook GraphQL POST responses | `har-replay-platforms.test.js` |
| Instagram | `fixtures-private/instagram-profile-v2.har` | 726 | 14 timeline, 2 highlights, 2 reels | `har-replay.test.js` |
| Instagram | `fixtures-private/instagram-profile.har` | 2,048 | 44 timeline | `har-replay.test.js` |
| Reddit | `fixtures-private/reddit-feed.har` | 299 | 2 server-rendered `shreddit-post` responses | `har-replay-platforms.test.js` |
| Reddit | `fixtures-private/reddit-empty-profile.har` | 83 | 1 server-rendered response, empty-profile guard | `har-replay-platforms.test.js` |
| Reddit | `fixtures-private/reddit-post.har` | 115 | 1 server-rendered `shreddit-post` response | `har-replay-platforms.test.js` |
| Reddit | `fixtures-private/reddit-gallery.har` | 1 | 1 sanitized `shreddit-post` gallery with 3 `preview.redd.it` `-v0-` slides (closes G-1) | `har-replay-platforms.test.js` |

## Compact fixture code-path coverage

The versioned fixtures under `tests/fixtures/extracted/<platform>/` are the
CI-safe replay inputs. This table records the production paths exercised by the
compact set; a green run is not a claim of complete live-site coverage.

| Fixture | Platform | Code paths exercised | Paths NOT exercised by this fixture |
|---|---|---|---|
| `instagram/*.json` | Instagram | Timeline, profile pagination, carousels, stories/highlights, normalization, signed URL preservation, full-resolution upgrade, naming/path and nonce checks | Live browser lifecycle and unsupported response shapes |
| `reddit/*.json` | Reddit | Server-rendered `shreddit-post`, image/gallery/RedGifs scanning, icon/style-asset exclusion, JSON API profile pagination, deduplication, preview-to-fullres upgrade, empty-result guard | Live browser lifecycle and full DASH network transfer |
| `facebook/facebook-profile.json` | Facebook | GraphQL extraction, profile/cover candidates, inline JSON scripts, DOM anchors, signed CDN URLs, downscaled-request and facepile exclusion | Live browser lifecycle and unrepresented GraphQL schemas |
| `facebook/facebook-reels.json` | Facebook | Reel payload extraction and non-photo filtering | Live reel navigation |

The compact fixtures are extracted from the corresponding local captures with
deterministic synthetic identities and URL hosts. Their assertions preserve
relationships, ordering, signed-query shape, dimensions, and error semantics;
they do not retain original account data.

## Invariant coverage

| Platform/scenario | Extraction | Normalization | Resolver/URL | Dimensions | Ordering | Dedup | Naming/path | Zero-result | Security/parity |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| Instagram timeline | Yes | Yes | Yes | Yes | Yes | Yes | Yes | No | Signed URL, host, nonce |
| Instagram stories/highlights | Yes | Yes | Yes | Partial | Yes | Yes | Yes | No | Host/path |
| Instagram video token naming | Yes | Yes | Yes | Yes | N/A | Yes | Yes | N/A | Token rejection |
| Facebook GraphQL photos | Yes | Yes | Yes | Partial | Partial | Yes | Yes | N/A | Signed URL, album-tile exclusion |
| Facebook DOM harvest | Yes | Partial/raw | Yes | Partial | Partial | Yes | Yes | N/A | Host/page-URL exclusion |
| Reddit server-rendered feed (image + RedGifs) | Yes | Yes | Yes | Partial | Yes | Yes | Yes | Yes | Host/path/MediaItem, **icon/style-asset exclusion** |
| Reddit gallery | Yes (`reddit-gallery.har` slide URLs upgrade preview→i) | Yes | Yes | Partial | Yes | Yes | Yes | N/A | Host/path, icon-exclusion |
| Reddit video (DASH muxing) | Partial (v.redd.it baseUrl set) | Yes | Yes | Partial | N/A | Yes | Partial | N/A | Host/path |
| Content-script bridge | N/A | Yes | N/A | Yes | Yes | Yes | Yes | N/A | Nonce spoof rejection |
| ZIP/offscreen transport | N/A | N/A | N/A | N/A | N/A | N/A | N/A | Yes | OPFS-only ZIP, bounded base64 chunks, data descriptors, empty ZIP guard |

## Required evidence by change class

| Change class | Required validation |
|---|---|
| Platform/network parser, normalizer, scanner or resolver | Relevant compact replay; raw before/after replay when the relevant capture is available; compare IDs, URLs, dimensions, ordering, names/paths, and errors. |
| Core runtime or data contract | Full compact suite plus affected unit/contract/integration tests. |
| Manifest, permissions or execution context | Full compact regression, manifest validation, and browser smoke test when available. |
| Tests/tooling only | Compact suite; raw before/after when extraction, anonymization, or raw replay tooling changes. |
| Documentation-only | Static checks; compact regression when it describes implemented behavior; raw replay only when it changes a documented capture claim. |
| Security-sensitive | Compact sanitizer check, secret scan, relevant raw replay, and explicit review of changed invariants. |

## Coverage gaps (`missing-evidence`)

- **G-1 — Reddit gallery slides (RESOLVED)**: the compact `reddit-gallery.json`
  fixture is extracted from `fixtures-private/reddit-gallery.har` and asserts
  that real slide URLs upgrade from `preview.redd.it` to `i.redd.it`.
- The compact set is intentionally smaller than the private captures; add or
  regenerate a fixture when a new response shape or regression is not
  represented.
- Browser lifecycle, CSP, popup rendering, service-worker lifetime and real
  Chrome download APIs are not proven by fixture replay.
- Live-site behavior is intentionally not part of the routine deterministic gate.

A missing compact fixture is a blocking condition for a change that depends on
that behavior. Missing raw evidence must be reported as `UNVERIFIED` when the
relevant capture cannot be obtained.

## Commands

```bash
bun run validate:local
bun run fixtures:extract
bun run check:fixtures
bun run validate:raw
bun tests/integration/har-replay.test.js
bun tests/integration/har-replay-platforms.test.js
```

Private fixtures are local evidence. They must stay under `fixtures-private/` and remain ignored by Git.
