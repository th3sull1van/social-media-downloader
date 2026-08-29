# Contributing to Social Media Downloader

Thank you for your interest in contributing to Social Media Downloader!

## Architectural Principles

1. **Merge infrastructure, not platform behavior.**
2. **Preserve working site functionality.**
3. **Core must NEVER contain platform-specific code or conditionals.**
4. **Plugins must not depend directly on each other.**
5. **All user-facing strings must be localized across all supported languages in `_locales/`.**

## Workflow

1. Create a feature branch.
2. Implement your changes following the modular architecture.
3. Run the complete validation gate:
   ```bash
   bun run validate:local
   ```
   This runs fixture safety/inventory, typecheck, the full test suite, and all architectural, manifest, and i18n checks. Platform or network changes must also replay the relevant HAR scenarios and record the fixture and result in the pull request.

   CI-safe validation uses only sanitized versioned fixtures under `tests/fixtures/har/`. Private captures under `fixtures-private/` may support local replay but cannot satisfy CI coverage.

   For a platform change, run:
   ```bash
   bun tests/integration/har-replay.test.js
   bun tests/integration/har-replay-platforms.test.js
   ```
4. Submit a Pull Request.
