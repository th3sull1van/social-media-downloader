# Instagram — Debugging

1. Confirm detection via `InstagramPlugin.matches` / `detectTarget` and inspect live state with `GET_PAGE_STATE`.
2. Inspect namespaced logs (`instagram:scanner`, `instagram:graphql`) and run `tsc --noEmit` to verify types across main-world and content scripts.
3. Validate the compact fixture set with `bun run check:fixtures` and use
   `bun run validate:raw` for explicit raw HAR replay when a local capture is
   available.
4. Reproduce offline from `tests/fixtures/extracted/instagram/` and write a
   regression test (`tests/integration/fixture-replay.test.js`,
   `tests/integration/ig-fullres.test.js`, `tests/integration/instagram-highlights.test.js`).
5. If the site changed, capture a new HAR, sanitize it, and add a fixture before
   touching the plugin (AGENTS §87, §88).

Do not rewrite the extractor on a hunch — isolate drift to selectors / GraphQL
operation names inside the plugin (SPEC §76).
