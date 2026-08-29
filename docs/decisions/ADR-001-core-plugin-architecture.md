# ADR-001: Core / Plugin Modular Architecture

## Status
Accepted

## Context
Merging multiple single-platform extensions into one monolith often leads to brittle code where changes to one site break other sites. We needed an architecture that isolates platform-specific logic while centralizing generic extension workflows.

## Decision
Separate the extension into **Core** (application lifecycle, download queue, ZIP packaging, UI, storage, messaging, diagnostics) and **Plugins** (Instagram, Facebook, Reddit). Core contains zero site-specific conditionals.

## Consequences
- Site changes and DOM drift are contained strictly within their respective plugin directory.
- New platforms can be added without modifying Core or existing plugins.
