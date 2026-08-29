# ADR-008: JSDoc Type Annotations and Static Checking

## Status
Accepted

## Context
Running raw TypeScript requires build/bundling steps, source maps, and compilation tooling, adding barrier to direct Manifest V3 testing.

## Decision
Use standard modern JavaScript (ES2022 / ES Modules) with comprehensive JSDoc type annotations and `checkJs: true` configured via `jsconfig.json`.

## Consequences
- Code runs natively in the browser without any build step.
- IDEs and tooling provide static type checking and autocompletion.
