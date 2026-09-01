# Facebook — Debugging

1. Confirm detection (`getPageContext()` / registry).
2. Check health via `validateEnvironment` / `selfTest`.
3. Inspect `facebook:scanner` / `facebook:graphql` logs.
4. Validate compact fixtures with `bun run check:fixtures`; use
   `bun run validate:raw` for explicit raw HAR replay when a local capture is
   available.
5. Reproduce offline from `tests/fixtures/extracted/facebook/`; add a
   regression test (`tests/integration/fb-fullres.test.js`).
6. For multi-tab / source-tab issues, capture a HAR across the tab transitions,
   sanitize it, and isolate the fix in `FacebookNormalizer` / `content.js`.

Do not rewrite the extractor on a hunch (AGENTS §87, §88); isolate drift to
selectors / GraphQL operation names inside the plugin (SPEC §76).
