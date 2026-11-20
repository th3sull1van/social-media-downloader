# ADR-004: Download Artifact Abstraction

## Status
Accepted

## Context
Not all media downloads are direct HTTP URLs. Reddit videos require separate audio and video DASH stream fetching and MP4 moov/mdat box multiplexing, generating a local in-memory Blob.

## Decision
Introduce the `DownloadArtifact` model supporting two kinds:
1. `direct`: A standard URL with optional headers.
2. `generated`: An in-memory binary Blob/ArrayBuffer.

A `pipeline` kind may be added when a real multi-step resolution flow needs
more than fetch-and-execute; none exists today.

## Alternatives Considered
- Teach `DownloadManager` directly about DASH MP4 muxing and RedGifs tokens: leaks Reddit-specific internals into Core.
- Force plugins to call `chrome.downloads` themselves: bypasses unified queueing, deduplication, ZIP packaging, and download ledger reconciliation.

## Consequences
- Core DownloadManager handles both direct URLs and generated Blobs cleanly without knowing anything about DASH or video codecs.
