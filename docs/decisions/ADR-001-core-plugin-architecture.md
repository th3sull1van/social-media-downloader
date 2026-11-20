# ADR-001: Core / Plugin Modular Architecture

## Status
Accepted

## Context
Merging multiple single-platform extensions into one monolith often leads to brittle code where changes to one site break other sites. We needed an architecture that isolates platform-specific logic while centralizing generic extension workflows.

## Decision
Separate the extension into **Core** (application lifecycle, download queue, ZIP packaging, UI, storage, messaging, diagnostics) and **Plugins** (Instagram, Facebook, Reddit). Core contains zero site-specific conditionals.

## Alternatives Considered
- Ship three separate extensions: duplicates download queueing, ZIP packaging, i18n, and offscreen lifecycle across three codebases.
- Combine all sites in a single pipeline with `if (platform === ...)` branches in Core: faster initially, but couples unrelated site drift and breaks mechanical dependency checks.

## Consequences
- Site changes and DOM drift are contained strictly within their respective plugin directory.
- New platforms can be added without modifying Core or existing plugins.
