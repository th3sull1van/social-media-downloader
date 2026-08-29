# Social Media Downloader — Architectural Overview

## Mission

**Social Media Downloader** is a modular browser extension built on Chrome Manifest V3 for discovering, resolving, downloading, and packaging media from social media platforms with full original fidelity.

The system is designed around a plugin architecture:

```text
                        SOCIAL MEDIA DOWNLOADER
                                   │
              ┌────────────────────┼────────────────────┐
              │                    │                    │
          Instagram             Facebook             Reddit
           Plugin                Plugin               Plugin
              │                    │                    │
              └───────────────┬────┘                    │
                              │                         │
                        Meta Shared                     │
                              │                         │
                              └──────────────┬──────────┘
                                             │
                                       Core Contracts
                                             │
                               ┌─────────────┼─────────────┐
                               │             │             │
                            Download        ZIP            UI
                             Engine        Engine         Engine
                               │             │             │
                               └─────────────┼─────────────┘
                                             │
                                        Runtime APIs
                                             │
                          ┌──────────────────┼──────────────────┐
                          │                  │                  │
                        Popup             Content             SW
                                             │
                                        Main World
                                           when needed
```

---

## Fundamental Invariant

> **Merge infrastructure, not platform behavior.**
> 
> - **Core** generalizes generic application workflows (queuing, concurrency, ZIP packaging, storage, filename sanitization, error reporting).
> - **Plugins** specialize in site detection, DOM inspection, API extraction, authentication, and platform media resolution.
> - **Contracts** connect them without platform conditionals in Core.

---

## First-Class Platform Ownership

1. **Instagram (`src/plugins/instagram/`)**:
   - Posts, multi-image/video carousels, reels, stories, highlights, HD profile pictures.
   - Main-world Polaris GraphQL integration with pagination.
   - Uncropped high-resolution CDN upgrading.

2. **Facebook (`src/plugins/facebook/`)**:
   - Profile media, photo collections, timeline feeds, multi-tab scans.
   - Comet GraphQL tree traversal and thumbnail upscaling.

3. **Reddit (`src/plugins/reddit/`)**:
   - Single images, galleries (DOM and JSON API), DASH video and audio stream pairing with MP4 moov/mdat box multiplexing in-browser.
   - RedGifs API v2 bearer token auth and resolution.
   - User profile submissions and subreddit feed scraping with cross-post deduplication.

4. **Meta Shared (`src/plugins/meta-shared/`)**:
   - Shared token harvest (`fb_dtsg`, `jazoest`, `csrftoken`, `appId`), authenticated GraphQL transport, and CDN URL upscaling.
