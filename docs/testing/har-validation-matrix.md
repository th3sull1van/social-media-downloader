# HAR validation matrix

This matrix is the source of truth for captured-network regression coverage. A scenario is covered only when its listed replay test executes the real production path against the listed HAR fixture.

## Fixture classes

| Class | Location | Versioned | Use |
|---|---|---:|---|
| Private capture | `fixtures-private/*.har` | No | Local replay with real account/session captures. Never commit. |
| Sanitized fixture | `tests/fixtures/har/<platform>/*.har` | Yes | CI-safe replay. Must pass the sanitization check. |
| Synthetic fixture | Test source or non-HAR fixture | Maybe | Unit/contract edge cases only. It cannot satisfy HAR coverage. |

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

## Sanitized public fixture code-path coverage

The versioned fixtures under `tests/fixtures/har/<platform>/` are the CI-safe replay inputs.
This table records **which production code paths each one actually exercises** (measured 2026-08-28
against the real scanner/normalizer), not merely that "a replay exists". Asymmetric coverage is
called out so a green CI run is not mistaken for full coverage.

| Fixture | Platform | Code paths exercised | Paths NOT exercised by this fixture |
|---|---|---|---|
| `instagram/example-profile.har` | Instagram | `extractTimelineNodes` (xdt/edge timeline), `InstagramNormalizer.normalizePost`, signed-URL verbatim preservation (100% of 685 URLs signed), HEIC extension preservation, `InstagramNaming.getOriginalFilename` against numeric `_n` basenames | Stories/highlights (`extractStoryItems` yields 0 — fixture is profile timeline only); video-token naming guard (no ephemeral `/o1/v/t2/...` video URLs present); unsigned-CDN branch; non-fna host |
| `reddit/example-feed.har` | Reddit | `extractRedditPosts` (shreddit HTML, NSFW server-render fallback), `RedditScanner.extractFromShredditPost`, `RedditNormalizer.normalizeItem`, `preview.redd.it`→`i.redd.it` upgrade, RedGifs (`redgifs` source type), single-image (`reddit_image`), **icon/style-asset exclusion** (`RedditScanner.isIconOrStyleAsset`) | Real gallery slide extraction — `post-type="gallery"` posts in this capture only carry decorative `profileIcon_`/`communityIcon_` noise; JSON-API path (`parseApiPostObject`); `v.redd.it` DASH muxing |
| `facebook/example-profile.har` | Facebook | `extractFacebookData` GraphQL branch (`/api/graphql/` POST), `FacebookNormalizer.extractPhotosFromGraphQL` (689 photos from 96 responses, 0 errors), signed-URL verbatim preservation (99.7%) | Inline `application/json` script sweep (`jsonScripts` = 0 — all URLs live inside GraphQL bodies here); DOM anchor harvest (`htmlPages` = 0); album-tile discriminator edge (no `TimelineAppCollectionItem` tiles present) |

NOTE: the two private Facebook/Reddit captures (`facebook-profile.har`, `reddit-feed.har`) DO exercise
the GraphQL json-script sweep and DOM-harvest branches, and the reddit-feed capture is where the
icon-exclusion guard removes 13 `communityIcon_`/`profileIcon_` URLs. The public fixtures are a
representative subset, not the full surface.

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
| ZIP/offscreen transport | N/A | N/A | N/A | N/A | N/A | N/A | N/A | Yes | JSON/base64 round-trip, empty ZIP guard |

## Required evidence by change class

| Change class | Required validation |
|---|---|
| Platform/network parser, normalizer, scanner or resolver | Relevant HAR replay before and after; update/add sanitized fixture if shape is uncovered. |
| Core runtime or data contract | Full replay suite plus affected unit/contract/integration tests. |
| Manifest, permissions or execution context | Full replay regression plus manifest validation and browser smoke test when available. |
| Tests/tooling only | Full replay regression; prove the harness still exercises real production code. |
| Documentation-only | Full replay regression when it describes observed platform behavior; otherwise static checks are sufficient. |
| Security-sensitive | Full relevant replay, sanitization check, secret scan and explicit review of changed invariants. |

## Coverage gaps (`missing-evidence`)

- **G-1 — Reddit gallery slides (RESOLVED)**: committed reddit captures (`reddit-feed.har`, `example-feed.har`, `reddit-post.har`) contained no real gallery image URLs — `post-type="gallery"` posts only carried decorative `profileIcon_`/`communityIcon_` noise in their gallery slots. Closed by `fixtures-private/reddit-gallery.har` (sanitized `<gallery-carousel>` with real `preview.redd.it/...-v0-` slide URLs upgrading to `i.redd.it`); the HAR replay suite now asserts `reddit_gallery > 0`. Regenerate via `tools/gen-reddit-gallery-fixture.js`.
- The versioned sanitized fixtures currently cover one representative replay shape per platform. They are intentionally smaller than the private captures; add another fixture when a new response shape or regression is not represented.
- Browser lifecycle, CSP, popup rendering, service-worker lifetime and real Chrome download APIs are not proven by HAR replay.
- Live-site behavior is intentionally not part of the routine deterministic gate.

A missing fixture is a blocking condition for a change that depends on that behavior. It is not a passing result.

## Commands

```bash
bun run validate:local
bun run validate
bun tests/integration/har-replay.test.js
bun tests/integration/har-replay-platforms.test.js
```

Private fixtures are local evidence. They must stay under `fixtures-private/` and remain ignored by Git.
