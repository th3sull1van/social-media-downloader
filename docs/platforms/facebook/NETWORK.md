# Facebook — Network

- **GraphQL transport & session tokens:** performed where the requests are
  actually issued — content/main-world contexts harvest `fb_dtsg`, `jazoest`,
  `csrftoken`, `appId` from the page. Sensitive — never logged.
- **CDN helpers:** `src/plugins/meta-shared/MetaCdn.js` handles `fbcdn.net`
  upscaling to full resolution.
- **Host permissions:** `*://*.facebook.com/*`, `*://*.fbcdn.net/*`.
- **Multi-tab behavior:** the content script tracks album/collection tabs and
  keeps source-tab identity across navigations.

Credentials/cookies are never committed or logged. Raw captures go through the
sanitized HAR workflow; routine tests consume compact projections under
`tests/fixtures/extracted/facebook/` (SPEC §79–§80).
