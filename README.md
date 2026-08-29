<div align="center">

<img src="assets/icons/icon.svg" width="128" alt="Social Media Downloader Icon">

# Social Media Downloader (SMD)

**A modular, high-fidelity Chrome extension to discover, resolve, multiplex, and package original full-resolution media from Instagram, Facebook, and Reddit with zero compression loss.**

<p align="center">
  <a href="README.md"><b>English</b></a> •
  <a href="README_pt-BR.md"><b>Português (Brasil)</b></a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Manifest-V3-3b82f6?style=for-the-badge&logo=googlechrome&logoColor=white" alt="Chrome Manifest V3">
  <img src="https://img.shields.io/badge/Runtime-Bun-f472b6?style=for-the-badge&logo=bun&logoColor=white" alt="Runtime Bun">
  <img src="https://img.shields.io/badge/License-MIT-6366f1?style=for-the-badge" alt="License MIT">
</p>

</div>

---

## Key Architecture & Capabilities

- **Strict Core / Plugin Separation**:
  - Independent first-class platform plugins for **Instagram**, **Facebook**, and **Reddit**.
  - Generic Core owns download management, queue orchestration, ZIP packaging, filename sanitization, and localized UI.
  - Zero cross-plugin leakage or platform conditionals in Core infrastructure.

- **Maximum Resolution & Authentic CDN Extraction**:
  - **Instagram**: GraphQL profile harvesting, full multi-slide carousel preservation, Reels, Stories, Highlights, and uncompressed avatar resolution.
  - **Facebook**: In-page navigation across photo tabs with progressive pagination, DOM harvesting, and CDN dimension parameter stripping while preserving signed URLs.
  - **Reddit**: Public JSON API multi-source discovery, direct uncompressed images, galleries, RedGifs video resolution, and cross-post deduplication.

- **In-Browser DASH Audio/Video Multiplexing**:
  - Reddit DASH videos with split video and audio tracks are paired and multiplexed directly inside the browser using a lightweight MP4 muxer engine (`RedditVideoMuxer`).
  - Generates ready-to-play single `.mp4` video files with synchronized audio with zero external server dependencies.

- **Memory-Safe Offscreen ZIP Packaging & Folder Downloads**:
  - Download media individually into cleanly organized directories (`Downloads/SMD/...`) or package batches into a single ZIP archive.
  - Offscreen document execution avoids service worker memory constraints and uses stream-safe chunked packing with a 1GB safety ceiling.

- **Security & Subframe Isolation**:
  - Content scripts and main-world bridges enforce top-window frame isolation (`window === window.top`) to avoid interference from third-party or internal iframes.
  - Comprehensive filename sanitization strips forbidden filesystem characters, reserved DOS names, zero-width tokens, and RTL directional overrides.

- **Comprehensive Localization (22 Locales)**:
  - 100% native Chrome i18n key and placeholder parity across 22 global languages: Arabic, Bengali, German, English, Spanish, French, Hindi, Indonesian, Italian, Japanese, Korean, Marathi, Portuguese (BR & PT), Russian, Tamil, Telugu, Turkish, Urdu, Vietnamese, Chinese (Simplified & Traditional).

---

## Supported Platform Plugins

| Platform | Capabilities & Media Types | Extraction Strategy | Architecture Guide |
| :--- | :--- | :--- | :--- |
| **Instagram** | Posts, multi-slide Carousels, Reels, Stories, Highlights, Avatars | GraphQL + CDN un-crop | [Instagram Architecture](docs/platforms/instagram/ARCHITECTURE.md) |
| **Facebook** | Photo Albums, Uploads, Photos of Target, Timeline, Avatars | In-page navigation + DOM/JSON harvest | [Facebook Architecture](docs/platforms/facebook/ARCHITECTURE.md) |
| **Reddit** | Images, Multi-image Galleries, DASH Videos (with Audio), RedGifs | Public JSON API + in-browser MP4 muxer | [Reddit Architecture](docs/platforms/reddit/ARCHITECTURE.md) |

---

## Adding a New Platform

New platforms plug into the same Core — no changes to download, queue, ZIP, or UI infrastructure required.

1. Create `src/plugins/<platform>/` implementing the platform plugin contract.
2. Register the plugin deterministically in the plugin registry.
3. Add HAR/JSON fixtures under `tests/fixtures/<platform>/` and contract tests under `tests/contracts/`.
4. Add platform docs under `docs/platforms/<platform>/` and localized strings under `_locales/`.
5. Declare only the host permissions the platform needs, with a documented purpose.

See the [plugin system guide](docs/architecture/plugin-system.md).

---

## Download Structure & Organization

Individual downloads go to your browser's downloads directory under the `SMD` root; ZIP archive entries drop the `SMD/` prefix. Exact layout comes from each plugin's naming module:

```text
Downloads/
└── SMD/
    ├── Instagram/
    │   └── @username/
    │       ├── posts/                                  # timeline posts & reels (authentic CDN names, e.g. 714823214_..._n.jpg)
    │       ├── stories/                                # story_{postId}.jpg
    │       ├── highlights/{Highlight_Title}/           # highlight_{postId}.jpg
    │       └── profile_pic/                            # {username}_profile_pic.jpg
    ├── Facebook/
    │   └── {Target_Name}/                              # flat folder; authentic CDN names or {photoId}.jpg
    └── Reddit/
        └── u_{author}/r_{subreddit}/
            └── r_{subreddit}_u_{author}_{postId}_{mediaId}.mp4
```

Or packaged into a single timestamped ZIP archive:
```text
Downloads/
└── SMD/
    └── facebook_Target_Name_2026-08-28_15-30-00.zip
```

---

## Getting Started & Installation

1. **Clone the repository**:
   ```bash
   git clone https://github.com/th3sull1van/social-media-downloader.git
   ```
2. **Open Chrome Extensions Page**:
   - Navigate to `chrome://extensions/` in Google Chrome.
3. **Enable Developer Mode**:
   - Toggle the **Developer mode** switch in the upper-right corner.
4. **Load Unpacked Extension**:
   - Click **Load unpacked** and select the `social-media-downloader` root directory.
5. **Start Downloading**:
   - Visit any profile or post on Instagram, Facebook, or Reddit, and click the SMD icon or use the in-page overlay controls!

---

## Validation & Automated Testing Suite

The repository is guarded by a comprehensive automated test suite and strict architectural validation gates:

```bash
# Install dependencies
bun install

# Run the complete local validation gate (HAR replays + typecheck + tests + linters)
bun run validate:local

# Run CI validation gate
bun run validate

# Run individual test checks
bun test
bun run typecheck
bun run check:manifest
bun run check:dependencies
bun run check:i18n
bun run check:har
```

---

## Privacy & Security

- **No data collection**: scanning, resolution, and packaging run entirely in your browser — no analytics, no telemetry, no external servers.
- **Minimal permissions**: each host permission backs a documented feature (see the [permissions guide](docs/architecture/permissions.md)).
- **No credential logging**: logs never include cookies, tokens, or session identifiers.

---

## License

MIT © [th3sull1van](https://github.com/th3sull1van)
