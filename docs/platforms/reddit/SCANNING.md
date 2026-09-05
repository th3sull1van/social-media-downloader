# Reddit — Scanning

- **Dual-layer discovery:** `RedditScanner.js` scans both the server-rendered
  shreddit DOM (`extractFromShredditPost`) and the public JSON API
  (`fetchSubredditPosts`, `fetchUserSubmissions`, `fetchPostById`).
- **Normalization:** `RedditNormalizer.js` cleans preview URLs, extracts media
  hashes, and detects galleries / videos / RedGifs embeds.
- **Galleries:** DOM `gallery-carousel` and `gallery_data`/`media_metadata`
  paths, preserving ordering (SPEC §88).
- **Cross-post dedup:** `processing.deduplication` removes repeated media across
  reposts/cross-posts. The normalizer supplies an opaque origin/type/media key and
  score priority to the shared selector (SPEC §48). Filename IDs are independent.
  Recognized Reddit, RedGifs and Imgur routes use stable identities; unknown origins
  retain the full URL including its query. Missing identities remain separate.
  The highest score wins without mutating input metadata; subreddit membership is
  combined on the returned item.
- **Capabilities:** `scan.page/post/profile/subreddit`, `scan.pagination`,
  `media.image/gallery/video/audio`, and media-processing capabilities.
- **Message routing:** Reddit scan work is served to the service worker through
  the plugin (`handleMessage('REDDIT_SCAN')`), keeping the SW platform-neutral.
