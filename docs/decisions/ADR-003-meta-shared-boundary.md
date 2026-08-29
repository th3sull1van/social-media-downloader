# ADR-003: Meta Shared Layer Boundary

## Status
Accepted

## Context
Instagram and Facebook share identical token calculations (`jazoest` from `fb_dtsg`), similar GraphQL query structures, and CDN thumbnail path encoding conventions.

## Decision
Place genuinely shared utilities in `src/plugins/meta-shared/` (`MetaCdn.js`,
`MetaNode.js`). Only `instagram` and `facebook` plugins (and the content
script, via lazy `import()`) may use this layer. Core and Reddit cannot import it.

## Consequences
- Eliminates duplication of reverse-engineered Meta primitives while maintaining strict architectural boundaries.
