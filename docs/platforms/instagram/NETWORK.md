# Instagram — Network

- **GraphQL transport & session tokens:** performed where the requests are
  actually issued — content/main-world contexts harvest `fb_dtsg`, `jazoest`,
  `csrftoken`, `lsd` and `appId` from the page. Sensitive — never logged
  (AGENTS §34, §134).
- **CDN helpers:** `src/plugins/meta-shared/MetaCdn.js` handles Instagram CDN
  URLs and full-resolution upscaling.
- **Host permissions:** `*://*.instagram.com/*`, `*://*.cdninstagram.com/*`.
- Credentials and cookies are never committed or logged. Raw HARs are source
  evidence; routine tests use the sanitized compact projections under
  `tests/fixtures/extracted/` (SPEC §79–§80).
- **Profile & timeline posts:** queries `PolarisProfilePageContentQuery`
  (`40158838120366999`, fallbacks `28717443601247930` / `28036671149327607` /
  `28191674790485375`), `PolarisProfilePostsQuery` (`29682302384688964`,
  fallbacks `29156678094015645` / `28379418928391013` / `26519258537772635`),
  and paginated `PolarisProfilePostsTabContentQuery_connection`
  (`29246820014972723`, fallbacks `28544666141895803` / `28975909992013618` /
  `27672504985785333`). Tolerates non-fatal GraphQL `field_exception`
  warnings when all returned edges/items carry intact media.
- **Highlights:** uses `PolarisProfileStoryHighlightsTrayContentQuery`
  (`26970053832668570`, fallback `38168009559465141`), then
  `PolarisStoriesV3HighlightsPageQuery` (primary `28325328583775973`, fallback
  `28730445686541844`) in three-reel windows, plus
  `PolarisStoriesV3HighlightsPagePaginationQuery` (`28338439489156504`). The
  observed response is
  `data.xdt_api__v1__feed__reels_media__connection.edges[].node.items`.
  The older REST `feed/reels_media` request remains a fallback; the capture
  does not establish that this endpoint was removed.
- **Active stories:** queries `PolarisStoriesV3ReelPageStandaloneQuery`
  (`28739385832429456`, fallback `28449850404637481`) first
  (`xdt_api__v1__feed__reels_media.reels_media`) and falls back to REST
  `api/v1/feed/reels_media/` when GraphQL fails.
