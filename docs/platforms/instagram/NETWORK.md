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
