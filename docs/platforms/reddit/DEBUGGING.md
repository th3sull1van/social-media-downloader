# Reddit — Debugging

1. Confirm detection (`RedditDetector` / `registry.detect`).
2. Check health via `validateEnvironment` / `selfTest`.
3. Inspect `reddit:parser`, `reddit:dash`, `reddit:redgifs`, `reddit:profile`
   logs.
4. Validate compact fixtures with `bun run check:fixtures`; use
   `bun run validate:raw` for explicit raw HAR replay when a local capture is
   available.
5. Reproduce a scanner bug offline from
   `tests/fixtures/extracted/reddit/` (`tests/reddit/scanner.test.js`) and add a
   regression.
6. DASH/mux issues: verify stream discovery in `RedditVideoMuxer` and the
   RedGifs bearer-token flow in `RedGifsResolver`; a 403 from the JSON API means
   the NSFW/quarantined fallback (`redditDomFallback`) must engage.

Do not rewrite the parser on a hunch; isolate drift to selectors / JSON schema
inside the plugin (AGENTS §87, §88, SPEC §76).
