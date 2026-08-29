# Facebook Plugin — Architecture

## Overview
The Facebook plugin scans Facebook profiles, photo albums, and timeline media, stripping thumbnail query parameters and path crop markers to yield full-resolution originals.

## Key Components
- `FacebookDetector.js`: Cleans page titles and detects target albums.
- `FacebookNormalizer.js`: Traverses Comet GraphQL trees and normalizes photo nodes.
- `FacebookNaming.js`: Generates `SMD/Facebook/<targetName>/...` folder structures.
- `main-world/injected.js`: Interacts with Facebook Comet GraphQL endpoints.
- `FacebookPlugin.js`: Implements platform plugin contracts.
