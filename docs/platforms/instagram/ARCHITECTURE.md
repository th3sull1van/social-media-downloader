# Instagram Plugin — Architecture

## Overview
The Instagram plugin discovers and extracts maximum resolution media from Instagram profiles, individual posts, carousels, reels, stories, highlights, and profile pictures.

## Key Components
- `InstagramDetector.js`: URL pattern and target matching.
- `InstagramNormalizer.js`: Converts GraphQL nodes and edges into `MediaItem`s.
- `InstagramNaming.js`: Resolves `SMD/Instagram/@username/...` paths.
- `main-world/injected.js`: Injected page script for authenticated Polaris GraphQL queries.
- `InstagramPlugin.js`: Manifests capabilities and contracts.
