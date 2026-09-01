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
   This runs compact-fixture safety/inventory, typecheck, the full test suite, and all architectural, manifest, and i18n checks. Platform or network changes must also run the relevant raw HAR evidence gate when a local capture is available and record the fixture and result in the pull request.

   Routine CI-safe validation uses the versioned compact fixtures under `tests/fixtures/extracted/` and the public HAR inventory under `tests/fixtures/har/`. Private captures under `fixtures-private/` are optional local evidence and cannot satisfy CI coverage.

   For a platform or network change with local captures, run:
   ```bash
   bun run validate:raw
   ```
   If the changed response shape is not represented, generate the smallest allowlisted fixture with `bun run fixtures:extract` and validate it with `bun run check:fixtures`.
4. Submit a Pull Request.
