# AGENTS.md

# Social Media Downloader — Agent Instructions

This file defines the engineering rules, architectural constraints, development workflow, safety requirements, and behavioral invariants that MUST be followed by autonomous coding agents working on this repository.

Read this file before modifying any source file.


---

## Division of Ownership

This file (**AGENTS.md**) is the `agent-facing` rulebook: process, invariants, verification, workflows, and the priority order for decision-making. The physical system blueprint — design goals, domain models, contracts, artifact types, flows, and boundary conventions — lives in **[SPECIFICATION.md](SPECIFICATION.md)**.

> The architecture rules are stated **once**. Where a system rule is needed here, this file points to the single source of truth in `SPECIFICATION.md` rather than restating it; do not edit the same rule in both files.


---

# 1. Project Mission

This repository contains **Social Media Downloader**, a modular Chrome Manifest V3 browser extension for discovering, resolving, downloading, and packaging media from supported social platforms.

The current first-class platforms are:

- Instagram
- Facebook
- Reddit

The architecture is intentionally plugin-based.

The project exists to:

- preserve existing platform functionality;
- centralize generic extension infrastructure;
- isolate platform-specific behavior;
- make platform failures diagnosable;
- support incremental maintenance;
- make new platforms easy to add;
- minimize regressions caused by automated refactoring.

The primary engineering principle is:

> Merge infrastructure, not platform behavior.

---

# 2. Most Important Rule

Do not break working platform behavior in order to make the architecture look cleaner.

When choosing between:

```text
cleaner abstraction
```

and:

```text
preserved behavior
```

prefer preserved behavior unless behavioral equivalence has been demonstrated.

A platform implementation may be ugly, duplicated, complicated, or highly specialized.

That is acceptable if the behavior is required.

---

# 2A. Mandatory HAR Validation Gate

Every change MUST be validated against the available sanitized HAR captures before it is considered complete.
This applies to code, tests, tooling, manifest changes, documentation that describes observed platform behavior,
and refactors. A change that does not alter runtime behavior still runs the HAR replay gate as a regression check.

The minimum gate is:

```bash
bun run validate:local
bun tests/integration/har-replay.test.js
bun tests/integration/har-replay-platforms.test.js
```

The replay tests MUST execute the real parser, normalizer, resolver, scanner, or content-script path affected by
the change against the relevant HAR files in `fixtures-private/`. Do not replace replay with a hand-written object
that merely resembles a captured response.

For a platform or network change:

1. identify the relevant HAR and the request/response shape it covers;
2. replay the baseline before editing when the fixture is available;
3. make the smallest change;
4. replay the same HAR after editing;
5. compare item count, IDs, media URLs, dimensions, filenames/archive paths, ordering, and error behavior as
   applicable;
6. add or update a sanitized HAR regression fixture when the existing captures do not cover the changed behavior;
7. record the fixture, scenario, command, and result in the change notes or audit documentation.

If the relevant HAR is unavailable, do not claim validation. Capture it from a real browser, sanitize it, and keep
the raw capture only under the ignored `fixtures-private/` directory. If capture is impossible, stop before
declaring the change complete and report the missing evidence.

The HAR gate is evidence of compatibility, not permission to preserve a bug. If the intended behavior changes,
document that intent and update the expected regression assertions explicitly.

---

# 3. First-Class Platform Model

Instagram, Facebook, and Reddit are independent plugins.

The architecture MUST remain:

```text
src/plugins/
├── instagram/
├── facebook/
└── reddit/
```

Do NOT combine Instagram and Facebook into a single `MetaPlugin`.

They may share implementation details through:

```text
src/plugins/meta-shared/
```

only when the shared implementation is genuinely reusable and semantically correct for both platforms.

Platform ownership:

```text
Instagram
→ InstagramPlugin

Facebook
→ FacebookPlugin

Reddit
→ RedditPlugin
```

Shared Meta implementation:

```text
InstagramPlugin ─┐
                  ├── meta-shared
FacebookPlugin ──┘
```

Core:

```text
Core → no Meta knowledge
Core → no Reddit knowledge
```

---

# 4. Architectural Layers

The repository is organized into these conceptual layers:

```text
Core
Plugins
Runtime
Tests
Documentation
Tooling
```

Expected source structure:

```text
src/
├── core/
├── plugins/
│   ├── instagram/
│   ├── facebook/
│   ├── reddit/
│   └── meta-shared/
├── background/
├── content/
├── offscreen/
└── popup/
```

Core is platform-agnostic.

Plugins are platform-aware.

Runtime connects browser execution contexts to Core and plugins.

---

# 5. Core Responsibilities

Core owns generic functionality such as: application orchestration, media model, scan model, download jobs, queues, concurrency, cancellation, retry policy, progress, generic storage, generic messaging, ZIP generation, archive handling, filename sanitization, generic path handling, generic UI, localization infrastructure, diagnostics, logging, plugin registration, and capability handling.

Core MUST NOT contain platform-specific behavior.

> Canonical list and ownership rules: **SPECIFICATION.md §17 (Core Responsibilities)**, **§19 (Core Dependency Rule)**, and **§21 (Platform Conditionals)**. This summary exists only as an agent-facing reminder.

---

# 6. Plugin Responsibilities

Plugins own platform-specific behavior such as: platform detection, DOM inspection, target detection, platform navigation, selectors, platform API usage, GraphQL operations, internal web application behavior, network interception, platform authentication behavior, media discovery, platform-specific media resolution, platform-specific processing, platform-specific naming context, platform-specific UI insertion, and platform-specific error conditions.

A plugin may be internally complex. Complexity inside a plugin is preferable to leaking platform-specific behavior into Core.

> Canonical list: **SPECIFICATION.md §18 (Plugin Responsibilities)**, **§20 (Plugin Dependency Rule)**, and **§54 (Platform Message Types)**.

---

# 7. Forbidden Core Dependencies

Core MUST NOT import or otherwise directly depend on `src/plugins/instagram/`, `src/plugins/facebook/`, or `src/plugins/reddit/`. Core MUST NOT contain knowledge of Instagram selectors, Facebook selectors, Reddit selectors, Instagram GraphQL operation names, Facebook GraphQL operation names, Reddit API schemas, Reddit DASH, RedGifs, Instagram stories, Instagram highlights, Facebook albums, Facebook multi-tab behavior, subreddit semantics, or Meta-specific session internals. If Core requires such knowledge, the abstraction boundary is probably wrong.

> Canonical rule: **SPECIFICATION.md §19 (Core Dependency Rule)**. Detected mechanically by `bun run check:dependencies`.

---

# 8. Forbidden Plugin Dependencies

A platform plugin MUST NOT import another platform plugin. Forbidden: `instagram → facebook`, `facebook → instagram`, `reddit → instagram`, `reddit → facebook`. Plugins may depend on Core interfaces, Core services, and `meta-shared` (when applicable). Plugins must not directly mutate global Core state.

> Canonical rule: **SPECIFICATION.md §20 (Plugin Dependency Rule)**. Detected mechanically by `bun run check:dependencies`.

---

# 9. Dependency Direction

Allowed: Plugin ↓ Core. Content ↓ Core. Runtime ↓ Core. Plugin ↓ Core. Instagram ↓ meta-shared. Facebook ↓ meta-shared.

Forbidden: Core ↓ Plugin implementation. The Core may work with plugin interfaces/registry abstractions, but should not directly import platform implementations merely to implement generic behavior.

> Canonical diagram: **SPECIFICATION.md §9 (Repository Structure)**, **§102 (Dependency Graph)**, and **§164 (Core/Plugin Boundary)**.

---

# 10. Do Not Use Platform Conditionals in Core

Platform-specific branching in Core is prohibited. Use plugin registry, capabilities, interfaces, and dependency injection instead. Especially forbidden in: download manager, ZIP service, queue, generic UI, generic storage, messaging, filename engine, progress management.

> Canonical rule: **SPECIFICATION.md §21 (Platform Conditionals)** and **§58 (UI Capability Mapping)**.

---

# 11. Plugin Contract

Plugins should conform to the established platform contract. The PlatformPlugin contract is canonically defined in **SPECIFICATION.md §27 (Platform Plugin Contract)**. Plugins MAY implement only the methods required by their capabilities; not every method must be implemented by every plugin. Optional functionality should be represented through capabilities.

Do not infer capabilities from the plugin ID — use declared capabilities (see SPEC §31, AGENTS §12).

---

# 12. Capability-Based Design

Prefer capability declarations over platform-specific branching. PlatformCapabilities schema is defined in **SPECIFICATION.md §31 (Capability System)**. Capabilities control UI availability and execution paths.

Do not infer capabilities from the plugin ID.

---

# 13. Canonical Media Model

The boundary between platform discovery and generic application behavior is the normalized `MediaItem` model. Generic properties live at the top level; platform-specific ones live in `metadata`. Do not discard platform-specific information merely to make objects look identical.

> The full field list and field-ownership rules are specified in **SPECIFICATION.md §22 (Domain Model: MediaItem)** and **§23 (MediaItem Metadata)**.

---

# 14. Platform Metadata

Platform-specific fields (Instagram `shortcode`/`mediaType`/`slideIndex`; Facebook `photoId`/`albumId`/`collectionType`; Reddit `postId`/`subreddit`/`redgifsId`/`dashManifest`, ...) live in `MediaItem.metadata`.

Core MUST NOT depend on these platform-specific fields.

> Example per-platform metadata is specified in **SPECIFICATION.md §23 (MediaItem Metadata)**.

---

# 15. Download Artifact Model

Do not assume all media is represented by a direct URL. The system supports `direct`, `generated`, and `pipeline` artifacts; a pipeline may run `resolve video → resolve audio → process → produce final artifact` (especially for Reddit).

> The artifact shapes (DirectArtifact / GeneratedArtifact / PipelineArtifact) and the flow are specified in **SPECIFICATION.md §32–§35**.

---

# 16. Reddit-Specific Preservation

Do not rewrite Reddit's specialized pipeline simply to make it resemble other platforms.

Preserve existing behavior involving:

- image resolution;
- galleries;
- Reddit videos;
- DASH;
- audio/video pairing;
- muxing;
- RedGifs;
- profile scanning;
- dual-layer profile discovery;
- repost/cross-post deduplication;
- subreddit handling;
- chunked transfer;
- IndexedDB temporary storage.

Reddit-specific complexity belongs in the Reddit plugin or its dedicated services.

---

# 17. Instagram-Specific Preservation

Preserve:

- Instagram profile scanning;
- posts;
- carousels;
- reels;
- stories;
- highlights;
- profile pictures;
- pagination;
- GraphQL extraction;
- CDN resolution;
- target detection;
- platform-specific naming;
- relevant in-page behavior;
- main-world integration where required.

Do not replace working extraction with a generic scraper merely to satisfy architectural symmetry.

---

# 18. Facebook-Specific Preservation

Preserve:

- profile scanning;
- photos;
- albums;
- collections;
- source-tab identity;
- multi-tab behavior;
- platform navigation;
- Facebook-specific GraphQL/network extraction;
- CDN resolution;
- platform-specific naming;
- relevant in-page behavior.

Facebook MUST remain an independent plugin.

---

# 19. Shared Meta Code

Before placing code in:

```text
src/plugins/meta-shared/
```

ask:

1. Is it genuinely shared?
2. Does it have identical semantics?
3. Is it independently useful to both Instagram and Facebook?
4. Would the abstraction force one platform into the other's model?

If the final answer is yes to the last question:

DO NOT share the code.

Small duplicated code is preferable to incorrect shared abstractions.

---

# 20. Execution Contexts

Respect browser execution boundaries (Popup, Content Script, Service Worker, Offscreen Document, Main World). See **SPECIFICATION.md §11 (Runtime Environments)** and **§12 (Runtime Context Responsibilities)** for the canonical ownership map per context. Before moving code between contexts, verify DOM availability, Chrome API availability, lifecycle, storage, messaging, permissions, network, and security constraints.

---

# 21. Main World

Main-world code is platform-specific (e.g. `plugins/instagram/main-world/`, `plugins/facebook/main-world/`). Do not place platform-specific internal-web-app behavior in Core. Core may provide a generic bridge that must not embed platform-specific knowledge.

> The bridge contract is specified in **SPECIFICATION.md §60 (Main World Bridge)**.

---

# 22. Service Worker / Background

The service worker should orchestrate application behavior (initialize runtime/registry, route messages, manage jobs, coordinate downloads and generic services) rather than becoming a giant platform router (`if Instagram... if Facebook...`).

> The service-worker responsibilities are specified in **SPECIFICATION.md §12 (Runtime Context Responsibilities)**.

---

# 23. Offscreen

Offscreen code should be platform-agnostic unless there is a documented platform-specific requirement (ZIP, blob operations, DOM-like processing, and browser work unavailable in the service worker). Do not add platform selectors or platform APIs to generic offscreen services.

> See **SPECIFICATION.md §12 (Runtime Context Responsibilities)**.

---

# 24. Popup and UI

Generic UI belongs in Core. Plugins may define scan modes, filters, platform-specific actions, target info, and optional custom UI. Do not duplicate entire popup implementations per platform or force radically different workflows into one fake generic UI.

> The component list and UI architecture are specified in **SPECIFICATION.md §57 (UI Architecture)**.

---

# 25. In-Page UI

Core owns generic mounting, modal infrastructure, selection, generic controls, progress, and download controls. Plugins own insertion points, selectors, platform buttons, platform-specific interactions, and page detection.

> The interface is specified in **SPECIFICATION.md §59 (In-Page UI)**.

---

# 26. State Management

Maintain distinct state domains (Global Extension State, Platform State, Scan State, Selection State, Download Job State, UI State, Diagnostics State). Plugins should communicate through services/events rather than mutating unrelated state directly. Avoid arbitrary global mutable objects.

> The state model is specified in **SPECIFICATION.md §56 (State Management)**.

---

# 27. Messaging

Prefer platform-neutral messages; namespace platform-specific ones clearly (`INSTAGRAM_*`, `FACEBOOK_*`, `REDDIT_*`). Do not use platform-specific messages when a generic event is sufficient.

> The message types and robustness rules are specified in **SPECIFICATION.md §52–§55 (Messaging / Generic & Platform Message Types / Message Robustness)**.

---

# 28. Error Semantics

Do not silently swallow errors.

Forbidden:

```js
try {
  ...
} catch {
  return [];
}
```

unless an empty result is explicitly the correct semantic outcome.

Prefer typed/structured failure states.

Examples:

```text
unsupported
empty
success
partial
authentication_required
rate_limited
network_failure
parse_failure
resolver_failure
processing_failure
cancelled
```

An empty result is not automatically a successful result.

---

# 29. Error Classification

Use stable generic error categories (`UnsupportedPlatformError`, `UnsupportedTargetError`, `AuthenticationRequiredError`, `RateLimitedError`, `NetworkError`, `ParseError`, `ResolverError`, `ProcessingError`, `StorageError`, `DownloadError`, `ArchiveError`, `CancellationError`). Plugins may add platform-specific error codes (e.g. `REDDIT_DASH_AUDIO_UNAVAILABLE`).

> The full error taxonomy is specified in **SPECIFICATION.md §74 (Error Taxonomy)**.

---

# 30. Site Drift

Assume supported websites will change.

Keep unstable behavior isolated:

```text
CSS selectors
URL patterns
GraphQL operations
API schemas
network interception
DOM assumptions
internal navigation
platform constants
```

Do not spread these details throughout Core.

---

# 31. Zero-Result Detection

Do not assume:

```js
items.length === 0
```

means the scan succeeded.

Possible causes include:

- broken selector;
- changed API;
- expired authentication;
- rate limit;
- wrong page;
- unsupported target;
- network failure.

Where practical, plugins should detect suspicious empty results.

---

# 32. Plugin Health

Plugins should implement:

```text
validateEnvironment()
selfTest()
```

where practical.

Example:

```text
host detected
runtime available
expected page context found
required bridge active
resolver available
```

The goal is quick diagnosis when a website changes.

---

# 33. Logging

Do not use uncontrolled debugging output; use centralized logging (`logger.debug/info/warn/error`) with namespaced loggers (`core:download`, `instagram:scanner`, `reddit:dash`, ...).

> The logging model is specified in **SPECIFICATION.md §67 (Logging)**.

---

# 34. Log Levels

Support ERROR/WARN/INFO/DEBUG/TRACE. Production uses conservative logging. Never log cookies, passwords, authorization headers, access tokens, private media, or session identifiers.

> See **SPECIFICATION.md §68 (Log Levels)**.

---

# 35. Trace IDs

Major workflows should carry a trace ID, propagated through plugin calls, service calls, messaging, downloads, and diagnostics.

> The trace model is specified in **SPECIFICATION.md §69 (Trace IDs)**.

---

# 36. Diagnostics

A developer diagnostics interface should expose, where practical: detected platform, current target, plugin ID/version, capabilities, execution context, scan/download state, item count, download queue, active jobs, recent errors, trace IDs, and storage state. Diagnostics are developer tooling and must not leak secrets.

> The diagnostics surface is specified in **SPECIFICATION.md §70 (Diagnostics)**.

---

# 37. Diagnostic Export

Diagnostic exports must be sanitized. Acceptable: environment, browser/extension versions, plugin versions, capabilities, error codes, trace summaries, sanitized logs. Never export cookies, authorization headers, tokens, passwords, private account data/URLs/media. The sanitizer itself should be tested.

> See **SPECIFICATION.md §71 (Diagnostic Export)**.

---

# 38. HAR Fixtures

HAR captures are first-class development and regression artifacts.

Use:

```text
tests/fixtures/
├── instagram/
├── facebook/
└── reddit/
```

Fixtures may represent:

- GraphQL;
- API responses;
- pagination;
- network behavior;
- media resolution;
- authentication-related behavior;
- known regressions;
- failure states.

---

# 39. HAR Security

Raw HAR files containing sensitive information MUST NOT be committed.

Sensitive information includes:

- cookies;
- authorization;
- tokens;
- session identifiers;
- personal data;
- private URLs;
- private media.

Use a local ignored directory such as:

```text
fixtures-private/
```

for unsanitized captures.

---

# 40. HAR Sanitization

Use a deterministic sanitization process.

Example:

```text
real username → example_user
real ID → user_123
cookie → <REDACTED>
authorization → <REDACTED>
private token → <REDACTED>
```

Sanitization must fail safely rather than silently leaving unknown secrets behind.

---

# 41. Fixture Types

Do not rely only on HAR.

Use:

```text
Network fixtures
API JSON fixtures
DOM/HTML fixtures
Normalized object fixtures
```

Test individual layers independently where useful.

For example:

```text
HAR
↓
network extraction
↓
normalization
↓
MediaItem
```

and:

```text
HTML
↓
DOM scanner
↓
MediaItem
```

---

# 42. Fixture Metadata

Fixtures should document:

- platform;
- scenario;
- capture date;
- browser;
- source;
- sanitization status;
- purpose;
- associated regression.

Do not overwrite a historical fixture without reason.

---

# 43. i18n

Use Chrome's native i18n mechanism (`_locales/`). Every user-visible string MUST be localized; do not hardcode user-facing strings in UI code. Do not introduce a second localization framework unless a concrete technical requirement justifies it.

> The i18n architecture is specified in **SPECIFICATION.md §61 (Internationalization)**.

---

# 44. i18n Key Naming

Use consistent prefixes: `core_*`, `instagram_*`, `facebook_*`, `reddit_*` (e.g. `core_download`, `instagram_scan_profile`, `reddit_gallery`).

> The key convention is specified in **SPECIFICATION.md §62 (i18n Key Convention)**.

---

# 45. i18n Validation

Maintain an automated check such as:

```bash
bun run check:i18n
```

The validator should detect:

- missing keys;
- malformed locale files;
- placeholder mismatches;
- missing translations;
- stale keys where detectable.

Translations must preserve placeholders.

---

# 46. Locale-Aware UI

Never assume English text length. The UI must tolerate longer/shorter translations, reordered phrases, plural differences, and locale-specific formatting. Avoid fixed dimensions whose only justification is English text.

> See **SPECIFICATION.md §65 (Locale-Aware Layout)**.

---

# 47. Storage

Use a storage abstraction with explicit namespaces (`core.*`, `instagram.*`, `facebook.*`, `reddit.*`). Plugins must not access another plugin's namespace without explicit architectural justification. Keep temporary/cache data distinct from durable settings.

> The storage model is specified in **SPECIFICATION.md §49 (Storage Service)**.

---

# 48. Temporary Data

Temporary media, cache data, debug artifacts, HAR captures, diagnostic bundles, and downloaded test outputs should not accidentally enter Git.

Maintain appropriate `.gitignore` rules.

Never add real user data to repository fixtures.

---

# 49. ZIP and Packaging

ZIP generation belongs to Core. ZIP services MUST NOT contain platform conditionals (`if Reddit / Instagram / Facebook`). Platform-specific archive paths may be provided by plugins; the archive engine consumes generic `{ path, binary }` entries.

> The archive model is specified in **SPECIFICATION.md §43–§44 (Archive Service / Archive Entry)**.

---

# 50. Filename Handling

Generic filename sanitization belongs to Core; plugins may supply naming context or override when necessary. The generic layer handles invalid characters, reserved names, path traversal, length constraints, duplicate names, and extension handling. Do not place generic filesystem sanitization inside platform parsers.

> The filename service is specified in **SPECIFICATION.md §46 (Filename Service)**.

---

# 51. Path Traversal

Never allow platform-provided strings to become unrestricted filesystem paths. All filenames and archive paths must be sanitized; reject/normalize `..`, `.`, absolute paths, drive prefixes, UNC paths, inappropriate path separators, and control characters. Do not trust remote titles, usernames, subreddit/album names, captions, or IDs.

> The path-safety rules are specified in **SPECIFICATION.md §47 (Path Safety)**.

---

# 52. Security

Do not weaken browser security controls to simplify implementation.

Avoid:

```text
eval
new Function
unsafe dynamic code
```

unless there is a documented and unavoidable technical requirement.

Any security exception must be reviewed and documented.

---

# 53. Permissions

Every host permission must have:

- owner plugin;
- purpose;
- feature using it;
- documented reason.

Do not blindly merge manifests.

Do not broaden host permissions merely because it makes implementation easier.

---

# 54. Manifest Validation

Automated validation should cover:

- host permissions;
- content scripts;
- web-accessible resources;
- service worker;
- offscreen resources;
- locale configuration;
- plugin registration;
- capability/runtime requirements.

A plugin requiring a runtime capability that is missing from the manifest should cause validation failure.

---

# 55. Dependency Validation

Architectural dependency rules must be machine-checkable.

At minimum, fail validation for:

```text
core → instagram
core → facebook
core → reddit

instagram → facebook
facebook → instagram

reddit → instagram
reddit → facebook

popup → plugin internals
```

Prefer automated architectural tests over documentation-only rules.

---

# 56. Directory Rules

Do not create arbitrary top-level directories.

Established top-level directories are expected to remain:

```text
src/
tests/
docs/
tools/
assets/
vendor/
_locales/
```

Do not create:

```text
misc/
stuff/
random/
helpers/
common/
temp/
new-utils/
```

without documented architectural justification.

---

# 57. Directory Responsibility

Each directory must have one clear responsibility.

Before moving code, ask:

```text
Who owns this responsibility?
```

Do not move files only because they “look related”.

Runtime context and architectural ownership matter more than filename similarity.

---

# 58. Documentation

Documentation is part of the architecture.

Expected documentation:

```text
docs/
├── architecture/
├── platforms/
│   ├── instagram/
│   ├── facebook/
│   └── reddit/
├── development/
├── debugging/
├── decisions/
└── operations/
```

Keep documentation synchronized with the actual implementation.

---

# 59. Platform Documentation

Each platform should document:

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

Document both intended behavior and known fragile points.

---

# 60. Known Limitations

Maintain:

```text
KNOWN_LIMITATIONS.md
```

for each platform.

Document:

- unsupported targets;
- fragile selectors;
- authentication dependencies;
- rate limiting;
- browser-specific behavior;
- unstable APIs;
- known media limitations;
- known platform variations.

Do not “fix” a documented limitation without understanding why it exists.

---

# 61. ADRs

Architectural decisions belong in:

```text
docs/decisions/
```

Use:

```text
ADR-001-...
ADR-002-...
```

Each ADR must contain:

```text
Status
Context
Decision
Alternatives considered
Consequences
```

Important decisions include:

- Core/plugin architecture;
- independent Instagram/Facebook plugins;
- Meta shared layer;
- download artifact model;
- HAR fixture strategy;
- native i18n;
- runtime/toolchain;
- migration strategy.

---

# 62. Runtime and Tooling (Bun)

Production extension code MUST be browser-runtime compatible.

The shipped extension MUST NOT require:

```text
Node.js
Bun
npm
external local server
external daemon
```

The official development baseline is:

```text
Bun
```

Do not use Bun-specific APIs in browser runtime code.

---

# 63. Type Safety

Use JavaScript as the baseline language.

Prefer:

```text
JavaScript
ES Modules
JSDoc
checkJs
```

Use explicit type definitions for:

```text
MediaItem
PlatformTarget
ScanResult
DownloadJob
DownloadArtifact
PlatformCapabilities
PlatformPlugin
```

Do not perform a project-wide TypeScript migration as part of unrelated architecture work.

TypeScript may be introduced later if contract complexity justifies it.

---

# 64. Build System

Prefer native modern JavaScript when practical.

Do not add a bundler merely because other projects use one.

Introduce bundling only for a demonstrated requirement.

If a bundler is introduced:

- source remains canonical;
- source maps are required;
- DevTools debugging must remain usable;
- generated output must be separate from source;
- build steps must be documented.

---

# 65. Dependency Policy

Before adding a dependency:

1. determine whether native browser APIs already solve the problem;
2. determine whether an existing dependency can be reused;
3. evaluate maintenance and compatibility;
4. evaluate extension CSP implications;
5. document why the dependency is required.

Do not add dependencies solely for convenience.

---

# 66. Vendor Code

Existing vendor dependencies should not be replaced merely because a different package appears cleaner or newer.

Before replacing vendor code:

- understand current behavior;
- inspect consumers;
- inspect licenses;
- compare functionality;
- test the replacement;
- document the change.

---

# 67. Testing Strategy

Tests are divided into `tests/core/`, `tests/contracts/`, `tests/fixtures/`, `tests/integration/`, and `tests/regression/`. All important behavior should have the narrowest useful test layer. See **SPECIFICATION.md §67–§96 (testing taxonomy)** for the canonical test organization and **§137 (Testing Philosophy)** for the three-question heuristic (Does the Core work? Does the plugin obey the contract? Does the real platform behavior still work?).

---

# 68. Core Tests

Core tests cover at minimum: MediaItem validation, DownloadJob lifecycle, queue, concurrency, cancellation, retries, filename sanitization, archive path handling, ZIP, progress, messaging, storage, diagnostics sanitization, i18n validation, manifest validation, and dependency validation. See **SPECIFICATION.md §90 (Core Tests)** for the canonical list.

---

# 69. Contract Tests

Every plugin must satisfy common contract tests covering identity, matching, capability declaration, initialization, destruction, environment validation, target detection, normalization, scan result validity, error semantics, naming, archive paths, download planning, and diagnostics sanitization. See **SPECIFICATION.md §91 (Contract Tests)** for the canonical list. The Reddit naming and message-routing tests live under `tests/contracts/`.

---

# 70. Platform Tests

## Instagram

Cover:

- profile;
- posts;
- carousel;
- reels;
- stories;
- highlights;
- pagination;
- GraphQL normalization;
- CDN resolution;
- target detection.

## Facebook

Cover:

- profile;
- albums;
- photos;
- collections;
- multi-tab;
- navigation;
- network extraction;
- GraphQL normalization;
- CDN resolution.

## Reddit

Cover:

- image;
- gallery;
- video;
- DASH;
- audio;
- muxing;
- RedGifs;
- profile;
- deduplication;
- chunked transfer.

---

# 71. Integration Tests

Where practical, test complete flows:

```text
Detection
→ Scan
→ Normalize
→ Resolve
→ Download Plan
→ Download
→ Package
→ Completion
```

Use sanitized fixtures wherever possible.

---

# 72. Regression Tests

Every important bug should become a regression test.

Preferred process:

```text
bug
↓
reproduce
↓
capture fixture
↓
sanitize fixture
↓
write regression test
↓
fix
↓
verify
```

Do not rely on manual memory of old failures.

---

# 73. Migration Workflow

Use the strangler pattern when migrating legacy code. The canonical sequence — baseline, characterization tests, Core contracts, plugin registry, Instagram adapter, Instagram verification, Facebook adapter, Facebook verification, Reddit adapter, Reddit verification, shared infrastructure extraction, cleanup — is in **SPECIFICATION.md §105 (Migration Strategy)**. Do not combine architecture migration with parser rewrite, storage rewrite, UI rewrite, build-tool migration, TypeScript migration, or permission redesign; change one major axis at a time (**SPEC §106**). Legacy code lives under `plugins/<platform>/legacy/` wrapped by adapters; do not delete it until replacement behavior is demonstrated (**SPEC §74**).

---

# 74. Legacy Adapters

Temporary adapters are acceptable.

For example:

```text
InstagramPlugin
    ↓
legacy Instagram implementation
    ↓
MediaItem[]
```

```text
FacebookPlugin
    ↓
legacy Facebook implementation
    ↓
MediaItem[]
```

```text
RedditPlugin
    ↓
legacy Reddit implementation
    ↓
MediaItem[]
```

Do not delete legacy code until equivalent behavior has been proven.

---

# 75. One Architectural Axis at a Time

Do not combine unrelated large migrations.

Avoid doing all of these simultaneously:

```text
architecture rewrite
+
TypeScript migration
+
bundler migration
+
UI rewrite
+
parser rewrite
+
storage rewrite
+
manifest rewrite
```

Change one major architectural dimension at a time.

---

# 76. Manual Verification

Automated tests are necessary but insufficient for browser-extension work.

When platform functionality is affected, verify in a real browser:

- extension loads;
- popup opens;
- platform detection works;
- target detection works;
- scan works;
- media is shown;
- selection works;
- downloads work;
- ZIP works;
- folders work;
- progress works;
- cancellation works;
- in-page UI works;
- authentication behavior still works.

---

# 77. Test Commands

Use the project's canonical commands.

Expected commands include:

```bash
bun run validate:local
bun run validate
bun test
bun run typecheck
bun run check:i18n
bun run check:manifest
bun run check:dependencies
bun run check:har
```

If a command does not exist yet, do not invent a false success.

Add it only when implementing the corresponding tool.

---

# 78. Git Workflow

Prefer small, focused commits.

Good:

```text
test Instagram baseline
introduce MediaItem contract
add plugin registry
adapt Instagram scanner
verify Instagram
adapt Facebook scanner
verify Facebook
adapt Reddit resolver
verify Reddit
extract archive service
```

Avoid a single enormous migration commit.

---

# 79. File Movement

Before moving or renaming a file:

1. search all static imports;
2. search dynamic references;
3. search manifest references;
4. search tests;
5. search documentation;
6. search string-based paths;
7. inspect build tooling;
8. inspect runtime registration.

Never assume static imports are the only references.

---

# 80. Search Before Editing

Before changing behavior, search for:

- all callers;
- all imports;
- all message names;
- all event names;
- related tests;
- documentation;
- fixture references;
- manifest entries.

Understand impact before editing.

---

# 81. Do Not Silently Change Behavior

Changes to any of the following require explicit consideration:

- naming;
- directory structure visible to users;
- ZIP layout;
- concurrency;
- retry policy;
- cancellation;
- authentication;
- storage;
- cache behavior;
- request credentials;
- media ordering;
- duplicate handling;
- pagination;
- UI semantics.

Do not make these changes incidental to a refactor.

---

# 82. Platform Invariants

Maintain platform invariants. The canonical list per platform lives in **SPECIFICATION.md §88 (Platform Invariants)**. In summary: Instagram preserves carousel/story/highlight ordering, highlight identity, pagination semantics, and full-resolution media preference; Facebook preserves album/collection/source-tab identity, multi-tab behavior, and observable media ordering; Reddit preserves gallery ordering, DASH audio/video association, muxing correctness, RedGifs resolution, duplicate handling, profile discovery, and chunked transfer behavior.

---

# 83. Adding a New Platform

A new platform should normally involve a new `src/plugins/<platform>/` directory, `tests/fixtures/<platform>/`, `tests/contracts/` coverage, `docs/platforms/<platform>/` documentation, `_locales` additions, manifest permissions, and plugin registration. The new plugin should reuse Core download, queue, ZIP, progress, selection, UI, diagnostics, logging, storage, and messaging — do not duplicate those implementations. See **SPECIFICATION.md §83 (Adding a New Platform)**, **§134 (New Platform Checklist)**, **§150 (Extensibility Requirement)**, and **§151 (Stability Requirement)**.

---

# 84. New Capability Rule

If a new platform cannot be implemented through the existing contract, determine whether it requires a genuine new generic capability or only a platform-specific implementation that belongs inside its plugin. Only the first case justifies a Core change. When modifying Core to support a new capability: update the contract, add Core tests, add documentation, preserve existing plugin behavior, and update all affected contract tests. See **SPECIFICATION.md §135 (New Capability Checklist)**.

---

# 85. Plugin Loading

Built-in plugins should be registered deterministically.

Conceptually:

```js
registerBuiltInPlugins([
  InstagramPlugin,
  FacebookPlugin,
  RedditPlugin
]);
```

Do not introduce runtime filesystem scanning merely because the source repository is modular.

Browser extension packaging is not equivalent to a Node/Bun plugin directory.

Source modularity and runtime dynamic discovery are separate concerns.

---

# 86. Platform Feature Matrix

Maintain a platform capability matrix. The canonical matrix is in **SPECIFICATION.md §86 (Feature Matrix)**. At a glance: Profile scan ✓ for all three; Gallery ✓ for all three; Stories and Highlights ✓ only for Instagram; Albums and Reels (Instagram) only on their respective platforms; DASH, RedGifs, and Muxing only for Reddit; Pagination ✓ for all three; ZIP, Queue, Progress, and Cancellation are Core for all three. The matrix describes capabilities; it does not define implementation.

---

# 87. Debugging Workflow

When a platform stops working:

1. identify the platform;
2. identify target type;
3. inspect plugin health;
4. inspect logs;
5. inspect trace ID;
6. compare behavior against known fixtures;
7. capture a new HAR if needed;
8. sanitize it;
9. reproduce with a fixture;
10. add regression coverage;
11. fix the smallest responsible layer.

Do not immediately rewrite the scraper.

---

# 88. HAR Investigation Workflow

When investigating network-dependent failures:

```text
Real browser behavior
↓
Capture HAR
↓
Sanitize
↓
Inspect requests
↓
Identify relevant request/response
↓
Create fixture
↓
Write isolated test
↓
Fix plugin
↓
Run regression
```

Do not build a fix solely from assumptions about how the site "should" work.

Prefer observed evidence.

---

# 89. Documentation as Evidence

When documenting reverse-engineered site behavior, distinguish:

```text
Observed
Inferred
Assumed
Unknown
```

Do not present guesses as facts.

This is especially important for:

- GraphQL behavior;
- internal APIs;
- undocumented endpoints;
- selectors;
- authentication semantics.

---

# 90. External Site Changes

When a target website changes:

- document the observed change;
- capture evidence where possible;
- update fixtures;
- update tests;
- update affected platform documentation;
- avoid changing unrelated Core code.

---

# 91. Privacy

Repository development must never depend on committing real user data.

Never commit:

- user cookies;
- personal account identifiers;
- private messages;
- private media;
- authentication headers;
- tokens;
- session state;
- real diagnostic exports.

Use synthetic data whenever possible.

---

# 92. Data Sanitization

Sanitize before committing:

```text
HAR
logs
diagnostics
screenshots containing private data
JSON responses
HTML captures
network fixtures
```

When unsure whether an artifact contains secrets:

DO NOT COMMIT IT.

---

# 93. User-Facing Data

Treat all platform-provided strings as untrusted input.

This includes:

- usernames;
- captions;
- post titles;
- album names;
- subreddit names;
- filenames;
- IDs.

Apply:

- sanitization;
- escaping;
- length limits where necessary;
- safe rendering.

Do not use raw platform strings as executable content.

---

# 94. No Hidden Side Effects

Avoid functions whose names suggest pure transformations but:

- write files;
- mutate global state;
- initiate downloads;
- emit unrelated messages;
- change browser navigation.

Make side effects explicit.

---

# 95. Async Behavior

Be explicit about asynchronous boundaries.

Avoid accidental race conditions involving:

- page navigation;
- plugin initialization;
- scanner lifecycle;
- download cancellation;
- popup closure;
- service-worker lifecycle;
- IndexedDB operations;
- message ordering.

When introducing concurrency, add tests for:

- simultaneous jobs;
- cancellation;
- failure during another active job;
- completion ordering;
- stale messages.

---

# 96. Cancellation

Cancellation is a first-class feature.

A canceled job must not be reported as:

```text
success
```

unless the product semantics explicitly define a partial completion.

Review cancellation propagation through:

```text
UI
→ Core
→ Job
→ Plugin
→ Resolver
→ Browser/network operation
```

where applicable.

---

# 97. Progress

Progress reporting must remain coherent across layers.

Do not emit arbitrary progress percentages that conflict between:

```text
scan
resolve
download
processing
archive
```

When a pipeline contains multiple stages, represent stages explicitly where practical.

---

# 98. Concurrency

Do not change concurrency defaults casually.

Concurrency affects:

- rate limiting;
- browser resource usage;
- service-worker lifetime;
- download reliability;
- platform behavior.

Any concurrency change should include regression/testing consideration.

---

# 99. Cache Semantics

Do not change cache behavior merely to unify implementations.

Before modifying a cache:

- determine who owns it;
- determine expiration;
- determine consistency requirements;
- determine whether it is temporary or durable;
- determine whether it contains user-sensitive information.

Document changes.

---

# 100. Performance

Optimize only after understanding actual bottlenecks.

Do not trade reliability for micro-optimizations.

Measure:

- memory;
- download throughput;
- ZIP generation;
- DOM scanning;
- network requests;
- serialization;
- storage;
- large file behavior.

Large-media behavior matters more than synthetic microbenchmarks.

---

# 101. Browser Compatibility

Do not assume Node/Bun APIs exist in the browser.

Likewise, do not assume browser APIs exist in Node tooling.

Keep environment-specific code clearly separated.

---

# 102. CSP and Browser Security

Respect Manifest V3 security constraints.

Do not introduce dynamic execution to bypass CSP.

If a platform integration requires special execution context behavior:

- document why;
- isolate it;
- minimize its scope;
- test it.

---

# 103. API and Schema Changes

When a platform API/GraphQL schema changes:

1. preserve old fixtures when useful;
2. capture new behavior;
3. update parser/normalizer in the plugin;
4. add regression tests;
5. update documentation.

Do not modify generic Core schemas to accommodate a platform-specific API shape.

---

# 104. Normalization Boundary

The plugin may consume arbitrary raw data:

```text
DOM
GraphQL
JSON
network events
Web Components
internal APIs
```

The plugin must normalize those sources into the canonical model before passing them to generic application services.

Core should not parse raw platform responses.

---

# 105. Resolver Boundary

The plugin owns:

```text
raw platform media
→ resolved DownloadArtifact
```

Core owns:

```text
DownloadArtifact
→ DownloadJob
→ execution
```

Do not mix these layers.

---

# 106. UI Boundary

UI should consume:

```text
MediaItem
ScanResult
DownloadState
Capabilities
```

rather than raw platform DOM/API objects.

This keeps UI reusable.

---

# 107. Testing UI

When possible, test behavior independently from visual presentation.

Test:

- selection;
- filtering;
- download commands;
- progress;
- error states;
- capability-based controls.

Manual browser checks should cover actual rendering.

---

# 108. Documentation Updates

When a change modifies:

- architecture;
- contract;
- plugin capabilities;
- manifest permissions;
- runtime contexts;
- debugging;
- i18n;
- directory ownership;

update relevant documentation in the same change.

Do not knowingly leave architecture docs stale.

---

# 110. README

README should explain:

- what the extension does;
- supported platforms;
- development setup;
- test commands;
- architecture at a high level;
- how to add a plugin;
- privacy/security considerations.

Do not put deep platform reverse-engineering details in README.

---

# 111. Pull Request / Change Review

Before considering a change complete, verify it preserves existing platform behavior, respects plugin boundaries, keeps Core platform-agnostic, and update permissions / runtime context / i18n / tests / fixtures / documentation as needed. The Definition of Done lives in **SPECIFICATION.md §112 (Definition of Done)** and **AGENTS.md §112**.

---

# 112. Definition of Done

A change is not complete merely because code compiles.

For architectural/platform changes, completion generally requires:

```text
implementation
+
tests
+
regression verification
+
documentation
+
manifest validation
+
i18n validation
+
architecture validation
```

For browser-facing changes, also perform manual verification when relevant.

---

# 113. Safe Refactoring Rule

A refactor is valid only if observable behavior remains equivalent unless a behavioral change was intentional and documented.

Observable behavior includes:

- supported pages;
- media found;
- media order;
- filenames;
- folders;
- ZIP structure;
- download behavior;
- progress;
- cancellation;
- authentication;
- UI behavior;
- error reporting.

---

# 114. Minimal Responsible Change

When fixing a bug:

Prefer:

```text
smallest responsible layer
```

over:

```text
largest possible rewrite
```

For example:

```text
broken Instagram selector
→ Instagram plugin

broken ZIP
→ Core archive service

broken download queue
→ Core download manager

broken Facebook navigation
→ Facebook plugin
```

Do not modify unrelated components.

---

# 115. Avoid Abstraction for Its Own Sake

Before introducing an abstraction ask:

```text
Is it genuinely shared?
Does it have identical semantics?
Will multiple platforms use it?
Does it preserve each platform's behavior?
Does it reduce coupling?
```

If not, do not abstract it.

---

# 116. Avoid Premature Generalization

Do not design a hypothetical generic abstraction for ten future sites.

Design the smallest stable contract required by the current platforms.

Future platforms should extend the system through explicit capabilities when real evidence requires them.

---

# 117. Four Main Architectural Boundaries

Always reason about:

```text
Platform Boundary
Runtime Boundary
Service Boundary
Data Contract Boundary
```

A change should identify which boundary it crosses.

---

# 118. Architectural Smell Indicators

Treat these as warnings: Core imports platform code; more than a few platform conditionals in Core; generic utility contains site selectors; plugin accesses another plugin; UI consumes raw GraphQL; ZIP knows platform names; download manager knows RedGifs; filename service knows Reddit; manifest permissions are undocumented; zero-result scans are silently treated as success; HAR fixtures contain secrets; tests depend on live websites unnecessarily. The canonical list lives in **SPECIFICATION.md §149 (Architectural Smells)** and is mechanically detectable by `bun run check:dependencies` and `bun run check:arch-smells` (when added).

Investigate before continuing.

---

# 119. Live Website Dependence

Prefer deterministic fixtures for unit/integration tests.

Live-site tests may be useful but are inherently fragile.

Do not make the entire test suite dependent on current external website behavior unless explicitly intended.

When live tests exist:

- mark them clearly;
- make failures diagnosable;
- avoid making routine local development depend on them.

---

# 120. External Network Failures

Tests should distinguish:

```text
code failure
```

from:

```text
external site unavailable
```

Do not hide network failures as parser failures.

---

# 121. Time and Date

Use deterministic timestamps in fixtures/tests whenever practical.

Do not make tests depend on the current system clock unless testing time behavior.

---

# 122. Randomness

Tests should be deterministic.

If random IDs are necessary:

- control the seed where practical;
- do not assert unstable values;
- avoid nondeterministic fixture output.

---

# 123. File Naming

Use predictable, descriptive names.

Avoid:

```text
new.js
test2.js
helper.js
final.js
new-parser.js
temp-parser.js
```

Names should reflect responsibility.

---

# 124. Imports

Keep imports explicit.

Do not introduce giant barrel modules merely to hide architecture.

Imports should make ownership understandable.

---

# 125. Circular Dependencies

Avoid circular dependencies.

If a circular dependency appears during modularization, stop and reassess the boundary instead of patching around it blindly.

---

# 126. Generic Utilities

A utility belongs in Core only when its semantics are platform-independent.

Examples that are usually Core-appropriate:

```text
filename sanitization
queue primitives
retry
progress aggregation
archive path normalization
event infrastructure
```

Examples that are usually plugin-specific:

```text
Instagram URL parsing
Facebook route detection
Reddit DASH parsing
RedGifs resolution
platform selectors
GraphQL operation names
```

---

# 127. Meta-Shared Utilities

A utility may belong in Meta Shared when both Instagram and Facebook depend on the same Meta semantics.

Do not put unrelated generic utilities there.

`meta-shared` should not become a second Core.

---

# 128. README for Plugins

Each plugin should have enough local documentation for a maintainer to understand:

```text
What it detects
What it scans
How it resolves media
What runtime contexts it uses
What fixtures exist
What known limitations exist
```

---

# 129. Agent Handoff

When finishing substantial work, leave the repository in a state that another agent can continue safely.

Useful artifacts include:

- tests;
- documentation;
- ADRs;
- fixtures;
- diagnostics;
- clear commits;
- explicit TODOs where necessary.

Do not leave undocumented architectural assumptions in code.

---

# 130. TODOs

TODOs should be actionable.

Good:

```text
TODO: Replace temporary legacy adapter after contract test coverage
```

Bad:

```text
TODO: clean this up
```

Prefer issue/task references where available.

---

# 131. Broken Architecture Is Not Fixed by Comments

Do not leave an architectural violation in place merely because it is heavily documented.

If Core contains platform-specific behavior, fix the boundary when practical.

Comments explain constraints; they do not replace architecture.

---

# 132. Browser Extension Packaging

Do not confuse source repository layout with runtime filesystem behavior.

The browser extension is a packaged artifact.

Adding:

```text
plugins/foo/
```

does not imply that the browser can dynamically discover arbitrary files at runtime.

Registration must remain deterministic unless explicit runtime loading is actually supported and justified.

---

# 133. Security Review for New Features

Any new platform integration involving page injection, main-world access, network interception, elevated permissions, session handling, or storage must review the trust boundary, data exposure, permission scope, logging, diagnostics, and sanitization. The canonical checklist is **SPECIFICATION.md §169 (Security Review for Platform Changes)**.

---

# 134. Sensitive Site Data

Reverse-engineered site behavior often exposes sensitive information.

Treat:

- session data;
- GraphQL responses;
- internal IDs;
- cookies;
- headers;
- personal profile data;

as sensitive by default.

Do not log or commit them unless explicitly sanitized and necessary.

---

# 135. Performance Regression Checks

For changes affecting:

- scanning;
- large galleries;
- large downloads;
- ZIP;
- IndexedDB;
- serialization;

consider regression impact on:

- memory;
- CPU;
- latency;
- browser responsiveness;
- large-file reliability.

Avoid optimizing only for small examples.

---

# 136. Large Files

Do not assume media fits comfortably in memory.

When working with large media:

- prefer streaming/chunking where appropriate;
- understand browser memory constraints;
- preserve existing large-file behavior;
- test large files;
- avoid unnecessary Base64 transformations.

Never introduce a Base64 conversion merely because it is convenient.

---

# 137. Binary Data

Be explicit about binary representations:

```text
Blob
ArrayBuffer
Uint8Array
base64
stream
```

Do not mix representations casually.

Document conversion boundaries when they matter.

---

# 138. ZIP Memory

Do not assume ZIP generation can load an unlimited number of large files into memory.

Preserve existing large-download safeguards and improve them deliberately.

---

# 139. Browser Lifecycle

Remember that browser extension contexts can be suspended or recreated.

Do not rely on:

- process lifetime;
- in-memory state surviving indefinitely;
- background worker permanence.

Persistent state must use appropriate storage.

---

# 140. Message Robustness

Messages may arrive:

- late;
- duplicated;
- after UI closure;
- after navigation;
- after plugin teardown.

Handlers should validate:

- message type;
- source;
- expected state;
- job ID;
- trace ID;
- plugin context.

---

# 141. Stale State

Do not let stale messages mutate a newer scan/download.

Where necessary, associate state with:

```text
scanId
jobId
traceId
pluginId
targetId
```

---

# 142. Plugin Lifecycle

Plugins should have explicit lifecycle handling where needed:

```text
initialize
active
destroy
```

On navigation or target changes, clean up:

- observers;
- listeners;
- intervals;
- pending tasks;
- UI;
- network hooks.

Avoid memory leaks.

---

# 143. DOM Observers

When using MutationObserver or similar mechanisms:

- scope selectors;
- disconnect when no longer needed;
- avoid duplicate registrations;
- avoid scanning the entire page repeatedly without reason.

---

# 144. Network Interception

Network interception is inherently fragile.

Keep it:

- plugin-scoped;
- observable;
- testable where possible;
- documented;
- defensive against unexpected response shapes.

Do not make Core understand platform network internals.

---

# 145. Reverse-Engineered APIs

Undocumented APIs may change without notice.

When using one:

- isolate its assumptions;
- document observed behavior;
- capture representative fixtures;
- handle failure;
- provide diagnostics.

Do not treat undocumented behavior as stable merely because it worked yesterday.

---

# 146. Platform-Specific Constants

Keep unstable constants near the owning plugin.

Examples:

```text
GraphQL operation names
document IDs
selectors
URL patterns
internal route names
media endpoint patterns
```

Do not scatter them across Core.

---

# 147. Contract Stability

Once a Core contract is established, do not change it casually to fit one plugin.

When a plugin requires something new:

1. determine whether the contract truly lacks a generic concept;
2. evaluate whether an optional capability is enough;
3. only then change the contract.

---

# 148. Backward Compatibility During Migration

During active migration, temporary compatibility layers may be preferable to immediate cleanup.

Do not remove compatibility code until:

- new path is verified;
- regression coverage exists;
- migration is complete.

---

# 149. Final Validation Before Declaring Success

At minimum confirm:

```text
Instagram
✓ detection
✓ scan
✓ resolution
✓ download
✓ ZIP
✓ cancellation
✓ progress

Facebook
✓ detection
✓ scan
✓ resolution
✓ download
✓ ZIP
✓ cancellation
✓ progress

Reddit
✓ detection
✓ scan
✓ resolution
✓ download
✓ ZIP
✓ cancellation
✓ progress
✓ specialized media pipeline
```

Then confirm:

```text
✓ i18n validation
✓ fixture validation
✓ manifest validation
✓ architecture/dependency validation
✓ tests
✓ documentation
```

---

# 150. Ultimate Rules

When in doubt, follow this order of priorities:

```text
1. Preserve working behavior.
2. Protect user data and credentials.
3. Maintain plugin isolation.
4. Maintain stable Core contracts.
5. Add regression coverage.
6. Diagnose with evidence.
7. Document architectural decisions.
8. Simplify only after correctness is established.
```

The most important principles (canonical source — see **SPECIFICATION.md §4 (Fundamental Architectural Principle)**, **SPEC §177 (Ultimate Principles)**, and **SPEC §178 (Ultimate Success Criterion)**):

- Plugins specialize. Core generalizes. Contracts connect them.
- Instagram, Facebook, and Reddit are independent platforms.
- Shared code is not automatically Core code.
- A clean abstraction is worthless if it breaks a working site.
- HAR fixtures are evidence, not secrets.
- Diagnostics must be useful without exposing private data.
- Tests should make regressions reproducible.
- Architecture rules should be mechanically validated when practical.
- The browser is the production runtime.
- Bun is development tooling.

> Authority: the canonical formulation of these principles, including the architectural invariant diagram, lives in `SPECIFICATION.md` (§4 and §176). If this summary ever diverges from `SPECIFICATION.md`, the SPEC wins — fix this file, not the SPEC.

Never reverse this dependency.

The architecture should make it possible to add a fourth platform without rewriting the first three.

The architecture should also make it possible to fix a platform-specific regression without modifying Core.

That is the definition of successful modularity.