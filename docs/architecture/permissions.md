# Manifest Permissions — Justification

Per AGENTS §53, every host permission documents its owner plugin, purpose, and feature.

## Permissions

| Permission | Purpose |
|---|---|
| `downloads` | Core DownloadManager calls `chrome.downloads.download/cancel` and listens to `onChanged`. Filenames are passed via the `filename` option of `download()` (no `onDeterminingFilename` listener — see DownloadManager). |
| `storage` + `unlimitedStorage` | Core persists settings and deduplication history in `chrome.storage.local`; temporary ZIP/generated media uses extension-origin OPFS. See [storage lifecycle](storage.md). |
| `activeTab` | Popup requests the active tab URL to detect the platform. |
| `scripting` | Popup injects `src/content/content.js` (and the owning platform's `MAIN`-world script when declared) if not yet present on an already-open tab. |
| `offscreen` | Creates the offscreen document for ZIP packaging (hand-written STORE engine in `src/offscreen/offscreen.js`, `URL.createObjectURL`). |

## Host permissions

| Host | Owner plugin | Why |
|---|---|---|
| `*://*.instagram.com/*` | Instagram | Content script, main-world injection, privileged fetch of GraphQL/media. |
| `*://*.cdninstagram.com/*` | Instagram | Instagram CDN media downloads. |
| `*://*.facebook.com/*` | Facebook | Content script, main-world injection, profile navigation. |
| `*://*.fbcdn.net/*` | Facebook | Facebook CDN media downloads. |
| `*://*.reddit.com/*` | Reddit | Content script (`ISOLATED` + page scan helpers) + privileged fetch of the public JSON API from the service worker. |
| `*://*.redd.it/*` | Reddit | Content script on media links + Reddit media hosts (`i.redd.it`, `v.redd.it`, `preview.redd.it`). |
| `*://*.redgifs.com/*` | Reddit (RedGifsResolver) | RedGifs API v2 + `media.redgifs.com` MP4 streams (subsumes the former `api.`/`media.` entries). |

## Deliberately Omitted / Removed since v1.0.0

- `*://*.imgur.com/*`: Direct `i.imgur.com` image URLs referenced in Reddit posts are allowlisted in `RedditScanner` and downloaded via `chrome.downloads.download()` without requiring broad `host_permissions` on `imgur.com` (AGENTS §53).
- `*://api.redgifs.com/*`, `*://media.redgifs.com/*`: redundant — `*.redgifs.com` matches both.

## Web-accessible resources

Restricted to what each origin genuinely imports dynamically from the isolated content script (split per platform match pattern in `manifest.json` and verified transitively by `tools/validation/manifest-check.js`):

- **Instagram (`*://*.instagram.com/*`)**: `src/plugins/instagram/InstagramContentController.js`, `InstagramDetector.js`, `InstagramNormalizer.js`, `src/core/domain/MediaItem.js`, `PlatformTarget.js`.
- **Facebook (`*://*.facebook.com/*`)**: `src/plugins/facebook/FacebookContentController.js`, `FacebookDetector.js`, `FacebookNormalizer.js`, `src/core/domain/MediaItem.js`, `PlatformTarget.js`, `src/core/services/FilenameService.js`.
- **Meta shared (`*://*.instagram.com/*`, `*://*.facebook.com/*`)**: `src/plugins/meta-shared/MetaNode.js`, `MetaCdn.js`.
- **Reddit (`*://*.reddit.com/*`, `*://*.redd.it/*`)**: `src/plugins/reddit/RedditContentController.js`, `RedditDetector.js`, `RedditScanner.js`, `RedditNormalizer.js`, `src/core/domain/MediaItem.js`, `PlatformTarget.js`, `src/core/services/FilenameService.js`.
- **Shared content runtime & UI (`instagram`, `facebook`, `reddit`, `redd.it`)**: `assets/icons/icon32.png`, `src/content/inpage_overlay.css`, `src/content/bridge/MainWorldBridge.js`, `src/content/runtime/NavigationTracker.js`, `src/content/runtime/ContentRuntime.js`, `src/content/ui/MediaGrid.js`, `src/content/ui/OverlayModal.js`.

Removed from `web_accessible_resources`:
- `src/plugins/instagram/main-world/injected.js` & `src/plugins/facebook/main-world/injected.js`: injected declaratively via `manifest.json` (`"world": "MAIN"`, `"run_at": "document_start"`) and via `chrome.scripting.executeScript({ world: 'MAIN' })` on fallback; pages never need direct web access.
- `vendor/jszip/jszip.min.js` (dead vendored ZIP lib) and `src/offscreen/*` (never fetched by pages).
