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

## Consequences
- Core DownloadManager handles both direct URLs and generated Blobs cleanly without knowing anything about DASH or video codecs.
