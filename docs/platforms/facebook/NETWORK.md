# Facebook — Network

- **GraphQL interception & navigation bridge:** `src/plugins/facebook/main-world/injected.js`
  intercepts `fetch` (`string`/`URL`/`Request`) and text `XMLHttpRequest`
  GraphQL responses (`SMD_FB_BATCH_PHOTOS`) and drives in-page `CometRouter`
  navigation (`NAVIGATE_FB_TAB`), rather than issuing standalone signed GraphQL
  queries with harvested tokens.
- **CDN helpers:** `src/plugins/meta-shared/MetaCdn.js` handles `fbcdn.net`
  upscaling to full resolution.
- **Host permissions:** `*://*.facebook.com/*`, `*://*.fbcdn.net/*`.
- **Multi-tab behavior:** the content script tracks album/collection tabs and
  keeps source-tab identity across navigations.

Credentials/cookies are never committed or logged. Raw captures go through the
sanitized HAR workflow; routine tests consume compact projections under
`tests/fixtures/extracted/facebook/` (SPEC §79–§80).
