# Social Media Downloader — Technical Specification

**Document status:** Baseline Architecture  
**Version:** 1.0.0  
**System:** Social Media Downloader  
**Runtime:** Chrome Extension — Manifest V3  
**Primary implementation language:** Modern JavaScript / ES Modules  
**Development baseline:** Bun  
**Production dependency on Node/Bun:** None

---

# 0.1. RFC 2119 Keyword Convention

The normative keywords used throughout this document and `AGENTS.md` follow **RFC 2119**:

- **MUST** / **MUST NOT** — absolute requirement (or prohibition). Violations break the contract; no exceptions without an ADR.
- **SHOULD** / **SHOULD NOT** — strong recommendation. Deviation is allowed but MUST be justified in code review and noted in the change description.
- **MAY** — truly optional. Implementation freedom.
- **REQUIRED** / **SHALL** — synonyms of MUST, kept for prose flow.
- **RECOMMENDED** — synonym of SHOULD.

Default precedence when two rules conflict:

1. The rule with the higher priority in `AGENTS.md §150 (Ultimate Rules)` wins.
2. Among rules of equal priority, the more specific (narrower scope) rule wins over the more general one.
3. If still tied, the rule that preserves existing platform behavior (AGENTS.md §2) wins.
4. The disagreement MUST be recorded in platform documentation or an ADR within the same release cycle.

**Test command:** `bun run check:keywords` (when added) SHOULD flag prose that mixes MUST and SHOULD in the same sentence without justification.

---

# 1. Purpose

Social Media Downloader is a modular browser extension for discovering, resolving, downloading, and packaging media from supported social-media platforms.

The system must provide a common application infrastructure while allowing each supported platform to retain its own implementation, quirks, APIs, extraction techniques, authentication behavior, and media-processing requirements.

The initial supported platforms are:

```text
Instagram
Facebook
Reddit
```

These are independent first-class plugins.

The architecture must permit additional platforms to be added without modifying the existing platform implementations and without duplicating generic infrastructure.

---

# 2. Design Goals

The system MUST prioritize:

1. preservation of existing platform behavior;
2. clear platform isolation;
3. stable Core contracts;
4. incremental migration;
5. deterministic behavior;
6. strong regression testing;
7. reproducible debugging;
8. secure handling of captured data;
9. maintainable documentation;
10. low-cost addition of future platforms.

The system SHOULD also prioritize:

- low runtime overhead;
- browser-native APIs;
- simple source-to-runtime mapping;
- minimal unnecessary dependencies;
- strong observability;
- compatibility with autonomous coding agents.

---

# 3. Non-Goals

The project is NOT intended to:

- create one universal scraper implementation;
- normalize all websites into identical internal behavior;
- force every platform to use the same extraction strategy;
- require an external server;
- require Node.js or Bun in production;
- erase platform-specific semantics;
- dynamically discover arbitrary plugins from the filesystem at runtime;
- replace working platform implementations merely to reduce code size.

---

# 4. Fundamental Architectural Principle

The system MUST follow:

```text
Plugins specialize.
Core generalizes.
Contracts connect them.
```

Or:

```text
Platform-specific behavior
        ↓
Platform Plugin
        ↓
Stable Core Contract
        ↓
Generic Application Infrastructure
```

The system must **contain platform differences**, not eliminate them.

---

# 5. Platform Model

The architecture is:

```text
Social Media Downloader
│
├── Core
│
└── Plugins
    ├── Instagram
    ├── Facebook
    └── Reddit
```

Instagram and Facebook MUST remain separate plugins even though both belong to Meta.

Shared Meta implementation MAY exist as:

```text
plugins/meta-shared/
```

but only where behavior is genuinely shared.

---

# 6. Platform Ownership

## 6.1 Instagram

Owns:

- Instagram detection;
- Instagram DOM;
- Instagram routes;
- Instagram GraphQL;
- Instagram pagination;
- posts;
- carousels;
- reels;
- stories;
- highlights;
- profile media;
- Instagram-specific CDN resolution;
- Instagram-specific authentication;
- Instagram-specific selectors.

## 6.2 Facebook

Owns:

- Facebook detection;
- Facebook DOM;
- Facebook routes;
- Facebook GraphQL;
- Facebook collections;
- albums;
- profile media;
- multi-tab behavior;
- navigation;
- Facebook-specific CDN resolution;
- Facebook-specific authentication;
- Facebook-specific selectors.

## 6.3 Reddit

Owns:

- Reddit detection;
- Reddit DOM;
- Reddit API/network structures;
- image resolution;
- galleries;
- Reddit video;
- DASH;
- audio/video pairing;
- muxing;
- RedGifs;
- profile scanning;
- deduplication;
- Reddit-specific cache behavior;
- Reddit-specific media processing.

---

# 7. Shared Meta Layer

A `meta-shared` layer MAY exist:

```text
src/plugins/meta-shared/
```

Its purpose is limited to implementation shared by both Instagram and Facebook.

Potential examples:

```text
GraphQL transport helpers
Meta CDN helpers
common request primitives
common session abstractions
common response utilities
```

It MUST NOT become:

```text
Meta Core
```

Nor may it become a dependency of generic Core merely because the code is useful.

Dependency direction:

```text
Instagram ─┐
            ├──> meta-shared
Facebook ──┘
```

not:

```text
Core → meta-shared
```

unless the functionality has genuinely become platform-independent.

---

# 8. Layered Architecture

The system consists of the following layers:

```text
Presentation
Application
Domain
Infrastructure
Platform
Runtime
```

Conceptually:

```text
┌───────────────────────────────────┐
│ Presentation / UI                 │
├───────────────────────────────────┤
│ Application Core                  │
├───────────────────────────────────┤
│ Domain Contracts                  │
├───────────────────────────────────┤
│ Generic Infrastructure            │
├───────────────────────────────────┤
│ Platform Plugins                  │
├───────────────────────────────────┤
│ Browser Runtime                   │
└───────────────────────────────────┘
```

Platform-specific logic must remain below the plugin boundary.

---

# 9. Repository Structure

Recommended repository:

```text
social-media-downloader/
│
├── src/
│   ├── core/
│   │   ├── domain/
│   │   ├── application/
│   │   ├── services/
│   │   ├── runtime/
│   │   ├── messaging/
│   │   ├── storage/
│   │   ├── diagnostics/
│   │   └── ui/
│   │
│   ├── plugins/
│   │   ├── instagram/
│   │   ├── facebook/
│   │   ├── reddit/
│   │   └── meta-shared/
│   │
│   ├── background/
│   ├── content/
│   ├── offscreen/
│   ├── popup/
│   └── types/                  # ambient TypeScript declarations for browser-extension globals (chrome, WorkerGlobalScope). Used by `tsc --noEmit` to typecheck JSDoc.
│
├── tests/
│   ├── core/
│   ├── contracts/
│   ├── fixtures/
│   │   ├── instagram/
│   │   ├── facebook/
│   │   └── reddit/
│   ├── integration/
│   ├── regression/
│   └── helpers/
│
├── docs/
│   ├── architecture/
│   ├── platforms/
│   │   ├── instagram/
│   │   ├── facebook/
│   │   └── reddit/
│   ├── development/
│   ├── debugging/
│   ├── operations/
│   └── decisions/
│
├── tools/
│   ├── fixtures/
│   ├── validation/
│   ├── debugging/
│   └── development/
│
├── assets/
├── vendor/
├── _locales/
│   ├── en/
│   └── pt_BR/
│
├── manifest.json
├── package.json
├── bun.lock
├── tsconfig.json
├── AGENTS.md
├── CONTRIBUTING.md
├── README.md
└── README_pt-BR.md
```

The exact subdivision may evolve, but ownership rules MUST remain intact.

## 9.1 Build configuration files

`tsconfig.json` and `jsconfig.json` exist alongside source code. `tsconfig.json` configures `tsc --noEmit` for JSDoc type-checking (AGENTS.md §63, §15). `jsconfig.json` configures VSCode IntelliSense for JSDoc. Neither file introduces a TypeScript build step: production code is JavaScript with JSDoc annotations only.

## 9.2 Locales

Multiple locales (default: pt_BR per manifest.json; the full list lives in `_locales/`).

---

# 10. Directory Governance

Top-level directories must have explicit architectural responsibilities.

Avoid generic directories such as:

```text
misc/
stuff/
common/
helpers/
utils/
temp/
random/
```

unless their purpose is clearly defined and documented.

A new architectural directory must:

1. have a documented responsibility;
2. have a clear owner;
3. have consistent dependency rules;
4. be reflected in architecture documentation.

Directory organization is part of the architecture.

---

# 11. Runtime Environments

The production extension runs entirely inside the browser.

Runtime contexts:

```text
Popup
Content Script
Service Worker
Offscreen Document
Main World
```

Not all platforms require all contexts.

A plugin declares the contexts it needs.

---

# 12. Runtime Context Responsibilities

## Popup

Responsible for:

- generic extension UI;
- user interaction;
- scan initiation;
- selection;
- download controls;
- progress display.

## Content Script

Responsible for:

- page integration;
- DOM observation;
- platform UI hooks;
- page-specific interactions.

## Service Worker

Responsible for:

- background orchestration;
- job management;
- messaging;
- downloads;
- persistence coordination;
- plugin runtime coordination.

## Offscreen Document

Responsible for functionality unavailable in service-worker context, when required.

Typical examples:

- ZIP generation;
- binary processing;
- DOM-dependent processing unavailable elsewhere.

## Main World

Used only when a platform requires access to page-context JavaScript or internal application state.

Main-world behavior must remain platform-owned.

---

# 13. Runtime Independence

The production extension MUST NOT require:

```text
Node.js
Bun
npm
Python
local server
external daemon
```

The browser is the sole production runtime.

---

# 14. Development Toolchain

Canonical development environment:

```text
Bun
```

Do not use Bun-specific APIs in browser runtime code.

The project must remain reproducible using its canonical Bun setup.

---

# 15. Language

Primary implementation language:

```text
Modern JavaScript
ES Modules
```

Use:

```text
JSDoc
checkJs
```

for type safety.

Core contracts SHOULD have explicit type definitions.

TypeScript MAY be adopted in the future if contract complexity justifies it, but a project-wide TypeScript migration is not part of the baseline architecture.

---

# 16. Build System

Prefer native JavaScript and browser ES modules.

No bundler is required by default.

A build system MAY be introduced when justified by:

- dependency packaging;
- browser compatibility;
- performance;
- extension packaging;
- CSP;
- source transformation requirements.

If introduced:

- source remains canonical;
- source maps are required;
- DevTools debugging must remain usable;
- generated files are separate from source;
- documentation explains the build pipeline.

---

# 17. Core Responsibilities

Core owns:

- canonical data models;
- application orchestration;
- plugin registry;
- capability handling;
- download jobs;
- queue;
- concurrency;
- cancellation;
- retry policy;
- progress;
- generic storage;
- messaging;
- ZIP;
- archive handling;
- filename sanitization;
- generic UI;
- localization;
- diagnostics;
- generic logging.

Core does not understand platform-specific extraction.

---

# 18. Plugin Responsibilities

Plugins own:

- platform detection;
- page detection;
- target detection;
- platform DOM;
- platform API;
- network interception;
- authentication;
- media discovery;
- media normalization;
- media resolution;
- specialized processing;
- platform naming context;
- platform UI insertion;
- platform-specific diagnostics.

---

# 19. Core Dependency Rule

Core MUST NOT import platform-specific implementation modules.

Forbidden:

```text
core → instagram
core → facebook
core → reddit
```

Allowed:

```text
core → plugin interface
core → plugin registry
```

Core may invoke a registered plugin through an interface.

---

# 20. Plugin Dependency Rule

Plugins may depend on:

```text
Core contracts
Core services
Meta Shared when applicable
```

Plugins MUST NOT depend on other platform plugins.

Forbidden:

```text
instagram → facebook
facebook → instagram
reddit → instagram
reddit → facebook
```

---

# 21. Platform Conditionals

Platform-specific branching in Core is prohibited.

Avoid:

```js
if (platform === "reddit") ...
if (platform === "instagram") ...
if (platform === "facebook") ...
```

inside generic services.

Use:

```text
plugin registry
capabilities
interfaces
dependency injection
```

instead.

---

# 22. Domain Model: MediaItem

The normalized media object is the principal platform/Core boundary.

## 22.1. MediaItem Schema Versioning

Every `MediaItem` MUST carry `schemaVersion: 1` at the top level. The Core defines the schema for a given version; older versions are migrated by Core on read. A future `MediaItem` MAY add fields; removing or renaming fields requires a major version bump and a deprecation cycle (see SPEC §152).

A media item without a `schemaVersion` field is treated as version 1 for backward compatibility, but new code SHOULD always emit it explicitly.

```ts
interface MediaItem {
  id: string;
  platform: string;

  type:
    | "image"
    | "video"
    | "audio"
    | "file";

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

  author?: AuthorInfo;
  collection?: CollectionInfo;
  location?: LocationInfo;

  metadata: Record<string, unknown>;

  capabilities: MediaCapabilities;
}
```

---

# 23. MediaItem Metadata

Platform-specific metadata belongs in:

```text
metadata
```

Examples:

## Instagram

```js
{
  shortcode,
  mediaType,
  slideIndex,
  slideTotal,
  takenAt
}
```

## Facebook

```js
{
  photoId,
  albumId,
  collectionType,
  sourceTab
}
```

## Reddit

```js
{
  postId,
  subreddit,
  redditVideoId,
  redgifsId,
  galleryId,
  dashManifest
}
```

Core MUST NOT require these fields.

---

# 24. PlatformTarget

```ts
interface PlatformTarget {
  type:
    | "page"
    | "post"
    | "profile"
    | "album"
    | "collection"
    | "story"
    | "unknown";

  id?: string;
  name?: string;
  url?: string;

  metadata: Record<string, unknown>;
}
```

The target abstraction describes what the user is scanning.

---

# 25. ScanResult

```ts
interface ScanResult {
  platform: string;
  target: PlatformTarget;

  items: MediaItem[];

  hasMore?: boolean;
  nextCursor?: string;

  status:
    | "success"
    | "partial"
    | "empty"
    | "unsupported"
    | "authentication_required"
    | "rate_limited"
    | "network_failure"
    | "parse_failure"
    | "resolver_failure"
    | "cancelled";

  metadata: Record<string, unknown>;
}
```

An empty `items` array does not imply success.

---

# 26. Scan Semantics

Scanning is conceptually:

```text
Target
 ↓
Platform discovery
 ↓
Raw platform objects
 ↓
Normalization
 ↓
MediaItem[]
```

Core MUST consume normalized results.

Core MUST NOT parse platform HTML, GraphQL, JSON, or internal APIs.

---

# 27. Platform Plugin Contract

A plugin should implement:

```ts
interface PlatformPlugin {
  id: string;
  version: string;

  matches(context): boolean;

  initialize(context): Promise<void> | void;
  destroy(context): Promise<void> | void;

  getPlatformInfo(context): PlatformInfo;

  getCapabilities(context): PlatformCapabilities;

  validateEnvironment(context): Promise<HealthResult> | HealthResult;
  selfTest(context): Promise<HealthResult> | HealthResult;

  detectTarget(context): Promise<PlatformTarget | null>;

  getPageContext(context): Promise<PlatformPageContext>;

  scan(context, options): Promise<ScanResult>;

  scanTarget(
    context,
    target,
    options
  ): Promise<ScanResult>;

  normalize(rawItem, context):
    | MediaItem
    | MediaItem[]
    | null;

  resolveMedia?(
    item,
    context
  ): Promise<DownloadArtifact>;

  prepareDownload?(
    item,
    context
  ): Promise<DownloadArtifact>;

  getFilename?(
    item,
    context
  ): string;

  getArchivePath?(
    item,
    context
  ): string;

  getScanModes?(
    context
  ): ScanMode[];

  getFilters?(
    context
  ): FilterDefinition[];

  mountInPageUI?(
    context
  ): void | Promise<void>;

  diagnostics?: {
    collect(context): unknown;
    sanitize(data): unknown;
  };
}
```

Methods MAY be optional where capabilities make them unnecessary — in
practice, `initialize` / `destroy` / `getPlatformInfo` /
`validateEnvironment` / `selfTest` / `getPageContext` have no runtime caller
in the current build and are not implemented by the bundled plugins.

---

# 28. Plugin Context

Plugins receive dependencies through explicit context.

```ts
interface PluginContext {
  platform: PlatformContext;

  services: {
    downloader: DownloaderService;
    archive: ArchiveService;
    storage: StorageService;
    messaging: MessagingService;
    localization: LocalizationService;
    logger: Logger;
    diagnostics: DiagnosticsService;
  };
}
```
A plugin should not obtain arbitrary global state by side effect.

> **Status note (2026-08-29):** aspirational. No `PluginContext` is injected
> today; plugins are static classes consuming Core services by direct import,
> and no `StorageService` / `MessagingService` / `DiagnosticsService`
> instances exist. Implement or trim this section when the registry evolves.

---

# 29. Plugin Registry

```ts
interface PluginRegistry {
  register(plugin: PlatformPlugin): void;

  unregister(pluginId: string): void;

  get(pluginId: string): PlatformPlugin | undefined;

  list(): PlatformPlugin[];

  detect(context: PlatformContext): PlatformPlugin | null;
}
```

Built-in plugins are registered deterministically.

Example:

```js
registry.register(InstagramPlugin);
registry.register(FacebookPlugin);
registry.register(RedditPlugin);
```

---

# 30. Plugin Detection

Platform detection should occur through plugin-owned logic.

The Core asks the registry:

```text
What plugin matches this context?
```

The Core does not embed host-specific logic.

Plugins should consider:

- hostname;
- supported URL patterns;
- execution context;
- page state;
- platform-specific markers.

---

# 31. Capability System

Plugins declare capabilities.

Example:

```ts
interface PlatformCapabilities {
  scan: {
    page?: boolean;
    post?: boolean;
    profile?: boolean;
    collection?: boolean;
    pagination?: boolean;
  };

  media: {
    image?: boolean;
    gallery?: boolean;
    video?: boolean;
    audio?: boolean;
  };

  resolution: {
    direct?: boolean;
    custom?: boolean;
    background?: boolean;
  };

  download: {
    direct?: boolean;
    streamed?: boolean;
    generated?: boolean;
  };

  processing: {
    muxing?: boolean;
    transcoding?: boolean;
  };

  runtime: {
    mainWorld?: boolean;
    offscreen?: boolean;
  };
}
```

Capabilities control UI availability and execution paths.

---

# 32. Download Artifact Model

The Core MUST NOT assume that every media item corresponds to a directly downloadable URL.

Supported artifact types:

```text
direct
generated
pipeline
```

---

# 33. DirectArtifact

```ts
interface DirectArtifact {
  kind: "direct";

  source: {
    url: string;
    headers?: Record<string, string>;
  };

  output: {
    filename: string;
    mimeType?: string;
  };
}
```

---

# 34. GeneratedArtifact

```ts
interface GeneratedArtifact {
  kind: "generated";

  generator: string;
  inputs: unknown[];

  output: {
    filename: string;
    mimeType: string;
  };
}
```

---

# 35. PipelineArtifact

```ts
interface PipelineArtifact {
  kind: "pipeline";

  steps: ArtifactStep[];

  output: {
    filename: string;
    mimeType: string;
  };
}
```

Pipelines exist primarily for specialized workflows such as Reddit DASH media.

---

# 36. Download Flow

Generic flow:

```text
MediaItem
 ↓
Plugin resolution
 ↓
DownloadArtifact
 ↓
DownloadJob
 ↓
Queue
 ↓
Executor
 ↓
Output
```

The platform plugin owns resolution.

The Core owns execution.

---

# 37. Reddit Specialized Flow

Example:

```text
Reddit post
 ↓
DASH manifest
 ↓
video stream
 ↓
audio stream
 ↓
muxing
 ↓
final artifact
 ↓
DownloadJob
```

The Core must not know the details of DASH or RedGifs.

---

# 38. Downloader Service

```ts
interface DownloaderService {
  start(job: DownloadJob): Promise<DownloadHandle>;

  cancel(jobId: string): Promise<void>;

  getStatus(jobId: string): DownloadStatus;

  onProgress(listener): Unsubscribe;
}
```

Responsibilities:

- queueing;
- concurrency;
- retries;
- cancellation;
- progress;
- browser download API;
- job lifecycle.

---

# 39. Download Job

Conceptually:

```ts
interface DownloadJob {
  id: string;
  traceId?: string;

  item: MediaItem;
  artifact: DownloadArtifact;

  state:
    | "queued"
    | "resolving"
    | "downloading"
    | "processing"
    | "completed"
    | "failed"
    | "cancelled";

  progress?: ProgressInfo;

  createdAt: number;
}
```

Job state must be explicit.

---

# 40. Cancellation

Cancellation is a first-class operation.

Cancellation should propagate through:

```text
UI
 ↓
Core
 ↓
DownloadJob
 ↓
Plugin resolution/processing when applicable
 ↓
network/browser operation
```

A cancelled job must not be reported as successful.

---

# 41. Progress

Progress should distinguish stages when meaningful:

```text
scan
resolve
download
process
archive
complete
```

Do not report misleading percentages.

---

# 42. Concurrency

Concurrency is managed by Core.

Plugins may expose constraints or hints but should not independently create global queues.

Concurrency changes require regression consideration because they may affect:

- rate limiting;
- memory;
- reliability;
- browser resource usage;
- service-worker lifecycle.

---

# 43. Archive Service

ZIP generation is Core infrastructure.

```ts
interface ArchiveService {
  begin(options): Promise<ArchiveHandle>;

  add(
    archive: ArchiveHandle,
    entry: ArchiveEntry
  ): Promise<void>;

  finish(
    archive: ArchiveHandle
  ): Promise<ArchiveResult>;

  cancel(
    archive: ArchiveHandle
  ): Promise<void>;
}
```

Archive service MUST NOT contain platform-specific conditionals.

---

# 44. Archive Entry

```ts
interface ArchiveEntry {
  path: string;
  binary: Blob | ArrayBuffer | Uint8Array;
}
```

Archive paths may be generated using platform-provided naming context.

---

# 45. Large-File Handling

The system MUST NOT assume all files fit comfortably in memory.

When practical:

- prefer streaming/chunking;
- avoid unnecessary Base64 conversions;
- use Blob/ArrayBuffer/typed arrays deliberately;
- preserve proven large-file behavior;
- test large files separately.

Specialized large-file behavior may remain within a plugin.

---

# 46. Filename Service

```ts
interface FilenameService {
  sanitize(name: string): string;

  render(
    template: string,
    context: NamingContext
  ): string;

  resolvePath(
    item: MediaItem,
    context: NamingContext
  ): string;
}
```

Generic filesystem sanitization belongs to Core.

Platform-specific naming context belongs to plugins.

---

# 47. Path Safety

All generated paths must prevent:

- path traversal;
- absolute paths;
- drive prefixes;
- UNC paths;
- invalid filesystem characters;
- control characters;
- unsafe separators;
- reserved filenames.

Untrusted fields include:

- username;
- subreddit;
- title;
- caption;
- album name;
- post name;
- external IDs.

---

# 48. Duplicate Handling

Duplicate semantics should be explicit.

Platforms may define platform-specific identity rules.

Example:

```text
Reddit:
post ID + media identity
```

Core should only deduplicate using a contract if the semantics are generic.

Do not assume identical media identity logic across platforms.

---

# 49. Storage Service

Generic persistent storage is exposed through:

```ts
interface StorageService {
  get(namespace, key): Promise<unknown>;

  set(namespace, key, value): Promise<void>;

  remove(namespace, key): Promise<void>;

  clear(namespace): Promise<void>;
}
```

Use explicit namespaces:

```text
core.*
instagram.*
facebook.*
reddit.*
```

Plugins must not access other plugin namespaces.

---

# 50. Temporary Storage

Temporary data must be distinguished from durable configuration.

Examples:

```text
cache
intermediate blobs
temporary media
DASH fragments
diagnostics
HAR captures
```

Temporary data should have explicit lifecycle and cleanup behavior.

---

# 51. Reddit Storage

Reddit-specific IndexedDB and chunking may remain inside the Reddit plugin if the semantics are not generic.

Do not move such code to Core merely to eliminate apparent duplication.

---

# 52. Messaging

Messaging must use explicit structured envelopes.

Conceptually:

```ts
interface MessageEnvelope {
  type: string;

  requestId?: string;
  traceId?: string;

  pluginId?: string;

  payload?: unknown;
}
```

Messages must be validated.

---

# 53. Generic Message Types

Examples:

```text
SCAN_START
SCAN_PROGRESS
SCAN_COMPLETED
SCAN_FAILED

DOWNLOAD_START
DOWNLOAD_PROGRESS
DOWNLOAD_COMPLETED
DOWNLOAD_FAILED
DOWNLOAD_CANCELLED

GET_DOWNLOAD_STATE
CANCEL_DOWNLOAD
```

---

# 54. Platform Message Types

Platform-specific messages may exist as:

```text
INSTAGRAM_*
FACEBOOK_*
REDDIT_*
```

but should remain internal to the relevant plugin.

If a generic Core message can express the behavior, prefer the generic event.

---

# 55. Message Robustness

Handlers must account for:

- late messages;
- duplicate messages;
- stale messages;
- closed popup;
- navigation;
- plugin teardown;
- service-worker restart.

Use identifiers such as:

```text
traceId
requestId
scanId
jobId
pluginId
targetId
```

where appropriate.

---

# 56. State Management

The system should distinguish:

```text
Global Extension State
Platform State
Scan State
Selection State
Download State
UI State
Diagnostics State
```

Avoid one giant mutable global object.

---

# 57. UI Architecture

Core provides generic UI primitives.

Recommended:

```text
MediaGrid
MediaCard
SelectionBar
FilterBar
ScanControls
DownloadControls
ProgressPanel
TargetHeader
ErrorPanel
```

Plugins provide:

- scan modes;
- filters;
- platform-specific actions;
- target labels;
- optional specialized UI.

---

# 58. UI Capability Mapping

The UI should be generated from capabilities where possible.

For example:

```text
supportsStories
supportsDASH
supportsProfileScan
supportsPagination
```

should control relevant controls.

Do not use:

```text
if platform === "reddit"
```

to decide whether a generic control appears.

Use declared capabilities.

---

# 59. In-Page UI

Core owns:

- modal infrastructure;
- mounting lifecycle;
- generic selection;
- download controls;
- generic progress.

Plugin owns:

- page selectors;
- insertion location;
- platform-specific controls;
- platform target detection;
- custom page interactions.

---

# 60. Main World Bridge

The generic bridge may live in Core.

The actual page-context behavior must belong to the plugin.

For example:

```text
plugins/instagram/main-world/
plugins/facebook/main-world/
```

A main-world implementation must not leak platform-specific assumptions into Core.

---

# 61. Internationalization

Use the Chrome native i18n system.

Locales:

```text
_locales/
├── en/
└── pt_BR/
```

The manifest must declare the default locale appropriately.

Do not introduce another i18n framework unless a real limitation is demonstrated.

---

# 62. i18n Key Convention

Use prefixes:

```text
core_*
instagram_*
facebook_*
reddit_*
```

Examples:

```text
core_download
core_cancel
core_progress

instagram_scan_profile
instagram_scan_stories
instagram_scan_reels

facebook_scan_album
facebook_scan_photos

reddit_download_gallery
reddit_download_video
reddit_redgifs
```

---

# 63. i18n Validation

Provide:

```text
bun run check:i18n
```

The checker should validate:

- missing keys;
- malformed locale data;
- placeholder mismatches;
- stale keys where detectable;
- untranslated values where detectably identical;
- invalid message references.

---

# 64. Placeholder Preservation

Equivalent translated messages must preserve placeholders.

Example:

```text
Downloaded: $1 / $2
```

must preserve `$1` and `$2`.

Do not remove placeholders from translations.

---

# 65. Locale-Aware Layout

UI must tolerate:

- longer strings;
- shorter strings;
- different word order;
- plural differences;
- localization expansion.

Avoid fixed dimensions justified only by English content.

---

# 66. Accessibility

Generic UI SHOULD support:

- semantic controls;
- keyboard navigation;
- visible focus;
- accessible labels;
- proper button states;
- appropriate ARIA attributes where needed;
- status announcements where appropriate.

Platform-specific UI should follow the same standards.

Accessibility behavior should not depend on platform identity when the component is generic.

---

# 67. Logging

Create a centralized logging service.

API:

```text
debug()
info()
warn()
error()
```

Namespaces:

```text
core:download
core:archive
core:messaging
core:storage

instagram:scanner
instagram:graphql
instagram:resolver

facebook:scanner
facebook:graphql
facebook:resolver

reddit:parser
reddit:dash
reddit:redgifs
reddit:profile
```

---

# 68. Log Levels

At minimum:

```text
ERROR
WARN
INFO
DEBUG
TRACE
```

Production should use conservative logging.

Development may enable verbose logging.

---

# 69. Trace IDs

Major workflows should receive a trace ID.

A scan might be:

```text
trace=abc123
scan:start
request:start
request:end
normalize:start
normalize:end
items=17
download:plan
download:start
download:complete
```

Trace IDs should propagate through relevant services.

---

# 70. Diagnostics

Provide a developer-facing diagnostics system.

Diagnostics should expose, where relevant:

- detected platform;
- target;
- plugin;
- plugin version;
- capabilities;
- runtime context;
- scan state;
- item counts;
- active jobs;
- recent errors;
- trace IDs;
- storage status.

---

# 71. Diagnostic Export

Provide a sanitized diagnostic bundle containing things such as:

```text
environment.json
plugin-state.json
capabilities.json
recent-errors.json
logs.json
trace-summary.json
```

It MUST NOT include:

- cookies;
- passwords;
- authorization headers;
- access tokens;
- private media;
- session secrets;
- unnecessary personal identifiers.

---

# 72. Diagnostic Sanitization

Sanitization must be implemented as a dedicated component rather than ad-hoc string replacement.

Sensitive patterns should be handled systematically.

The sanitizer itself should have automated tests.

---

# 73. Plugin Health

Plugins SHOULD provide:

```text
validateEnvironment()
selfTest()
```

A health result may indicate:

```text
healthy
degraded
unsupported
authentication_required
network_unavailable
site_changed
```

Health state should be diagnostic information, not necessarily user-facing terminology.

---

# 74. Error Taxonomy

Generic errors:

```text
UnsupportedPlatformError
UnsupportedTargetError
AuthenticationRequiredError
RateLimitedError
NetworkError
ParseError
ResolverError
ProcessingError
StorageError
DownloadError
ArchiveError
CancellationError
```

Plugins may add specific codes:

```text
INSTAGRAM_GRAPHQL_SCHEMA_CHANGED
FACEBOOK_TARGET_NOT_FOUND
REDDIT_DASH_AUDIO_UNAVAILABLE
```

---

# 75. No Silent Failure

Avoid:

```js
catch {
  return [];
}
```

unless that is explicitly the correct semantic result.

A failure must be distinguishable from an empty successful scan.

---

# 76. Website Drift

Each platform plugin should isolate unstable elements:

```text
CSS selectors
URL patterns
GraphQL operations
API schemas
request interception
DOM assumptions
internal navigation
site-specific constants
```

Core must not know these details.

---

# 77. Reverse-Engineered Behavior

When behavior depends on undocumented platform internals, documentation should distinguish:

```text
Observed
Inferred
Assumed
Unknown
```

Do not present assumptions as facts.

---

# 78. Capture and Fixture Artifacts

HAR captures are first-class source evidence and test/debug artifacts. Routine
tests should consume compact, sanitized fixtures extracted from those captures
so that the normal validation path does not repeatedly parse multi-megabyte
account captures.

Directory:

```text
tests/fixtures/
├── instagram/
├── facebook/
└── reddit/
```

The default compact inputs live under:

```text
tests/fixtures/extracted/<platform>/
```

Fixtures may represent:

- network behavior;
- GraphQL;
- API responses;
- pagination;
- authentication conditions;
- media resolution;
- regression cases;
- failure scenarios.

Raw captures remain local evidence under `fixtures-private/`. They are replayed
explicitly for network/parser/tooling changes, while compact fixtures are the
versioned default inputs for unit, contract, integration, and routine CI tests.

---

# 79. Raw HAR Security

Raw HAR files must NOT be committed when they contain:

- cookies;
- authorization;
- tokens;
- personal information;
- private URLs;
- private media;
- session data.

Use:

```text
fixtures-private/
```

or another ignored location.

---

# 80. Capture Extraction and Sanitization

Provide tooling such as:

```text
bun run check:har
bun run har:report
bun run har:compare
bun run fixtures:extract
bun run check:fixtures
```

Extraction should use an explicit allowlist for fields required by the
production path and discard unrelated request/response data. Sanitization must
remove or replace secrets deterministically; a denylist alone is insufficient.
The compact-fixture validator must fail closed when it encounters sensitive
keys, secret-like values, executable markup, or unsafe source metadata.

Example:

```text
real username → example_user
real identifier → user_123
cookie → <REDACTED>
authorization → <REDACTED>
```

If sanitization cannot guarantee safety, it must fail.

---

# 81. Fixture Metadata

Every committed fixture should have metadata:

```json
{
  "fixtureVersion": 1,
  "fixtureType": "instagram-replay",
  "platform": "instagram",
  "scenario": "profile-pagination",
  "sourceCaptureId": "instagram-profile-v2",
  "extractionVersion": 1,
  "sanitizationVersion": 1,
  "capturedAt": "2026-08-27",
  "browser": "Chrome",
  "sanitized": true,
  "source": "manual-capture",
  "purpose": "Regression coverage for profile pagination"
}
```

---

# 82. Fixture Types and Default Test Inputs

Use more than HAR. Routine tests should consume the smallest versioned fixture
that exercises the behavior under test and must not require
`fixtures-private/`.

Supported conceptual fixture types:

```text
Network fixture
API JSON fixture
DOM/HTML fixture
Normalized-object fixture
```

Each layer should be testable independently where useful.

The normal relationship is:

```text
HAR source evidence
 ↓
allowlisted extraction + deterministic anonymization
 ↓
compact fixture
 ↓
real parser / normalizer / scanner / resolver path
```

---

# 83. Fixture Retention

Historical fixtures should not be deleted merely because the site changed.

A fixture may document:

- previous schema;
- a previous regression;
- compatibility behavior;
- a known failure.

When retiring a fixture, document why.

---

# 84. Platform Documentation

Each platform must have documentation covering:

```text
ARCHITECTURE.md
DETECTION.md
SCANNING.md
NETWORK.md
RESOLUTION.md
FIXTURES.md
DEBUGGING.md
KNOWN_LIMITATIONS.md
```

---

# 85. Architecture Documentation

The architecture documentation must include:

```text
overview.md
execution-contexts.md
plugin-system.md
data-model.md
download-pipeline.md
messaging.md
storage.md
dependency-rules.md
```

---

# 86. Architecture Decision Records

Use:

```text
docs/decisions/
```

for major decisions.

Recommended initial ADRs:

```text
ADR-001-core-plugin-architecture.md
ADR-002-independent-platform-plugins.md
ADR-003-meta-shared-boundary.md
ADR-004-download-artifact-model.md
ADR-005-native-i18n.md
ADR-006-browser-only-runtime.md
ADR-007-offscreen-zip-packager.md
ADR-008-jsdoc-type-safety.md
ADR-009-strangler-migration-strategy.md
ADR-010-wire-all-platforms.md
```

---

# 87. ADR Format

Each ADR should contain:

```text
# Title

## Status

## Context

## Decision

## Alternatives Considered

## Consequences
```

---

# 88. Platform Invariants

Each plugin must document invariants that must survive refactors.

## Instagram

Examples:

```text
carousel ordering
story ordering
highlight identity
pagination semantics
full-resolution media preference
```

## Facebook

Examples:

```text
album identity
collection identity
source-tab identity
multi-tab behavior
media ordering
```

## Reddit

Examples:

```text
gallery ordering
DASH audio/video association
muxing correctness
RedGifs resolution
duplicate handling
profile discovery
chunked transfer behavior
```

---

# 89. Regression Testing

Every significant platform bug should ideally become:

```text
reproduction
↓
fixture
↓
regression test
↓
fix
```

This should be the standard maintenance loop.

---

# 90. Core Tests

Core tests should cover:

- data models;
- job lifecycle;
- queue;
- cancellation;
- concurrency;
- retry;
- filename sanitization;
- archive paths;
- ZIP;
- progress;
- messaging;
- storage;
- diagnostics;
- i18n validation;
- manifest validation;
- dependency validation.

---

# 91. Contract Tests

Every plugin must satisfy common contract tests for:

- identity;
- matching;
- capability declaration;
- initialization;
- destruction;
- environment validation;
- target detection;
- normalization;
- scan result validity;
- error semantics;
- naming;
- archive paths;
- download planning;
- diagnostics sanitization.

---

# 92. Instagram Tests

At minimum:

```text
profile
posts
carousels
reels
stories
highlights
pagination
GraphQL normalization
CDN resolution
target detection
```

---

# 93. Facebook Tests

At minimum:

```text
profile
photos
albums
collections
multi-tab
navigation
network extraction
GraphQL normalization
CDN resolution
```

---

# 94. Reddit Tests

At minimum:

```text
image
gallery
video
DASH
audio
muxing
RedGifs
profile
deduplication
chunked transfer
cache behavior
```

---

# 95. Integration Tests

Where practical, test:

```text
Detection
 ↓
Scan
 ↓
Normalize
 ↓
Resolve
 ↓
Plan
 ↓
Download
 ↓
Process
 ↓
Package
 ↓
Complete
```

---

# 96. Live-Site Tests

Live-site tests may exist but must be clearly separated from deterministic fixture tests.

The normal test suite SHOULD NOT depend entirely on external websites.

External failures should be distinguishable from code failures.

---

# 97. Manifest Specification

The Manifest MUST remain consistent with:

- registered plugins;
- host permissions;
- content scripts;
- main-world resources;
- web-accessible resources;
- offscreen requirements;
- locales;
- service worker.

---

# 98. Permission Ownership

Every host permission must have:

```text
owner
purpose
feature
scope justification
```

Example:

```text
*.instagram.com
Owner: instagram
Purpose: scanning and resolution
```

---

# 99. Permission Principle

Do not:

- broaden permissions unnecessarily;
- merge manifests blindly;
- add a host because it makes a failed implementation easier;
- retain a permission with no documented use.

Permissions should be minimal and intentional.

---

# 100. Plugin Manifest Metadata

Plugins SHOULD expose metadata describing their runtime and permission needs.

Conceptually:

```js
{
  id: "instagram",

  hosts: [
    "*.instagram.com"
  ],

  capabilities: {},

  runtime: {
    contexts: [
      "content",
      "service-worker",
      "main-world"
    ]
  }
}
```

Tooling should validate this metadata against `manifest.json`.

---

# 100.1. Web-Accessible Resources Boundary

`web_accessible_resources` is the manifest key that controls which extension files are reachable from page-context JavaScript. A file that is **not** listed cannot be loaded via dynamic `import()` from a content script or page. This boundary is enforced by the browser, not by code review.

Two legitimate patterns exist in this extension:

1. **Main-world scripts injected into platform pages.** Example: `src/plugins/instagram/main-world/injected.js`, `src/plugins/facebook/main-world/injected.js`. These run inside the page's JavaScript context and MUST be web-accessible; the manifest's `content_scripts[].world: MAIN` entry is what installs them. They are platform-owned and isolated per plugin (manifest.json lines 28-50).

2. **Dynamic `import()` from the content script.** The Reddit content-script uses `await import(chrome.runtime.getURL('src/plugins/reddit/RedditScanner.js'))` to load the real Reddit plugin as a module from the classic (non-module) content script. That transitive dependency chain reaches `RedditNormalizer.js` → `MediaItem.js` and `FilenameService.js`, so those Core files must also be web-accessible. This is a **deliberate tradeoff**: it keeps the content script classic and lean while letting the plugin own the scanner/normalizer logic.

> Owners of resources exposed this way:
> - Plugin modules loaded via `import()` are owned by their plugin.
> - Core files exposed only to support a plugin's dynamic import are owned by Core, but the exposure itself MUST be justified by a content-script dynamic import in a committed code path. Unused Core exposure is a violation.
>
> Validation: every entry in `web_accessible_resources` MUST be reachable from a `chrome.runtime.getURL(...)` call site in the source tree. `bun run check:manifest` (and a future `bun run check:war`) verify the manifest is well-formed; a follow-up linter SHOULD cross-check the resource list against actual call sites.

---

# 101. Architecture Validation

Provide machine-checkable architecture validation.

At minimum detect:

```text
core → platform implementation
plugin A → plugin B
generic ZIP → platform names
generic download manager → platform-specific resolver
popup → platform internals
```

Architecture rules must not live only in documentation.

---

# 102. Dependency Graph

The intended dependency graph is:

```text
             ┌───────────────┐
             │     Core      │
             └───────┬───────┘
                     │
          ┌──────────┼──────────┐
          │          │          │
     Instagram   Facebook    Reddit
          │          │
          └────┬─────┘
               │
          Meta Shared
```

Actual dependency direction:

```text
Instagram → Core
Facebook → Core
Reddit → Core

Instagram → Meta Shared
Facebook → Meta Shared
```

not the reverse.

---

# 103. Plugin Internal Organization

Each plugin may use its own internal structure.

Recommended:

```text
plugins/<platform>/
├── plugin.js
├── detector.js
├── scanner/
├── normalizer/
├── resolver/
├── network/
├── content/
├── main-world/
├── ui/
├── tests/
└── README.md
```

This is a guideline, not a rigid requirement.

The platform's actual responsibilities should determine its internal decomposition.

---

# 104. Legacy Code

Legacy modules may remain temporarily.

Example:

```text
plugins/reddit/legacy/
```

or inside the plugin itself.

Legacy code should be wrapped by adapters where necessary.

Do not delete legacy code until replacement behavior is demonstrated.

---

# 105. Migration Strategy

Use the strangler pattern.

Sequence:

```text
Baseline
 ↓
Characterization tests
 ↓
Core contracts
 ↓
Plugin registry
 ↓
Instagram adapter
 ↓
Instagram verification
 ↓
Facebook adapter
 ↓
Facebook verification
 ↓
Reddit adapter
 ↓
Reddit verification
 ↓
Shared infrastructure extraction
 ↓
Cleanup
```

---

# 106. Migration Rules

Do not combine:

- architecture migration;
- parser rewrite;
- storage rewrite;
- UI rewrite;
- build-tool migration;
- TypeScript migration;
- permission redesign;

unless absolutely necessary.

Change one major axis at a time.

---

# 107. Behavior Preservation

Observable behavior includes:

- supported pages;
- target detection;
- media discovered;
- media ordering;
- filenames;
- directory layout;
- ZIP layout;
- download behavior;
- progress;
- cancellation;
- authentication;
- error semantics;
- UI behavior.

A refactor must preserve these unless the change is intentional and documented.

---

# 108. Abstraction Rule

An abstraction may be promoted to Core only when:

1. it is genuinely shared;
2. semantics match;
3. multiple platforms benefit;
4. platform-specific behavior is not lost;
5. the abstraction reduces coupling.

Do not abstract merely because two pieces of code look superficially similar.

---

# 109. Duplication Rule

A small amount of duplication is acceptable.

Prefer:

```text
correct duplicated code
```

over:

```text
incorrect universal abstraction
```

when semantics differ.

---

# 110. Performance

Optimization must be evidence-driven.

Important performance areas:

- DOM scanning;
- network parsing;
- memory usage;
- binary serialization;
- large downloads;
- ZIP generation;
- IndexedDB;
- service-worker communication.

Do not optimize purely for code brevity.

---

# 111. Large Media

The system should be tested with:

- small files;
- medium files;
- large files;
- many-file batches;
- large galleries.

Watch for:

- memory spikes;
- serialization cost;
- popup freezes;
- service-worker lifecycle issues;
- ZIP memory pressure.

---

# 112. Async and Lifecycle Safety

The extension operates under browser lifecycle constraints.

Do not assume:

```text
service worker remains alive forever
popup remains open
page never navigates
plugin remains initialized forever
```

Operations must survive or explicitly handle lifecycle transitions.

---

# 113. Plugin Lifecycle

Plugins should be able to:

```text
initialize
active
destroy
```

Cleanup must remove:

- observers;
- event listeners;
- timers;
- temporary UI;
- network hooks;
- pending tasks.

---

# 114. Navigation

Page navigation may invalidate:

- DOM references;
- target identity;
- scan context;
- plugin state;
- runtime bridges.

Plugins must respond to relevant navigation changes.

---

# 115. DOM Observers

When using observers:

- scope them narrowly;
- avoid duplicate registration;
- clean them up;
- avoid full-page rescans without reason.

---

# 116. Network Interception

Network interception must be:

- plugin-scoped;
- observable;
- defensive;
- documented;
- testable where practical.

Do not place platform-specific interception in Core.

---

# 117. Authentication

Authentication state should remain inside the owning platform plugin unless a truly generic browser authentication abstraction is required.

Never log credentials or tokens.

Authentication failures should become structured states such as:

```text
authentication_required
```

rather than silent empty results.

---

# 118. Rate Limiting

Plugins may detect platform rate limiting.

The Core may provide generic retry/backoff services.

Platform-specific rate-limit detection belongs to the plugin.

Do not retry indefinitely.

---

# 119. Retry Policy and Backoff Schedule

The Core provides generic retry/backoff. The plugin signals whether a given error is retryable. Backoff schedule (deterministic, no jitter for reproducibility):

| Class | Retryable? | Backoff | Max attempts |
|---|---|---|---|
| Network timeout | yes | 1s, 2s, 4s, 8s, 16s, 32s, 60s | 7 |
| HTTP 5xx | yes | 1s, 2s, 4s, 8s, 16s | 5 |
| HTTP 429 (rate limited) | yes | Honor `Retry-After` if present, else 1s, 2s, 4s, 8s, 16s, 60s | 6 |
| HTTP 4xx (other) | no | — | 1 |
| Authentication failure | no | — | 1 |
| Parse failure | no | — | 1 |
| Unsupported target | no | — | 1 |
| Plugin-declared retryable | yes | schedule above | per schedule |
| Plugin-declared non-retryable | no | — | 1 |

A retryable error that exhausts its budget MUST surface as a structured `ResolverError`/`ProcessingError` with the full attempt history attached (for diagnostics).

`bun run check:retry-policy` (when added) SHOULD verify that error classes respect this table.

---

# 120. Caching Policy

Caching semantics must be explicit.

A cache should define:

```text
owner
scope
lifetime
eviction
sensitivity
```

Do not merge platform-specific caches solely because both use IndexedDB.

---

# 121. Security Boundaries

Treat the following as security-sensitive:

- page content;
- injected code;
- main-world communication;
- cookies;
- tokens;
- headers;
- network traces;
- private media;
- internal platform responses.

Keep trust boundaries documented.

---

# 122. Content Security

Do not weaken CSP or introduce dynamic execution for convenience.

Avoid:

```text
eval
new Function
```

unless there is a compelling, documented technical requirement.

---

# 123. Untrusted Input

Platform data must be treated as untrusted input.

This applies to:

- titles;
- usernames;
- captions;
- subreddit names;
- album names;
- IDs;
- URLs;
- API-provided strings.

Escape appropriately for:

- HTML;
- attributes;
- filenames;
- paths;
- logs.

---

# 124. Logging Security

Logs must never include:

- authorization;
- cookies;
- passwords;
- access tokens;
- private media;
- private session state.

When debugging requests, log metadata rather than secrets.

---

# 125. Fixture Security

All fixture workflows must follow:

```text
Capture
 ↓
Sanitize
 ↓
Validate
 ↓
Commit
```

The same rule applies to extracted JSON, HTML, network, and normalized-object
fixtures. Sanitization must preserve relationships needed by the test while
removing original account identifiers, private URLs, credentials, cookies,
tokens, and personal data.

Never:

```text
Capture
 ↓
Commit
 ↓
sanitize later
```

---

# 126. Documentation Security

Do not put real credentials, private URLs, or sensitive network traces into documentation examples.

Use synthetic examples.

---

# 127. Configuration

Generic user configuration belongs in Core.

Platform-specific configuration belongs inside the plugin namespace.

Examples:

```text
core.download.concurrentJobs
core.naming.template
reddit.media.resolveRedGifs
instagram.scan.includeStories
```

Configuration should have explicit ownership.

---

# 128. Feature Flags

Feature flags MAY be used for unstable features.

A feature flag should have:

- owner;
- purpose;
- default;
- removal plan;
- documentation.

Do not accumulate permanent flags without maintenance.

---

# 129. Experimental Features

Experimental platform support may be isolated as a plugin capability.

Example:

```text
experimental:
  profileBanner: true
```

Experimental functionality should remain clearly marked in code and documentation.

---

# 130. Versioning

The extension has a product version.

Each plugin should also have a plugin version.

Diagnostic output should include both.

Changes to plugin behavior should be visible in platform documentation as appropriate.

---

# 131. Release Notes and Documentation

Release notes and documentation track meaningful user-facing changes in repository documentation.

Technical architectural changes may also be recorded in ADRs and architecture documents when they affect maintainability or plugin contracts.

---

# 132. README

README should include:

- project purpose;
- supported platforms;
- basic development setup;
- tests;
- architecture summary;
- plugin development overview;
- privacy/security note.

Do not place deep reverse-engineering details in README.

---

# 133. Contribution Model

Contributors adding a platform should provide:

```text
plugin
tests
fixtures when appropriate
documentation
permissions
localization
registration
```

A plugin should not be considered complete when only the scraper exists.

---

# 134. New Platform Checklist

Adding a new platform normally requires:

```text
src/plugins/<platform>/
tests/fixtures/extracted/<platform>/
docs/platforms/<platform>/
locale additions
manifest changes
plugin registration
contract tests
platform tests
```

It should reuse Core functionality rather than duplicate it.

---

# 135. New Capability Checklist

When a new platform requires a feature unavailable in Core:

1. verify the feature is genuinely generic;
2. determine whether an optional capability solves it;
3. only then modify Core;
4. update contracts;
5. update tests;
6. update documentation;
7. ensure existing plugins continue to pass.

---

# 136. Feature Matrix

Maintain a platform capability matrix.

Example:

| Capability | Instagram | Facebook | Reddit |
|---|---:|---:|---:|
| Profile scan | ✓ | ✓ | ✓ |
| Gallery | ✓ | ✓ | ✓ |
| Stories | ✓ | — | — |
| Highlights | ✓ | — | — |
| Albums | — | ✓ | — |
| Reels | ✓ | — | — |
| DASH | — | — | ✓ |
| RedGifs | — | — | ✓ |
| Muxing | — | — | ✓ |
| Pagination | ✓ | ✓ | ✓ |
| ZIP | Core | Core | Core |
| Queue | Core | Core | Core |
| Progress | Core | Core | Core |
| Cancellation | Core | Core | Core |

The matrix describes capabilities; it does not define implementation.

---

# 137. Testing Philosophy

Testing should answer three different questions:

```text
Does the Core work?
Does the plugin obey the contract?
Does the real platform behavior still work?
```

These correspond to:

```text
Core tests
Contract tests
Platform/regression tests
```

---

# 138. Deterministic Testing

Prefer deterministic fixtures.

Do not require the current live website to pass basic development tests.

Live tests may exist separately.

---

# 139. Test Data

Use synthetic test identities:

```text
example_user
example_subreddit
user_123
post_123
album_123
```

Never commit real accounts or real session captures.

---

# 140. Debugging Workflow

When a platform stops working:

```text
Identify plugin
 ↓
Identify target type
 ↓
Check plugin health
 ↓
Inspect logs
 ↓
Find trace ID
 ↓
Compare fixture behavior
 ↓
Capture HAR if necessary
 ↓
Sanitize HAR
 ↓
Reproduce offline
 ↓
Write regression
 ↓
Fix smallest responsible layer
```

Do not immediately rewrite the parser.

---

# 141. HAR Investigation

When network behavior is unclear:

```text
Real browser observation
 ↓
HAR capture
 ↓
Sanitization
 ↓
Relevant request identification
 ↓
Fixture
 ↓
Test
 ↓
Plugin change
```

Observed network behavior is preferred over assumptions.

---

# 142. Empty Scan Investigation

A scan that returns zero items should trigger consideration of:

```text
valid empty target
unsupported target
authentication failure
rate limiting
network failure
parser failure
site drift
```

Plugins should distinguish these states when practical.

---

# 143. Site Health Detection

A plugin may use:

- expected DOM markers;
- expected network requests;
- known schema signatures;
- feature probes;
- fixture comparisons;

to detect likely site changes.

Do not turn every unexpected state into a generic failure.

---

# 144. Browser Error Handling

Browser APIs may fail due to:

- navigation;
- revoked context;
- service-worker restart;
- permission errors;
- quota;
- memory;
- downloads being canceled externally.

These should map into structured internal states.

---

# 145. External API Failures

External site failures must be distinguished from code defects.

Where practical classify:

```text
4xx
5xx
network
timeout
authentication
rate-limit
schema
```

without exposing unnecessary details to the end user.

---

# 146. Documentation Freshness

Documentation MUST be updated when a change affects:

- architecture;
- plugin capabilities;
- runtime context;
- message contract;
- manifest;
- permissions;
- i18n;
- debugging;
- storage;
- fixture strategy.

Stale documentation is an architectural defect.

---

# 147. Source of Truth

For functionality:

```text
running implementation + tests
```

are the primary source of truth.

For architecture:

```text
SPECIFICATION.md
AGENTS.md
ADRs
```

define intended boundaries.

When implementation contradicts architecture, either:

1. fix the implementation; or
2. consciously update the architecture documentation.

Never leave the contradiction undocumented.

---

# 148. Code Review Principles

A change should be evaluated for:

```text
Correctness
Regression risk
Platform isolation
Contract stability
Security
Observability
Testing
Documentation
```

Code size alone is not a quality metric.

---

# 149. Architectural Smells

The following indicate possible architectural problems:

```text
Core imports plugin code
Core contains hostnames
Core contains CSS selectors
Core knows GraphQL IDs
ZIP code knows platform names
Downloader knows RedGifs
UI directly consumes GraphQL
Plugin imports another plugin
Generic utility requires one specific website
HAR contains credentials
Zero-result scans hide errors
Permissions have no owner
```

Investigate rather than normalizing these patterns.

---

# 150. Extensibility Requirement

A fourth platform must be implementable without rewriting existing plugins.

The expected change is approximately:

```text
new plugin
+
registration
+
permissions
+
documentation
+
tests
```

not:

```text
modify every Core service
modify Instagram
modify Facebook
modify Reddit
```

---

# 151. Stability Requirement

A fix to Instagram should normally modify only:

```text
Instagram plugin
Meta Shared if genuinely shared
related tests
related fixtures
related documentation
```

A fix to Facebook should behave similarly.

A fix to Reddit should not require modifications to Instagram or Facebook.

A Core bug should be tested against all plugins.

---

# 152. Core Contract Stability

Core contracts should evolve slowly.

Before changing a contract:

1. identify the limitation;
2. assess optional capability;
3. determine compatibility impact;
4. update contract tests;
5. update affected plugins;
6. document the decision.

---

# 153. Backward Compatibility During Migration

Temporary compatibility adapters are permitted.

Examples:

```text
Legacy scanner
Legacy parser
Legacy downloader
Legacy UI adapter
```

Adapters exist to reduce risk.

They should be removed only after migration is proven.

---

# 154. Cleanup Rule

Do not remove duplication until:

- both implementations are stable;
- tests cover behavior;
- contracts are established;
- runtime verification is complete.

Optimization comes after correctness.

---

# 155. Production Build

The production artifact should contain only what is necessary for the extension.

It must not contain:

- raw HAR captures;
- private diagnostics;
- test credentials;
- fixture-private content;
- development-only server code;
- Node/Bun runtime components.

Development-only data MUST live under sibling, Git-ignored directories outside the source tree:

```text
fixtures-private/
diagnostics-private/
downloads-test/
```

See **§156 (Development Artifacts)** for the full separation rules.

---

# 156. Development Artifacts

Keep development-only data separated from source:

```text
fixtures-private/
diagnostics-private/
downloads-test/
```

These should be ignored by Git.

---

# 157. Reproducibility

Lock dependencies.

Use deterministic fixtures.

Avoid depending on mutable remote development assets when possible.

The canonical development environment should produce repeatable results.

---

# 158. Dependency Policy

Before adding a dependency:

1. determine whether native APIs suffice;
2. check existing dependencies;
3. assess maintenance;
4. assess bundle/runtime implications;
5. assess CSP;
6. document the justification.

A dependency is not justified merely because it reduces several lines of code.

---

# 159. Vendor Policy

Existing vendor dependencies should not be replaced without evidence.

Before replacing:

- inspect consumers;
- compare behavior;
- check licensing;
- test;
- document.

---

# 160. Browser Compatibility

Code executed in the extension runtime must use browser-compatible APIs only.

Tooling code may use Node APIs, but it must remain outside production runtime boundaries.

---

# 161. Observability Requirement

Every important operation should be diagnosable through some combination of:

```text
logs
trace IDs
structured errors
diagnostics
fixtures
```

A failure that cannot be distinguished or reproduced is considered an engineering weakness.

---

# 162. Data Flow

Canonical generic flow:

```text
Browser Page
     ↓
Platform Detection
     ↓
Plugin
     ↓
Platform Discovery
     ↓
Normalization
     ↓
MediaItem
     ↓
Resolution
     ↓
DownloadArtifact
     ↓
DownloadJob
     ↓
Queue
     ↓
Download / Processing
     ↓
Archive / Folder
     ↓
Completion
```

---

# 163. Platform Data Flow

Example Instagram:

```text
Instagram page
 ↓
Instagram plugin
 ↓
GraphQL / DOM / network
 ↓
Instagram normalizer
 ↓
MediaItem
 ↓
Instagram resolver
 ↓
DownloadArtifact
 ↓
Core downloader
```

Example Facebook:

```text
Facebook page
 ↓
Facebook plugin
 ↓
Facebook network/navigation
 ↓
Facebook normalizer
 ↓
MediaItem
 ↓
Facebook resolver
 ↓
Core downloader
```

Example Reddit:

```text
Reddit page
 ↓
Reddit plugin
 ↓
Reddit parser/network
 ↓
MediaItem
 ↓
DASH/RedGifs resolver
 ↓
processing pipeline
 ↓
DownloadArtifact
 ↓
Core downloader
```

---

# 164. Core/Plugin Boundary

The strongest architectural boundary is:

```text
Plugin
   ↓
MediaItem
   ↓
DownloadArtifact
   ↓
Core
```

Core must not consume raw:

```text
DOM
GraphQL
Reddit JSON
network responses
site-specific objects
```

---

# 165. UI/Core Boundary

UI consumes:

```text
MediaItem
ScanResult
Capabilities
DownloadState
DiagnosticsState
```

It should not consume:

```text
GraphQL payloads
DOM nodes
platform API objects
```

---

# 166. Archive/Core Boundary

Archive service consumes:

```text
ArchiveEntry
```

and knows nothing about the source platform.

---

# 167. Storage/Core Boundary

Storage service knows:

```text
namespace
key
value
```

but not what those values mean semantically.

---

# 168. Logging/Core Boundary

Logger receives structured events.

Plugins can attach platform namespace.

Sensitive-data filtering must happen before logs leave their owning context when necessary.

---

# 169. Security Review for Platform Changes

Any new platform integration involving:

- main world;
- content injection;
- network interception;
- elevated permissions;
- session handling;
- storage;

must review:

```text
trust boundary
data exposure
permission scope
logging
diagnostics
sanitization
```

---

# 170. Performance Review

Changes affecting large media should consider:

```text
memory
CPU
serialization
browser responsiveness
storage
download throughput
```

A solution that is theoretically elegant but causes large downloads to exhaust memory is not acceptable.

---

# 171. Failure-First Design

The system should explicitly represent failures.

Examples:

```text
unsupported target
authentication required
site changed
rate limited
network unavailable
media unavailable
processing failed
download failed
archive failed
```

Do not hide failures under:

```text
[]
null
false
```

without semantic context.

---

# 172. User Experience of Errors

End-user error messages should be concise and useful.

Developer diagnostics may show:

```text
platform
plugin
trace ID
error code
technical diagnostics
```

Never expose secrets simply because the user enabled debug mode.

---

# 173. Debug Mode Security

Debug mode is not permission to log everything.

Even verbose mode must preserve:

```text
credential confidentiality
session confidentiality
private media confidentiality
```

---

# 174. Plugin Documentation Standard

Every plugin's documentation should answer:

```text
What does it detect?
What targets does it support?
What contexts does it use?
How does it discover media?
How does it resolve media?
What authentication assumptions exist?
What fixtures exist?
How do I debug it?
What are the known limitations?
```

---

# 175. Onboarding New Maintainers

A new maintainer should be able to understand:

```text
overall architecture
plugin contract
Core responsibilities
runtime contexts
test strategy
fixture workflow
debugging workflow
```

without reading all platform implementations.

---

---

## Agent process, invariants & verification (see AGENTS.md)

The previous numbering §176–§182 (Agent Compatibility, Agent Modification Rule, Agent Migration Rule, Agent Abstraction Rule, Agent Directory Rule, Agent Documentation Rule, Definition of Done) was deliberately relocated to **[AGENTS.md](AGENTS.md)** in commit `b07a587` ("docs: split ownership between AGENTS.md and SPECIFICATION.md"), which split agent-facing process from the system blueprint. The corresponding sections in AGENTS.md own that material; this specification is the *system blueprint*: it describes the intended architecture, contracts, and boundary rules, not how autonomous agents should work on the repository.

See AGENTS.md for:

- inspecting before editing (`# 80. Search Before Editing`);
- migration / debugging / HAR workflows;
- manual browser verification and the definition of done;
- agent handoff, TODOs, and the priority order for ambiguous changes.


# 176. Final Architectural Diagram

The intended final architecture is:

```text
                         SOCIAL MEDIA DOWNLOADER
                                  │
                    ┌─────────────┴─────────────┐
                    │                           │
                   CORE                       PLUGINS
                    │                           │
        ┌───────────┼────────────┐       ┌──────┼──────┐
        │           │            │       │      │      │
    Download       ZIP          UI   Instagram Facebook Reddit
      Engine      Engine       Engine      │       │       │
        │           │            │         │       │       │
        └───────────┴────────────┘         │       │       │
                    │                      └───┬───┘       │
              Stable Contracts                │            │
                    │                     Meta Shared      │
                    │                          │            │
                    └───────────────┬──────────┴────────────┘
                                    │
                              Browser Runtime
                       ┌────────────┼────────────┐
                       │            │            │
                     Popup       Content        SW
                                    │
                               Main World
                               when needed
                                    │
                              Offscreen
                              when needed
```

---

# 177. Ultimate Principles

The architecture MUST preserve these principles:

```text
1. Instagram, Facebook and Reddit are independent plugins.

2. Shared Meta code is not automatically Core code.

3. Core owns generic workflows, not website knowledge.

4. Plugins own website knowledge.

5. MediaItem is the main discovery boundary.

6. DownloadArtifact is the main resolution boundary.

7. DownloadJob is the main execution boundary.

8. ZIP is generic infrastructure.

9. UI is generic infrastructure with platform capability extensions.

10. Captured-network evidence and compact extracted fixtures are first-class
    regression/debugging artifacts.

11. Raw HAR data is sensitive and must be sanitized.

12. Diagnostics must be useful without leaking secrets.

13. i18n is centralized and validated.

14. Manifest permissions must have explicit ownership.

15. Architectural dependencies must be machine-checkable.

16. Platform drift must be isolated inside plugins.

17. Empty scans must not silently hide failures.

18. Large-file behavior must be treated as a first-class concern.

19. Node/Bun are development tools, never production runtime dependencies.

20. Native browser JavaScript is the default runtime strategy.

21. Small duplication is preferable to incorrect abstraction.

22. Refactoring must be incremental and regression-first.

23. Working platform behavior takes precedence over architectural aesthetics.

24. New capabilities should enter Core only when genuinely cross-platform.

25. A new platform should be addable without rewriting existing platforms.
```

---

# 178. Ultimate Success Criterion

The architecture is successful when the following statements are simultaneously true:

```text
I can fix Instagram without touching Reddit.

I can fix Reddit without touching Facebook.

I can fix ZIP without knowing what Reddit is.

I can change the generic UI without understanding GraphQL.

I can add a new platform without copying the download engine.

I can reproduce a platform bug from a sanitized fixture.

I can diagnose a failure using logs and a trace ID.

I can understand a plugin without reading unrelated plugins.

I can run the shipped extension without Node or Bun.

An autonomous agent can modify the repository without having to rediscover its architecture from scratch.
```

The final invariant is:

```text
                 PLATFORM QUIRKS
                       │
                       ▼
                  PLATFORM PLUGIN
                       │
                 normalized data
                       │
                       ▼
                 CORE CONTRACT
                       │
          ┌────────────┼────────────┐
          ▼            ▼            ▼
       Download        ZIP          UI
         Queue        Engine       State
```

The system must never reverse this dependency.

**Social Media Downloader is not a generic scraper with three sets of selectors.**

It is a **generic media-downloading application with independently implemented platform adapters**.
