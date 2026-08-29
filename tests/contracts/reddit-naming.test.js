/**
 * Social Media Downloader — Reddit Naming Regression Tests
 * Guards the filename conventions for Reddit media:
 *  - images use a sanitized mediaId with the correct extension;
 *  - the relative path template renders subreddit/author/id/filename correctly;
 *  - filenames remain filesystem-safe (no traversal, no reserved names, no control chars);
 *  - DASH videos fall back to .mp4 and gallery items still resolve a clean identifier.
 */
import assert from 'node:assert';
import { RedditNaming } from '../../src/plugins/reddit/RedditNaming.js';

function makeItem(overrides = {}) {
  return /** @type {any} */ ({
    id: 'post_abc123',
    platform: 'reddit',
    type: 'image',
    sourceType: 'reddit_image',
    url: 'https://i.redd.it/example.jpg',
    downloadUrl: 'https://i.redd.it/example.jpg',
    metadata: {
      mediaId: 'media_xyz789',
      postId: 'post_abc123',
      subreddit: 'pics',
      author: 'example_user'
    },
    ...overrides
  });
}

export async function runRedditNamingTests() {
  // 1. Plain image keeps sanitized mediaId + jpg.
  {
    const item = makeItem();
    const name = RedditNaming.getOriginalFilename(item);
    assert.strictEqual(name, 'media_xyz789.jpg', `expected media_xyz789.jpg, got ${name}`);
  }

  // 2. DASH video uses .mp4 fallback when extension is missing.
  {
    const item = makeItem({ type: 'video', downloadUrl: 'https://v.redd.it/dash/foo.mpd' });
    delete item.extension;
    const name = RedditNaming.getOriginalFilename(item);
    assert.strictEqual(name, 'media_xyz789.mp4', `expected media_xyz789.mp4, got ${name}`);
  }

  // 3. mediaId missing in metadata falls back to normalizer extraction.
  {
    const item = makeItem();
    delete item.metadata.mediaId;
    item.id = 'post_extracted001';
    const name = RedditNaming.getOriginalFilename(item);
    assert.ok(name.endsWith('.jpg'), `expected .jpg extension, got ${name}`);
    assert.ok(!name.includes('..'), `filename must not contain .., got ${name}`);
  }

  // 4. Path traversal in subreddit is sanitized.
  {
    const item = makeItem();
    item.metadata.subreddit = '../../../etc';
    const path = RedditNaming.resolveRelativePath(item);
    assert.ok(!path.includes('..'), `path must not contain .., got ${path}`);
    // The sanitizer strips / and leading dots, so 'etc' is the safe remainder.
    assert.ok(path.includes('r_etc/'), `subreddit traversal must be reduced, got ${path}`);
  }

  // 5. Default path template uses subreddit + author + id.
  {
    const item = makeItem();
    const path = RedditNaming.resolveRelativePath(item);
    assert.ok(path.includes('pics'), `path should include subreddit pics, got ${path}`);
    assert.ok(path.includes('example_user'), `path should include author, got ${path}`);
  }

  // 6. Reserved Windows names are sanitized.
  {
    const item = makeItem();
    item.metadata.mediaId = 'CON';
    const name = RedditNaming.getOriginalFilename(item);
    assert.notStrictEqual(name.toUpperCase().startsWith('CON.'), true, `CON must be sanitized, got ${name}`);
  }

  // 7. Control characters in subreddit do not leak into path.
  {
    const item = makeItem();
    item.metadata.subreddit = 'pics\n\r\t';
    const path = RedditNaming.resolveRelativePath(item);
    assert.ok(!/[\n\r\t]/.test(path), `path must not contain control chars, got ${JSON.stringify(path)}`);
    // The sanitizer collapses to a single underscore-separated token.
    assert.ok(path.includes('pics'), `subreddit should still be recognizable, got ${path}`);
  }

  // 8. Gallery items still resolve a filename with the gallery id.
  {
    const item = makeItem({
      type: 'gallery',
      sourceType: 'reddit_gallery',
      metadata: {
        mediaId: 'gallery_001',
        postId: 'post_gallery_001',
        galleryId: 'gallery_001',
        subreddit: 'galleries',
        author: 'example_user'
      }
    });
    const name = RedditNaming.getOriginalFilename(item);
    assert.ok(name.startsWith('gallery_001'), `expected gallery_001 prefix, got ${name}`);
  }
}
