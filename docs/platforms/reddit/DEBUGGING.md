# Reddit — Debugging

1. Confirm detection (`RedditDetector` / `registry.detect`).
2. Inspect `reddit:parser`, `reddit:dash`, `reddit:redgifs`, `reddit:profile`
   logs and verify types via `tsc --noEmit`.
3. Validate compact fixtures with `bun run check:fixtures`; use
   `bun run validate:raw` for explicit raw HAR replay when a local capture is
   available.
4. Reproduce a scanner bug offline from
   `tests/fixtures/extracted/reddit/` (`tests/reddit/scanner.test.js`) and add a
   regression.
5. DASH/mux issues: verify stream discovery in `RedditVideoMuxer` and the
   RedGifs bearer-token flow in `RedGifsResolver`; a 403 from the JSON API means
   the NSFW/quarantined fallback (`redditDomFallback`) must engage.

Do not rewrite the parser on a hunch; isolate drift to selectors / JSON schema
inside the plugin (AGENTS §87, §88, SPEC §76).
