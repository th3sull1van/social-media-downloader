# Reddit — Scanning

- **Dual-layer discovery:** `RedditScanner.js` scans both the server-rendered
  shreddit DOM (`extractFromShredditPost`) and the public JSON API
  (`fetchSubredditPosts`, `fetchUserSubmissions`, `fetchPostById`).
- **Normalization:** `RedditNormalizer.js` cleans preview URLs, extracts media
  hashes, and detects galleries / videos / RedGifs embeds.
- **Galleries:** DOM `gallery-carousel` and `gallery_data`/`media_metadata`
  paths, preserving ordering (SPEC §88).
- **Cross-post dedup:** `processing.deduplication` removes repeated media across
  reposts/cross-posts.
- **Capabilities:** `scan.page/post/profile/subreddit`, `scan.pagination`,
  `media.image/gallery/video/audio`, and media-processing capabilities.
- **Message routing:** Reddit scan work is served to the service worker through
  the plugin (`handleMessage('REDDIT_SCAN')`), keeping the SW platform-neutral.
