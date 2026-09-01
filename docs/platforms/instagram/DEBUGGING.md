# Instagram — Debugging

1. Confirm the plugin is detected (`getPageContext().target` / registry).
2. Check plugin health via `validateEnvironment` / `selfTest`.
3. Inspect namespaced logs (`instagram:scanner`, `instagram:graphql`).
4. Validate the compact fixture set with `bun run check:fixtures` and use
   `bun run validate:raw` for explicit raw HAR replay when a local capture is
   available.
5. Reproduce offline from `tests/fixtures/extracted/instagram/` and write a
   regression test (`tests/integration/fixture-replay.test.js`,
   `tests/integration/ig-fullres.test.js`).
6. If the site changed, capture a new HAR, sanitize it, and add a fixture before
   touching the plugin (AGENTS §87, §88).

Do not rewrite the extractor on a hunch — isolate drift to selectors / GraphQL
operation names inside the plugin (SPEC §76).
