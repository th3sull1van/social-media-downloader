# Facebook — Debugging

1. Confirm detection (`getPageContext()` / registry).
2. Check health via `validateEnvironment` / `selfTest`.
3. Inspect `facebook:scanner` / `facebook:graphql` logs.
4. Replay the sanitized fixture (`bun run check:har`, `bun run har:compare`).
5. Reproduce offline from a fixture; add a regression test
   (`tests/integration/fb-fullres.test.js`).
6. For multi-tab / source-tab issues, capture a HAR across the tab transitions,
   sanitize it, and isolate the fix in `FacebookNormalizer` / `content.js`.

Do not rewrite the extractor on a hunch (AGENTS §87, §88); isolate drift to
selectors / GraphQL operation names inside the plugin (SPEC §76).
