# ADR-006: Browser-Only Production Runtime

## Status
Accepted

## Context
Extensions should not require users to run external daemons, local HTTP servers, Node.js, or Bun in production.

## Decision
All production code runs directly in Chrome Manifest V3 using native ES Modules and Chrome APIs. Node.js is strictly a development toolchain for running automated tests and validation scripts.

## Consequences
- End users can load the unpacked extension directly into any Chromium browser.
