# ADR-008: JSDoc Type Annotations and Static Checking

## Status
Accepted

## Context
Running raw TypeScript requires build/bundling steps, source maps, and compilation tooling, adding barrier to direct Manifest V3 testing.

## Decision
Use standard modern JavaScript (ES2022 / ES Modules) with comprehensive JSDoc type annotations and `checkJs: true` configured via `jsconfig.json` and `tsconfig.json` (so `tsc --noEmit` checks all `src/`, `tests/`, and `tools/`, including browser classic scripts under `src/content/`, `src/popup/`, `src/offscreen/`, and main-world scripts).

## Alternatives Considered
- Author in `.ts` and compile via `tsc`/bundler: adds a mandatory build watch step before reloading unpacked code in Chrome and violates zero-bundler workflow goals.
- Omit static type checking: lets silent shape mismatches across plugin boundaries and DOM/main-world classic scripts slip past unit tests.

## Consequences
- Code runs natively in the browser without any build step.
- IDEs and tooling provide static type checking and autocompletion across both ES module and classic browser scripts.
