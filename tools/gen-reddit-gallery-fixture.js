/**
 * Generates a sanitized Reddit GALLERY HAR fixture (fixtures-private/reddit-gallery.har).
 * Purpose: close coverage gap G-1 (har-validation-matrix.md) — real gallery slide URLs
 * so har-replay-platforms.test.js can assert reddit_gallery > 0.
 *
 * Sanitization rules applied (AGENTS.md §39/§40):
 *  - No cookies / authorization / tokens.
 *  - Synthetic subreddit/author/id (example_*), no real account data.
 *  - preview.redd.it slide URLs keep the real -v0-<id>.jpg shape but with synthetic
 *    media ids and a placeholder `s=` hash (no real signed hash).
 *  - The <gallery-carousel> is placed early in the post HTML so it lands inside the
 *    20000-char window the test mini-dom exposes (tools/mini-dom.js makeElement.__html).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractRedditPosts } from './har-replay.js';
import { makeElement, parseOpenTag } from './mini-dom.js';
import { RedditScanner } from '../src/plugins/reddit/RedditScanner.js';
import { RedditNormalizer } from '../src/plugins/reddit/RedditNormalizer.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

const POST_ID = 't3_examplegallery01';
const SUBREDDIT = 'example_sub';
const AUTHOR = 'example_user';
const SLIDES = [
  { id: 'exgalleryabc01', ext: 'jpg' },
  { id: 'exgalleryabc02', ext: 'png' },
  { id: 'exgalleryabc03', ext: 'jpg' }
];

// Compact post header; gallery-carousel immediately after so it is within 20000 chars.
const head = `<!DOCTYPE html><html lang="en" class="theme-beta" dir="ltr" device="desktop">
<head prefix="og: https://ogp.me/ns#"><title>Reddit - Dive into anything</title></head>
<body>
<shreddit-post class="block xs:mt-xs xs:-mx-xs xs:px-xs xs:rounded-4 pt-xs nd:pt-xs bg-[color:var(--shreddit-content-background)] box-border nd:visible mb-xs nd:pb-2xl" permalink="/r/${SUBREDDIT}/comments/examplegallery01/example_gallery_post/" content-href="https://www.reddit.com/gallery/examplegallery01" view-context="CommentsPage" comment-count="3" created-timestamp="2026-08-28T12:00:00.000000+0000" domain="reddit.com" id="${POST_ID}" post-title="Example gallery post" post-language="en" post-type="gallery" score="123" upvote-ratio="0.99" subreddit-id="t5_examplesub" subreddit-prefixed-name="r/${SUBREDDIT}" author-id="t2_exampleuser" author="${AUTHOR}" subreddit-name="${SUBREDDIT}">`;

const slides = SLIDES.map((s, i) => {
  const url = `https://preview.redd.it/${s.id}-v0-zzzzzzzzzzzz${i}.${s.ext}?width=1080&crop=smart&auto=webp&s=examplesanitizedhash${i}`;
  // Single <img> per slide (the real DOM also renders a duplicate background img, but
  // the fixture only needs one representative slide image to exercise extraction).
  return `           <li slot="page-${i + 1}" class="relative flex justify-center mt-0 bg-black/20">
      <img class="media-lightbox-img h-full w-full object-contain mb-0 relative" src="${url}" width="1080" height="1350" srcset="${url} 1080w" alt="" role="presentation" fetchpriority="auto" loading="lazy">
   </li>`;
}).join('\n');

const gallery = `<gallery-carousel style="--gallery-initial-height: 540px" class="nd:block nd:overflow-hidden nd:h-[var(--gallery-initial-height)]" post-id="${POST_ID}" permalink="/r/${SUBREDDIT}/comments/examplegallery01/example_gallery_post/" carousel-style="max-height: 540px;" fetch-ahead-count="3" use-media-lightbox advance-animation device-type="desktop">
        <ul>
${slides}
        </ul>
     </gallery-carousel>
</shreddit-post>
</body></html>`;

const html = head + '\n' + gallery;

const entry = {
  _initiator: { type: 'script', url: 'about:client', lineNumber: 0 },
  _priority: 'High',
  _resourceType: 'document',
  cache: {},
  connection: '443',
  request: {
    method: 'GET',
    url: `https://www.reddit.com/r/${SUBREDDIT}/comments/examplegallery01/example_gallery_post/`,
    httpVersion: 'HTTP/2',
    headers: [{ name: 'Accept', value: 'text/html' }],
    queryString: [],
    cookies: [],
    headersSize: -1,
    bodySize: -1
  },
  response: {
    status: 200,
    statusText: 'OK',
    httpVersion: 'HTTP/2',
    headers: [{ name: 'Content-Type', value: 'text/html; charset=utf-8' }],
    cookies: [],
    content: {
      size: Buffer.byteLength(html),
      mimeType: 'text/html',
      text: Buffer.from(html, 'utf8').toString('base64'),
      encoding: 'base64'
    },
    redirectURL: '',
    headersSize: -1,
    bodySize: Buffer.byteLength(html),
    _transferSize: Buffer.byteLength(html),
    _fetchedViaServiceWorker: false
  },
  serverIPAddress: '0.0.0.0',
  startedDateTime: '2026-08-28T12:00:00.000Z',
  time: 1,
  timings: { blocked: 0, dns: 0, connect: 0, send: 0, wait: 1, receive: 0, ssl: 0 },
  _connectionId: '0',
  pageref: 'page_0'
};

const har = {
  log: {
    version: '1.2',
    creator: { name: 'sanitized-har-fixture', version: '1' },
    pages: [{ id: 'page_0', title: 'sanitized reddit gallery', startedDateTime: '2026-08-28T12:00:00.000Z' }],
    entries: [entry]
  }
};

// Validate immediately against the real replay path (mini-dom + scanner).
const tmp = path.join(root, 'fixtures-private', 'reddit-gallery.har');
fs.writeFileSync(tmp, JSON.stringify(har, null, 2));

const { posts } = extractRedditPosts(tmp);
if (posts.length !== 1) throw new Error(`expected 1 shreddit-post, got ${posts.length}`);
const open = posts[0].html.match(/^<shreddit-post\s([^>]*)>/);
const el = makeElement(parseOpenTag(`<shreddit-post ${open[1]}>`), posts[0].html, 0);
const data = RedditScanner.extractFromShredditPost(el);
if (!data || data.postType !== 'gallery') throw new Error(`expected gallery postType, got ${data?.postType}`);
if (!data.mediaItems?.length) throw new Error('gallery produced 0 media items — fixture did not close G-1');
const info = { id: data.id, title: data.title, author: data.author, subreddit: data.subreddit, isGallery: true };
const items = data.mediaItems.map((mi) => RedditNormalizer.normalizeItem(mi, info));
const galleries = items.filter((i) => i.sourceType === 'reddit_gallery');
if (galleries.length !== SLIDES.length) throw new Error(`expected ${SLIDES.length} reddit_gallery items, got ${galleries.length}`);
const leaked = items.filter((i) => /profileIcon|communityIcon|styles\.redditmedia\.com/i.test(String(i.downloadUrl || i.url)));
if (leaked.length) throw new Error('icon leaked in gallery fixture');
console.log(`OK: gallery fixture produced ${items.length} items (${galleries.length} reddit_gallery), 0 icon leak.`);
console.log('sample downloadUrl:', items[0].downloadUrl);
