# Download Pipeline

The download path is split cleanly: the **plugin owns resolution**, the **Core
owns execution**. Core deliberately has no knowledge of how media is resolved
(no RedGifs / DASH / CDN names in the download engine).

## Contract boundary

```text
MediaItem
   ↓  plugin.resolveMedia(item)  (if provided)
DownloadArtifact   (direct | generated)
   ↓  Core DownloadManager.execute(artifact)
DownloadJob
   ↓  queue / executor
Output (individual file or ZIP archive)
```

## Plugin resolution (ownership)

- `InstagramPlugin` / `FacebookPlugin` do not implement `resolveMedia`; their
  items are fetched directly from `item.downloadUrl || item.url`.
- `RedditPlugin` implements `resolveMedia`:
  - DASH videos (`metadata.baseUrl`) → muxed MP4 blob via `RedditVideoMuxer`.
  - RedGifs embeds (`sourceType === 'redgifs'`) → direct MP4 via `RedGifsResolver`.
  - everything else → `DirectArtifact` from `downloadUrl || url`.

The Core `DownloadManager` calls `plugin.resolveMedia()` **whenever the plugin
provides it** and then merely executes the returned artifact by `kind`. It never
inspects `metadata.isRedGifs` / `sourceType` / `baseUrl` to decide behavior.

## Core execution (`src/core/application/DownloadManager.js`)

- `downloadItem()`: resolve via plugin (if any) then execute the artifact:
  - `kind === 'direct'` → `chrome.downloads.download(url)`.
  - `kind === 'generated'` → create an offscreen blob URL, then download.
  - otherwise → direct download of `downloadUrl || url`.
- `processZipDownload()`: stream each item into `ArchiveService` (offscreen ZIP),
  respecting a size limit and per-item failure isolation. Direct `Response`
  bodies are transferred in bounded chunks; ZIP entry order is serialized by
  `ArchiveService` while the network fetch workers remain concurrent.
- `processIndividualDownloads()`: concurrency limits (default 6), per-item
  progress, cancellation-aware worker pool.
- Cancellation propagates from `CANCEL_DOWNLOAD` to the job status and is never
  reported as success (SPEC §40, AGENTS §96).
- Progress is reported by stage and normalized (SPEC §41, AGENTS §97).

## Offscreen packaging (`src/offscreen/offscreen.js`)

The service worker has no `URL.createObjectURL`; the offscreen document performs
ZIP assembly and blob-URL creation (`reasons: ['BLOBS']`, ADR-007). OPFS is
mandatory for ZIP packaging: there is no in-memory archive fallback. Binary
payloads cross the JSON message boundary as bounded base64 chunks because
`chrome.runtime.sendMessage` JSON-serializes messages. Local headers use ZIP
data descriptors, allowing CRC and sizes to be computed incrementally.

## Archive safety

Generic path uniquification and filename sanitization are owned by Core
(`FilenameService`, `uniquifyArchivePath`). ArchiveService consumes generic
`ArchiveEntry { path, binary }` and knows nothing about any platform (SPEC §44,
§166, AGENTS §49).
