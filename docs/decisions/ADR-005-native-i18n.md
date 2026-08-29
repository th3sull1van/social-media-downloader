# ADR-005: Native Chrome i18n & 22 Locales Support

## Status
Accepted

## Context
Chrome extensions provide a built-in localization mechanism (`_locales/`) that is light, zero-dependency, and well-integrated into the manifest and browser runtime.

## Decision
Use Chrome's native i18n system with unified keys across 22 supported locales. Provide automated validation (`bun run check:i18n`) to enforce key parity and placeholder integrity.

## Consequences
- Zero third-party runtime dependencies for localization.
- UI elements declare `data-i18n` attributes for instant client-side translation.
