# Instagram — Network

- **GraphQL transport & session tokens:** performed where the requests are
  actually issued — content/main-world contexts harvest `fb_dtsg`, `jazoest`,
  `csrftoken` and `appId` from the page. Sensitive — never logged
  (AGENTS §34, §134).
- **CDN helpers:** `src/plugins/meta-shared/MetaCdn.js` handles Instagram CDN
  URLs and full-resolution upscaling.
- **Host permissions:** `*://*.instagram.com/*`, `*://*.cdninstagram.com/*`.
- Credentials and cookies are never committed or logged. Raw HARs are source
  evidence; routine tests use the sanitized compact projections under
  `tests/fixtures/extracted/` (SPEC §79–§80).
- Highlights use `PolarisProfileStoryHighlightsTrayContentQuery`, then
  `PolarisStoriesV3HighlightsPageQuery` (doc ID `28730445686541844`) in
  three-reel windows. The observed response is
  `data.xdt_api__v1__feed__reels_media__connection.edges[].node.items`.
  The older REST `feed/reels_media` request remains a fallback; the capture
  does not establish that this endpoint was removed.
