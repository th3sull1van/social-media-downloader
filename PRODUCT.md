# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Personal archivers: power users who bulk-archive entire profiles and albums (posts, reels, stories, highlights, galleries) from social platforms, often large batches in one sitting. Reliability and maximum resolution matter more to them than speed or convenience; silent quality loss is the primary failure mode.

## Product Purpose

Social Media Downloader (SMD) is a Chrome Manifest V3 extension that discovers, resolves, downloads, and packages media from Instagram, Facebook, and Reddit at original full resolution, entirely in the browser. It offers per-item downloads organized into folders or timestamped ZIP archives. Success is a faithful, byte-accurate copy of what the platform serves — nothing recompressed, nothing missing.

## Positioning

Original maximum resolution through authentic CDN extraction: no compression, no transcoding — the exact file the platform's CDN serves (with Facebook CDN dimension parameters stripped, Instagram full-resolution un-cropped) — plus in-browser DASH audio/video muxing for Reddit videos with zero external servers. A downloader that re-encodes or proxies through a backend cannot truthfully copy this claim.

## Operating Context

- Loaded unpacked via `chrome://extensions/` developer mode; no store install flow.
- Used while browsing Instagram, Facebook, or Reddit: the popup is opened from the toolbar, and in-page overlay controls appear on supported pages.
- Workflows: detect current platform/target → scan (all or per-type quick scans, e.g. Instagram Posts/Stories/Highlights/HD Profile Pic, Reddit Galleries/Videos/RedGifs) → review media items → download individually into `Downloads/SMD/<Platform>/...` or package as a timestamped ZIP.
- Development is driven by sanitized HAR replay regression tests (`bun run validate:local`); Bun is the dev toolchain, the browser is the production runtime.

## Capabilities and Constraints

- Plugin architecture: independent Instagram, Facebook, and Reddit plugins behind a platform-agnostic Core (download management, queues, ZIP packaging, filename sanitization, localized UI). Core must never contain platform knowledge.
- Supported media: Instagram posts, multi-slide carousels, reels, stories, highlights, avatars; Facebook photo albums, uploads, photos of target, timeline, avatars; Reddit images, multi-image galleries, DASH videos (with audio muxed in-browser), RedGifs; cross-post deduplication.
- Manifest V3 constraints: service worker for orchestration, offscreen document for memory-safe ZIP packing (stream-safe chunking, 1 GB ceiling), content scripts + main-world bridges with top-window frame isolation.
- Durable constraints confirmed with the user:
  - 22-locale Chrome i18n parity — every user-visible string must keep working across all 22 locales.
  - Zero-telemetry privacy stance — no analytics, no external servers; preserve in any UI change.
  - `Downloads/SMD/<Platform>/...` folder structure — users may rely on it; do not change casually.
- Undecided/open: no additional product facts were flagged; do not invent constraints beyond these.

## Brand Commitments

- Name: "Social Media Downloader" (abbreviated SMD); README describes it as "modular, high-fidelity".
- Icon asset: `assets/icons/icon.svg` (sizes referenced as `assets/icons/icon32.png` in the popup).
- No visual style, palette, or typography is contractually binding; UI work has design freedom subject to the repo rules and the constraints above.

## Evidence on Hand

- Bilingual READMEs (English, pt-BR) at repo root describing capabilities, download structure, and privacy posture.
- Per-platform architecture documentation under `docs/platforms/{instagram,facebook,reddit}/`.
- Sanitized HAR regression fixtures and a HAR validation gate (`bun run check:har`); private captures stay in gitignored `fixtures-private/`.
- Existing implementation: `src/popup/` (popup.html/css/js), `src/core/`, `src/plugins/`, `src/background/`, `src/content/`, `src/offscreen/`.
- Absences future work must not fabricate: no testimonials, user quotes, benchmarks, press, pricing, or usage statistics exist anywhere in the repo.

## Product Principles

1. Fidelity over convenience: never re-encode, recompress, or substitute a lower-resolution variant when the original is reachable.
2. Local by default: every byte of scanning, resolution, muxing, and packaging happens in the user's browser; no external dependency may creep in.
3. Isolation preserves reliability: platform complexity stays inside its plugin; shared infrastructure stays generic — that separation is what keeps three fragile platforms fixable independently.
4. Trust is part of the product: minimal permissions, no secret logging, and honest empty/error states (a zero-result scan is not a success) are features, not overhead.
5. Works in the user's language: locale parity across all 22 languages is a correctness requirement, equal in weight to functional correctness.

## Accessibility & Inclusion

- All 22 locales must render correctly: no fixed dimensions justified by English text; tolerate longer/shorter translations, plural differences, and reordered phrases.
- No product-specific WCAG conformance requirement was established; apply standard accessible-extension practices (keyboard operability, contrast, screen-reader semantics) without inventing a binding standard.
