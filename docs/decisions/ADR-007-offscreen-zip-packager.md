# ADR-007: Dedicated Offscreen Document for ZIP Packaging

## Status
Accepted

## Context
Manifest V3 Service Workers have a transient execution lifecycle and cannot directly create DOM/Blob object URLs for `chrome.downloads`. Generating large ZIP archives directly in popup memory can cause UI freezing and tab crashes.

## Decision
Delegate JSZip packaging in `STORE` mode (instant packaging for already-compressed JPEG/MP4 media) to a dedicated Manifest V3 Offscreen document with a 1GB safety ceiling and stream chunks via structured clone/base64.

## Consequences
- Prevents UI freezing during large multi-hundred-item downloads.
- Protects browser memory with automatic object URL revoking.
