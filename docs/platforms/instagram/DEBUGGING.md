# Instagram — Debugging

1. Confirm the plugin is detected (`getPageContext().target` / registry).
2. Check plugin health via `validateEnvironment` / `selfTest`.
3. Inspect namespaced logs (`instagram:scanner`, `instagram:graphql`).
4. Replay the HAR fixture with `bun run check:har` / `bun run har:compare`.
5. Reproduce offline from a sanitized fixture and write a regression test
   (`tests/fixtures/har/instagram/`, `tests/integration/ig-fullres.test.js`).
6. If the site changed, capture a new HAR, sanitize it, and add a fixture before
   touching the plugin (AGENTS §87, §88).

Do not rewrite the extractor on a hunch — isolate drift to selectors / GraphQL
operation names inside the plugin (SPEC §76).
