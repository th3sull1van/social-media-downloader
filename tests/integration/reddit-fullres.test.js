/**
 * Social Media Downloader — Reddit Maximum Resolution Extraction Tests
 * Validates that media normalizers and scanners extract original high-resolution assets:
 * - Uncompressed i.redd.it images upgraded from preview.redd.it
 * - Full-resolution gallery items using original media metadata
 * - Native Reddit DASH video streams with companion audio pairing
 * - RedGifs high-definition (HD / 1080p) video resolution
 * - HAR replay against captured Reddit traffic
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { RedditNormalizer } from '../../src/plugins/reddit/RedditNormalizer.js';
import { RedditScanner } from '../../src/plugins/reddit/RedditScanner.js';
import { RedGifsResolver } from '../../src/plugins/reddit/RedGifsResolver.js';
import { extractRedditPosts } from '../../tools/har-replay.js';

import { makeElement, parseOpenTag } from '../../tools/mini-dom.js';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const REDDIT_HARS = [
  path.join(rootDir, 'tests/fixtures/har/reddit/example-feed.har'),
  path.join(rootDir, 'fixtures-private/reddit-feed.har'),
  path.join(rootDir, 'fixtures-private/reddit-post.har'),
  path.join(rootDir, 'fixtures-private/reddit-empty-profile.har')
].filter((p) => fs.existsSync(p));

export async function runRedditFullResTests() {
  // 1. Preview URL cleanup & upgrade to original uncompressed i.redd.it
  {
    const previewJpeg = 'https://preview.redd.it/18n1g1n8o79e1.jpg?width=640&crop=smart&auto=webp&s=6f9037c223fa8';
    assert.equal(
      RedditNormalizer.cleanMediaUrl(previewJpeg),
      'https://i.redd.it/18n1g1n8o79e1.jpg',
      'preview.redd.it JPG must upgrade to clean uncompressed i.redd.it original'
    );

    const previewPng = 'https://preview.redd.it/samplemedia123.png?width=1080&format=pjpg&auto=webp&s=abcdef123';
    assert.equal(
      RedditNormalizer.cleanMediaUrl(previewPng),
      'https://i.redd.it/samplemedia123.png',
      'preview.redd.it PNG must upgrade to clean uncompressed i.redd.it original'
    );

    const externalPreview = 'https://external-preview.redd.it/abcxyz.jpg?width=640&crop=smart&auto=webp&s=123';
    assert.equal(
      RedditNormalizer.cleanMediaUrl(externalPreview),
      'https://external-preview.redd.it/abcxyz.jpg',
      'external-preview query parameters must be stripped'
    );
  }

  // 2. Multi-image gallery extraction in maximum original resolution
  {
    const galleryPost = {
      id: 'post_gal_1',
      title: 'Awesome Gallery Post',
      author: 'redditor_1',
      subreddit: 'pics',
      score: 1500,
      is_gallery: true,
      gallery_data: {
        items: [
          { media_id: 'img_slide_1', id: 101 },
          { media_id: 'img_slide_2', id: 102 }
        ]
      },
      media_metadata: {
        img_slide_1: {
          status: 'valid',
          e: 'Image',
          m: 'image/jpg',
          s: { y: 2048, x: 1536, u: 'https://preview.redd.it/img_slide_1.jpg?width=1536&amp;format=pjpg&amp;auto=webp&amp;s=abc' }
        },
        img_slide_2: {
          status: 'valid',
          e: 'Image',
          m: 'image/png',
          s: { y: 1080, x: 1920, u: 'https://preview.redd.it/img_slide_2.png?width=1920&amp;format=pjpg&amp;auto=webp&amp;s=def' }
        }
      }
    };

    const items = RedditScanner.parseApiPostObject(galleryPost);
    assert.equal(items.length, 2, 'Must extract 2 gallery items');
    assert.equal(items[0].downloadUrl, 'https://i.redd.it/img_slide_1.jpg', 'Slide 1 must point to original i.redd.it');
    assert.equal(items[1].downloadUrl, 'https://i.redd.it/img_slide_2.png', 'Slide 2 must point to original i.redd.it');
    assert.equal(items[0].metadata?.isGallery, true);
    assert.equal(items[1].metadata?.isGallery, true);
  }

  // 3. Reddit native DASH video stream resolution & audio pairing
  {
    const videoPost = {
      id: 'video_post_1',
      title: 'Amazing 1080p Clip',
      author: 'videomaker',
      subreddit: 'videos',
      score: 3200,
      is_video: true,
      media: {
        reddit_video: {
          fallback_url: 'https://v.redd.it/samplevid123/DASH_1080.mp4?source=fallback',
          height: 1080,
          width: 1920,
          scrubber_media_url: 'https://v.redd.it/samplevid123/DASH_96.mp4',
          dash_url: 'https://v.redd.it/samplevid123/DASHPlaylist.mpd',
          hls_url: 'https://v.redd.it/samplevid123/HLSPlaylist.m3u8',
          is_gif: false
        }
      }
    };

    const items = RedditScanner.parseApiPostObject(videoPost);
    assert.equal(items.length, 1);
    const item = items[0];
    assert.equal(item.type, 'video');
    assert.equal(item.metadata?.baseUrl, 'https://v.redd.it/samplevid123');
    assert.equal(item.downloadUrl, 'https://v.redd.it/samplevid123/DASH_1080.mp4?source=fallback');
  }

  // 4. RedGifs HD resolution extraction
  {
    const anyGlobal = /** @type {any} */ (globalThis);
    const originalFetch = anyGlobal.fetch;
    try {
      anyGlobal.fetch = async (url) => {
        if (String(url).includes('/v2/auth/temporary')) {
          return { ok: true, json: async () => ({ token: 'mock_jwt_token' }) };
        }
        return {
          ok: true,
          status: 200,
          json: async () => ({
            gif: {
              id: 'SampleVideo',
              width: 1920,
              height: 1080,
              duration: 15,
              hasAudio: true,
              urls: {
                hd: 'https://media.redgifs.com/SampleVideo-hd.mp4',
                sd: 'https://media.redgifs.com/SampleVideo-mobile.mp4',
                poster: 'https://media.redgifs.com/SampleVideo-poster.jpg'
              }
            }
          })
        };
      };

      const resolved = await RedGifsResolver.resolve('https://www.redgifs.com/watch/samplevideo');
      assert.equal(resolved.url, 'https://media.redgifs.com/SampleVideo-hd.mp4', 'Resolver must pick HD stream over SD');
      assert.equal(resolved.hdUrl, 'https://media.redgifs.com/SampleVideo-hd.mp4');
      assert.equal(resolved.ext, 'mp4');
      assert.equal(resolved.width, 1920);
      assert.equal(resolved.height, 1080);
    } finally {
      RedGifsResolver._token = null;
      RedGifsResolver._tokenExpiry = 0;
      anyGlobal.fetch = originalFetch;
    }
  }

  // 5. HAR Replay Validation across captured Reddit traffic
  for (const harPath of REDDIT_HARS) {
    const { posts } = extractRedditPosts(harPath);
    for (const p of posts) {
      const openTag = p.html.match(/^<shreddit-post\s([^>]*)>/);
      const parsed = openTag ? parseOpenTag(`<shreddit-post ${openTag[1]}>`) : null;
      if (!parsed) continue;
      const postEl = makeElement(parsed, p.html, 0);
      const postData = RedditScanner.extractFromShredditPost(postEl);
      if (!postData?.mediaItems?.length) continue;

      const postInfo = {
        id: postData.id,
        title: postData.title,
        author: postData.author,
        subreddit: postData.subreddit,
        score: postData.score,
        isGallery: postData.isGallery
      };

      for (const rawItem of postData.mediaItems) {
        const item = RedditNormalizer.normalizeItem(rawItem, postInfo);
        if (item.type === 'image') {
          assert.ok(
            !item.downloadUrl.includes('preview.redd.it'),
            `Item ${item.id} downloadUrl must not retain preview.redd.it downscaled host: ${item.downloadUrl}`
          );
          assert.ok(
            !item.downloadUrl.includes('width='),
            `Item ${item.id} downloadUrl must not retain downscaled width parameter: ${item.downloadUrl}`
          );
        }
      }
    }
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  console.log('Running Reddit full resolution tests...');
  await runRedditFullResTests();
  console.log('✔ Reddit full resolution tests passed.');
}
