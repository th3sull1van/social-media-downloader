# ADR-009: Modular Architecture for Meta and Reddit Media Downloaders

## Status
Accepted

## Context
Merging media downloading capabilities for Instagram, Facebook, and Reddit into a unified Chrome extension required preserving all platform logic without regression.

## Decision
Employ the plugin-based modular pattern:
1. Establish Core infrastructure and domain abstractions.
2. Structure Meta Shared, Instagram, and Facebook logic into clean independent plugins.
3. Structure Reddit DOM parsing, DASH muxing, RedGifs resolution, and deduplication into the Reddit plugin.
4. Unify localization across 22 languages and validate contract parity with automated test suites.

## Consequences
- 100% preservation of site-specific capabilities.
- Unified codebase with zero duplicated download or packaging infrastructure.
