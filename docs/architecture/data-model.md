# Data Model — Core Contracts

The data layer is the boundary between platform discovery (plugins) and generic
application behavior (Core). Platform-specific data lives in `metadata`;
generic data lives at the top level.

## MediaItem

```ts
interface MediaItem {
  id: string;
  platform: string;
  type: "image" | "video" | "audio" | "file";
  sourceType: string;

  url?: string;
  downloadUrl?: string;
  thumbnailUrl?: string;

  filename?: string;
  extension?: string;
  mimeType?: string;

  width?: number;
  height?: number;
  duration?: number;

  title?: string;
  caption?: string;

  author?: AuthorInfo;      // { id?, username?, name?, url?, avatarUrl? }
  collection?: CollectionInfo; // { id?, name?, type?, url? }
  location?: object;

  metadata: Record<string, unknown>;
  capabilities: MediaCapabilities; // { directDownload, requiresMuxing, requiresAuth, supportsThumbnail }
}
```

Factory: `MediaItemModel.create()` (validates) in `src/core/domain/MediaItem.js`.

## PlatformTarget

```ts
interface PlatformTarget {
  platform: string;
  type: "page" | "post" | "profile" | "album" | "collection" | "subreddit" | "story" | "unknown";
  id?: string;
  name?: string;
  url?: string;
  metadata: Record<string, unknown>;
}
```

Factory: `PlatformTargetModel.create()` in `src/core/domain/PlatformTarget.js`.
`formatDisplayName()` is deliberately platform-neutral; platform display naming
belongs to the plugin (AGENTS §24, SPEC §57).

## ScanResult

```ts
interface ScanResult {
  platform: string;
  target: PlatformTarget;
  items: MediaItem[];
  hasMore?: boolean;
  nextCursor?: string;
  status: "success" | "partial" | "empty" | "unsupported" | "authentication_required"
    | "rate_limited" | "network_failure" | "parse_failure" | "resolver_failure" | "cancelled";
  metadata: Record<string, unknown>;
}
```

An empty `items` array does not imply success. Factory:
`ScanResultModel.create()` in `src/core/domain/ScanResult.js`.

## DownloadArtifact

Two kinds in `src/core/domain/DownloadArtifact.js`:

```ts
type DownloadArtifact =
  | { kind: "direct"; source: { url: string; headers?: Record<string,string> }; output: { filename: string; mimeType?: string } }
  | { kind: "generated"; data: Blob | ArrayBuffer | Uint8Array; output: { filename: string; mimeType?: string } };
```

## DownloadJob

```ts
interface DownloadJob {
  id: string;
  traceId?: string;
  platform: string;
  targetName: string;
  format: "individual" | "zip";
  item?: MediaItem;
  artifact?: DownloadArtifact;
  state: "queued" | "resolving" | "downloading" | "processing" | "completed" | "failed" | "cancelled";
  progress?: ProgressInfo;
  createdAt: number;
}
```

## Capabilities

Declared by plugins in `src/core/domain/Capabilities.js`; consumed by Core and
the UI to decide generic-control availability (SPEC §31, §58).

```ts
interface PlatformCapabilities {
  scan: { page?, post?, profile?, album?, collection?, subreddit?, stories?, highlights?, pagination? };
  media: { image?, gallery?, video?, audio?, avatar? };
  resolution: { direct?, custom?, background? };
  download: { direct?, streamed?, generated?, chunked? };
  processing: { muxing?, deduplication?, transcoding? };
  runtime: { mainWorld?, contentScript?, offscreen? };
}
```

## Errors

Typed hierarchy in `src/core/domain/Errors.js`: `AppError` base plus
`AuthenticationRequiredError` and `RateLimitedError` — the only subclasses
with real throw sites. SPEC §74's fuller taxonomy is an allowed vocabulary:
add a subclass at its first actual throw site, not speculatively.
