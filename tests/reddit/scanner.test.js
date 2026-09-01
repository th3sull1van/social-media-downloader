/**
 * Social Media Downloader — RedditScanner Tests
 * Covers: parseApiPostObject (gallery/video/redgifs/image), pagination fetches with a stubbed
 * global fetch, and cleanMediaUrl preview upgrade.
 */
import assert from 'node:assert';
import path from 'node:path';
import { RedditScanner } from '../../src/plugins/reddit/RedditScanner.js';
import { RedditPlugin } from '../../src/plugins/reddit/RedditPlugin.js';
import { RedditMessages } from '../../src/plugins/reddit/RedditMessages.js';
import { readCompactFixture } from '../../tools/fixture-replay.js';

/** Alias for installing test fetch doubles without fighting lib.dom typings. */
const anyFetch = /** @type {any} */ (globalThis);

export async function runRedditScannerTests() {
  const originalFetch = globalThis.fetch;

  try {
    // 1. Gallery post parsing
    {
      const post = {
        id: 'abc123',
        title: 'Gallery Post',
        author: 'alice',
        subreddit: 'pics',
        score: 42,
        is_gallery: true,
        gallery_data: {
          items: [
            { media_id: 'img1' },
            { media_id: 'img2' }
          ]
        },
        media_metadata: {
          img1: { m: 'image/jpg', s: { u: 'https://preview.redd.it/img1.jpg?width=1080&auto=webp&s=abc' } },
          img2: { m: 'image/png', s: { u: 'https://preview.redd.it/img2.png?width=640&auto=webp&s=def' } }
        }
      };

      const items = RedditScanner.parseApiPostObject(post);
      assert.strictEqual(items.length, 2);
      assert.strictEqual(items[0].url, 'https://i.redd.it/img1.jpg');
      assert.strictEqual(items[1].extension, 'png');
      assert.strictEqual(items[0].metadata.subreddit, 'pics');
      assert.strictEqual(items[0].metadata.index, 1);
      assert.strictEqual(items[0].metadata.total, 2);
      assert.strictEqual(items[0].capabilities.directDownload, true);
    }

    // 2. Native video parsing (DASH metadata present for the muxing path)
    {
      const post = {
        id: 'vid1',
        title: 'Video Post',
        author: 'bob',
        subreddit: 'videos',
        is_video: true,
        media: {
          reddit_video: {
            fallback_url: 'https://v.redd.it/vidid123/DASH_720.mp4?source=fallback',
            dash_url: 'https://v.redd.it/vidid123/DASHPlaylist.mpd'
          }
        }
      };

      const items = RedditScanner.parseApiPostObject(post);
      assert.strictEqual(items.length, 1);
      const item = items[0];
      assert.strictEqual(item.type, 'video');
      assert.strictEqual(item.metadata.baseUrl, 'https://v.redd.it/vidid123');
      assert.strictEqual(item.metadata.fallbackUrl, 'https://v.redd.it/vidid123/DASH_720.mp4?source=fallback');
      assert.strictEqual(item.capabilities.requiresMuxing, true);
      assert.strictEqual(item.capabilities.directDownload, false);
    }

    // 3. RedGifs embed parsing
    {
      const post = {
        id: 'rg1',
        title: 'RG Post',
        subreddit: 'gifs',
        url: 'https://www.redgifs.com/watch/somegif'
      };

      const items = RedditScanner.parseApiPostObject(post);
      assert.strictEqual(items.length, 1);
      assert.strictEqual(items[0].sourceType, 'redgifs');
      assert.strictEqual(items[0].metadata.isRedGifs, true);
    }

    // 4. Direct image parsing (i.redd.it)
    {
      const post = {
        id: 'img9',
        title: 'Image',
        subreddit: 'itap',
        url: 'https://i.redd.it/photo9.jpg'
      };

      const items = RedditScanner.parseApiPostObject(post);
      assert.strictEqual(items.length, 1);
      assert.strictEqual(items[0].url, 'https://i.redd.it/photo9.jpg');
      assert.strictEqual(items[0].extension, 'jpg');
    }

    // 5. Text-only post yields no media
    {
      const items = RedditScanner.parseApiPostObject({
        id: 'txt1', title: 'Text only', subreddit: 'askreddit', selftext: 'hello'
      });
      assert.strictEqual(items.length, 0);
    }

    // 6. fetchSubredditPosts: pagination + raw_json + dedup of crossposted identical media
    {
      let callCount = 0;
      const requestedUrls = [];
      anyFetch.fetch = async (url) => {
        callCount++;
        requestedUrls.push(url);
        const page = callCount;
        return {
          ok: true,
          json: async () => ({
            data: {
              after: page === 1 ? 't3_page2token' : null,
              children: [
                {
                  data: {
                    id: `p${page}a`, title: 'A', author: 'u1', subreddit: 'sub',
                    url: `https://i.redd.it/unique_${page}_a.jpg`
                  }
                },
                {
                  data: {
                    id: `p${page}b`, title: 'B', author: 'u2', subreddit: 'sub',
                    url: `https://www.redgifs.com/watch/gif_${page}`
                  }
                }
              ]
            }
          })
        };
      };

      const result = await RedditScanner.fetchSubredditPosts('sub', { limit: 300 });
      assert.strictEqual(callCount, 2, 'should paginate until after=null');
      assert.strictEqual(result.items.length, 4);
      assert.strictEqual(result.totalPosts, 4);
      assert.ok(requestedUrls[0].includes('/r/sub/hot.json?limit=100&raw_json=1'));
      assert.ok(requestedUrls[1].includes('&after=t3_page2token'));
      const redgifs = result.items.filter((i) => i.sourceType === 'redgifs');
      assert.strictEqual(redgifs.length, 2);
    }

    // 7. fetchPostById: array-shaped listing response
    {
      anyFetch.fetch = async (url) => ({
        ok: true,
        json: async () => [
          {
            data: {
              children: [
                {
                  data: {
                    id: 'single1', title: 'Single', subreddit: 'pics',
                    url: 'https://i.redd.it/one.jpg'
                  }
                }
              ]
            }
          }
        ]
      });

      const result = await RedditScanner.fetchPostById('single1');
      assert.strictEqual(result.items.length, 1);
      assert.strictEqual(result.items[0].metadata.postId, 'single1');
    }

    // 8. fetchUserSubmissions keeps working (sanity after URL encoding change)
    {
      anyFetch.fetch = async () => ({
        ok: true,
        json: async () => ({
          data: {
            after: null,
            children: [
              { data: { id: 'u1', title: 'T', subreddit: 's', url: 'https://i.redd.it/aa.jpg' } }
            ]
          }
        })
      });

      const result = await RedditScanner.fetchUserSubmissions('some_user');
      assert.strictEqual(result.totalPosts, 1);
      assert.strictEqual(result.mediaItems.length, 1);
    }

    // 9. A profile with empty submitted.json still discovers indexed author posts.
    {
      const fixture = readCompactFixture(path.resolve('tests/fixtures/extracted/reddit/reddit-private-profile.json'));
      const requestedUrls = [];
      anyFetch.fetch = async (url) => {
        requestedUrls.push(String(url));
        const listing = String(url).includes('/search.json') ? fixture.search : fixture.submitted;
        return { ok: true, json: async () => listing };
      };

      const result = await RedditScanner.fetchUserSubmissions(fixture.username, { limit: 200 });
      assert.strictEqual(result.totalPosts, fixture.expected.totalPosts);
      assert.strictEqual(result.mediaItems.length, fixture.expected.totalPosts);
      assert.ok(requestedUrls.some((url) => url.includes(`/search.json?q=author%3A${fixture.username}`)));
      assert.deepStrictEqual(result.mediaItems.map((item) => item.metadata.postId), fixture.expected.postIds);
    }

    // 10. Network failure is not silently treated as success
    {
      anyFetch.fetch = async () => ({ ok: false, status: 403 });
      const result = await RedditScanner.fetchSubredditPosts('private', {});
      assert.strictEqual(result.items.length, 0);
      assert.strictEqual(result.totalPosts, 0);
      assert.strictEqual(result.status, 'network_failure');
      assert.strictEqual(result.errorCode, 'REDDIT_API_HTTP_ERROR');
    }

    // 11. Profile/community avatars come from the target about endpoint and
    // are distinct from post media (the DOM may expose them as SVG <image>).
    {
      const requestedUrls = [];
      anyFetch.fetch = async (url) => {
        requestedUrls.push(String(url));
        return {
          ok: true,
          json: async () => ({
            data: {
              snoovatar_img: '',
              icon_img: 'https://www.redditstatic.com/avatars/defaults/v2/avatar_default_3.png'
            }
          })
        };
      };

      const avatar = await RedditScanner.fetchTargetAvatar('user', 'avatar_user');
      assert.strictEqual(avatar, 'https://www.redditstatic.com/avatars/defaults/v2/avatar_default_3.png');
      assert.ok(requestedUrls[0].includes('/user/avatar_user/about.json?raw_json=1'));
      assert.strictEqual(await RedditScanner.fetchTargetAvatar(/** @type {any} */ ('post'), 'abc'), '');
    }

    // 12. Subreddit/community/user icon style assets must NOT become media items.
    //     These leak into `img[src*=redditmedia.com]` DOM queries and would otherwise
    //     be downloaded as decorative avatars (see HAR analysis of reddit-feed fixtures).
    {
      assert.strictEqual(RedditScanner.isIconOrStyleAsset('https://styles.redditmedia.com/t5_abc/styles/profileIcon_xyz123.png'), true);
      assert.strictEqual(RedditScanner.isIconOrStyleAsset('https://styles.redditmedia.com/t5_abc/styles/communityIcon_xyz123.jpg'), true);
      // Real media must survive the guard.
      assert.strictEqual(RedditScanner.isIconOrStyleAsset('https://i.redd.it/photo9.jpg'), false);
      assert.strictEqual(RedditScanner.isIconOrStyleAsset('https://preview.redd.it/photo9.jpg?width=1080'), false);
      assert.strictEqual(RedditScanner.isIconOrStyleAsset('https://www.redgifs.com/watch/somegif'), false);

      // DOM extraction: a shreddit-post whose only redditmedia image is a profile icon
      // must yield zero media items, not an icon download.
      const fakePostEl = {
        getAttribute: (name) => ({ id: 't3_iconpost', 'post-type': 'image', author: 'u1', 'subreddit-name': 'sub' }[name] || null),
        querySelector: (sel) => {
          if (sel.includes('img')) return { getAttribute: () => 'https://styles.redditmedia.com/t5_abc/styles/profileIcon_xyz123.png' };
          return null;
        },
        querySelectorAll: () => [],
        hasAttribute: () => false,
        shadowRoot: null
      };
      const data = RedditScanner.extractFromShredditPost(fakePostEl);
      assert.strictEqual(data.mediaItems.length, 0, 'profile icon must not become a media item');
    }

    // 13. Platform message delegation: RedditPlugin.handleMessage routes
    //     REDDIT_SCAN / RESOLVE_REDGIFS and returns undefined for generic types,
    //     so the service worker can delegate instead of routing on platform internals.
    {
      anyFetch.fetch = async (url) => {
        const u = String(url);
        if (u.includes('/about.json')) {
          return {
            ok: true,
            json: async () => ({ data: { icon_img: 'https://www.redditstatic.com/avatars/defaults/v2/avatar_default_4.png' } })
          };
        }
        if (u.includes('/gifs/')) {
          return {
            ok: true,
            json: async () => ({ gif: { id: 'somegif', urls: { hd: 'https://example.com/hd.mp4' }, hasAudio: true } })
          };
        }
        return {
          ok: true,
          json: async () => ({ data: { after: null, children: [ { data: { id: 'm1', title: 'T', subreddit: 's', url: 'https://i.redd.it/a.jpg' } } ] } })
        };
      };

      const scan = await RedditPlugin.handleMessage(RedditMessages.REDDIT_SCAN, { payload: { kind: 'subreddit', id: 's' } });
      assert.strictEqual(scan.handled, true, 'REDDIT_SCAN must be handled by RedditPlugin');
      assert.strictEqual(scan.response.success, true);
      assert.strictEqual(scan.response.status, 'success');
      assert.strictEqual(scan.response.items.length, 1);
      assert.strictEqual(scan.response.avatarUrl, 'https://www.redditstatic.com/avatars/defaults/v2/avatar_default_4.png');

      const rg = await RedditPlugin.handleMessage(RedditMessages.RESOLVE_REDGIFS, { url: 'https://www.redgifs.com/watch/somegif' });
      assert.strictEqual(rg.handled, true, 'RESOLVE_REDGIFS must be handled by RedditPlugin');
      assert.strictEqual(rg.response.success, true);
      assert.strictEqual(rg.response.data.url, 'https://example.com/hd.mp4');

      const unknown = await RedditPlugin.handleMessage('SOME_GENERIC_TYPE', {});
      assert.strictEqual(unknown, undefined, 'generic message types must not be claimed by RedditPlugin');
    }
  } finally {
    anyFetch.fetch = originalFetch;
  }
}
