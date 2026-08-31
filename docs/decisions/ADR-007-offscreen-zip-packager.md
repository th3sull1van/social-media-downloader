# ADR-007: Dedicated Offscreen Document for ZIP Packaging

## Status
Accepted

## Context
Manifest V3 Service Workers have a transient execution lifecycle and cannot directly create DOM/Blob object URLs for `chrome.downloads`. Generating large ZIP archives directly in popup memory can cause UI freezing and tab crashes.

Delegate ZIP packaging in `STORE` mode (instant packaging for already-compressed JPEG/MP4 media) to a dedicated Manifest V3 Offscreen document with a 1GB safety ceiling. The writer is OPFS-only and receives bounded base64 chunks through the service worker; ZIP data descriptors allow incremental CRC/size calculation (a hand-written STORE engine in `src/offscreen/offscreen.js` — no external ZIP library).

## Consequences
- Prevents UI freezing during large multi-hundred-item downloads.
- Protects browser memory with automatic object URL revoking.
- Fails explicitly when OPFS is unavailable or its quota is exhausted; it does
  not construct a whole archive in application memory.
