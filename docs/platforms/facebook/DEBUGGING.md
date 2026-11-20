# Facebook — Debugging

1. Confirm detection via `FacebookPlugin.matches` / `detectTarget` and inspect live state with `GET_PAGE_STATE`.
2. Inspect `facebook:scanner` / `facebook:graphql` logs and verify content/main-world types via `tsc --noEmit`.
3. Validate compact fixtures with `bun run check:fixtures`; use
   `bun run validate:raw` for explicit raw HAR replay when a local capture is
   available.
4. Reproduce offline from `tests/fixtures/extracted/facebook/`; add a
   regression test (`tests/integration/fb-fullres.test.js`).
5. For multi-tab / source-tab issues, capture a HAR across the tab transitions,
   sanitize it, and isolate the fix in `FacebookNormalizer` / `content.js`.

Do not rewrite the extractor on a hunch (AGENTS §87, §88); isolate drift to
selectors / GraphQL operation names inside the plugin (SPEC §76).
