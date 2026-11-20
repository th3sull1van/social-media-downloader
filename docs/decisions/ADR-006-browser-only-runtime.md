# ADR-006: Browser-Only Production Runtime

## Status
Accepted

## Context
Extensions should not require users to run external daemons, local HTTP servers, Node.js, or Bun in production.

## Decision
All production code runs directly in Chrome Manifest V3 using native ES Modules and Chrome APIs. Node.js is strictly a development toolchain for running automated tests and validation scripts.

## Alternatives Considered
- Native Messaging host / local helper binary (`yt-dlp`, `ffmpeg`): solves large muxing/transcoding, but destroys zero-setup installation and cross-platform extension store packaging.
- Bundled WebAssembly transcoders in the extension package: exceeds store size budgets for a workflow where browser-native MP4 `moov`/`mdat` muxing and `STORE` ZIP packaging suffice.

## Consequences
- End users can load the unpacked extension directly into any Chromium browser.
