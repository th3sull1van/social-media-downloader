# ADR-002: Independent First-Class Platform Plugins

## Status
Accepted

## Context
Instagram and Facebook both belong to Meta and use similar GraphQL backends. Combining them into a single `MetaPlugin` would create coupling between two very different user experiences and DOM structures.

## Decision
Treat Instagram, Facebook, and Reddit as three independent first-class plugins under `src/plugins/instagram/`, `src/plugins/facebook/`, and `src/plugins/reddit/`.

## Alternatives Considered
- Single `MetaPlugin` parameterized by hostname: forces Instagram stories/highlights and Facebook Comet album DOM harvesting into a shared state machine, increasing regression risk when one site changes.
- Inheritance hierarchy with a shared `BaseSocialPlugin` class: hides capability differences instead of declaring them explicitly via `CapabilitiesModel`.

## Consequences
- Instagram retains its specialized story, highlight, and carousel scanning without polluting Facebook album logic.
- Reddit retains its specialized DASH multiplexer, RedGifs resolver, and cross-post deduplicator.
- Plugins never directly depend on or import each other.
