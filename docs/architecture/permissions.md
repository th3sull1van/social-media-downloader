# Manifest Permissions — Justification

Per AGENTS §53, every host permission documents its owner plugin, purpose, and feature.

## Permissions

| Permission | Purpose |
|---|---|
| `downloads` | Core DownloadManager calls `chrome.downloads.download/cancel` and listens to `onChanged`. Filenames are passed via the `filename` option of `download()` (no `onDeterminingFilename` listener — see DownloadManager). |
| `storage` + `unlimitedStorage` | Reserved for future settings/state (nothing writes `chrome.storage` today). |
| `activeTab` | Popup requests the active tab URL to detect the platform. |
| `scripting` | Popup re-injects `src/content/content.js` when the content script is not yet present. |
| `offscreen` | Creates the offscreen document for ZIP packaging (JSZip, `URL.createObjectURL`). |

## Host permissions

| Host | Owner plugin | Why |
|---|---|---|
| `*://*.instagram.com/*` | Instagram | Content script, main-world injection, privileged fetch of GraphQL/media. |
| `*://*.cdninstagram.com/*` | Instagram | Instagram CDN media downloads. |
| `*://*.facebook.com/*` | Facebook | Content script, main-world injection, profile navigation. |
| `*://*.fbcdn.net/*` | Facebook | Facebook CDN media downloads. |
| `*://*.reddit.com/*` | Reddit | Content script + privileged fetch of the public JSON API from the service worker. |
| `*://*.redd.it/*` | Reddit | Reddit media hosts (`i.redd.it`, `v.redd.it`, `preview.redd.it`). |
| `*://*.redgifs.com/*` | Reddit (RedGifsResolver) | RedGifs API v2 + `media.redgifs.com` MP4 streams (subsumes the former `api.`/`media.` entries). |

## Removed since v1.0.0

- `*://*.imgur.com/*`: the Reddit detector mentions imgur URLs, but no resolver or
  downloader feature exists for imgur. Re-add with a feature, not before (AGENTS §53).
- `*://api.redgifs.com/*`, `*://media.redgifs.com/*`: redundant — `*.redgifs.com` matches both.

## Web-accessible resources

Restricted to what page contexts genuinely fetch:
- The two main-world injected scripts (injected via `<script src>` from the content script).
- `src/plugins/meta-shared/MetaNode.js` and `MetaCdn.js` (lazy `import()` from the
  content script — same boundary as the Reddit dynamic imports).
- `src/content/inpage_overlay.css` and `assets/icons/icon32.png` (content-script UI).

Removed: `vendor/jszip/jszip.min.js` (only the offscreen document loads it — extension
context, does not need web accessibility) and `src/offscreen/*` (never fetched by pages).
