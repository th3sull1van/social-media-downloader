# Reddit Plugin — Architecture

## Overview
The Reddit plugin extracts images, multi-image galleries, native Reddit DASH videos (with multiplexed audio), RedGifs embeds, and supports dual-layer scanning (DOM + public JSON API) with cross-post deduplication.

## Key Components
- `RedditDetector.js`: URL and target matching (subreddits, users, posts).
- `RedditNormalizer.js`: Preview URL cleaner, media hash extractor, and cross-post score deduplicator.
- `RedditVideoMuxer.js`: DASH video and audio candidate discovery and in-browser MP4 moov/mdat box multiplexing.
- `RedGifsResolver.js`: Temporary bearer token authorization and API v2 direct video resolution.
- `RedditNaming.js`: Deterministic file and directory naming templates.
- `RedditScanner.js`: DOM observer and JSON API fetcher.
- `RedditPlugin.js`: Manifests capabilities and contracts.
