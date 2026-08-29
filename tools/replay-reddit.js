/**
 * Reddit HAR replay: run the REAL RedditScanner DOM extraction (extractFromShredditPost)
 * + RedditNormalizer against shreddit posts captured in HAR HTML pages.
 * Loop tool; assertions graduate into tests/integration/har-replay-platforms.test.js.
 */
import { extractRedditPosts } from './har-replay.js';
import { makeElement, parseOpenTag } from './mini-dom.js';
import { RedditScanner } from '../src/plugins/reddit/RedditScanner.js';
import { RedditNormalizer } from '../src/plugins/reddit/RedditNormalizer.js';

const HARS = process.argv.slice(2).length
  ? process.argv.slice(2)
  : [
      'fixtures-private/reddit-feed.har',
      'fixtures-private/reddit-post.har',
      'fixtures-private/reddit-empty-profile.har'
    ];

const ALLOWED = ['reddit.com', 'redd.it', 'redditmedia.com', 'redgifs.com', 'imgur.com'];
function hostAllowed(url) {
  if (!url || !/^https?:\/\//i.test(url)) return false;
  try {
    const host = new URL(url).hostname.toLowerCase();
    return ALLOWED.some((s) => host === s || host.endsWith('.' + s));
  } catch {
    return false;
  }
}

let totalPosts = 0;
let postsWithMedia = 0;
let totalItems = 0;
const sourceTypes = {};
/** @type {string[]} */
const violations = [];
const emptyProfileChecked = { pages: 0, posts: 0 };

for (const harPath of HARS) {
  const { posts, pageCount } = extractRedditPosts(harPath);
  const isEmptyProfile = harPath.includes('perfil-vazio');
  if (isEmptyProfile) {
    emptyProfileChecked.pages = pageCount;
    emptyProfileChecked.posts = posts.length;
  }

  const postEls = [];
  for (const p of posts) {
    totalPosts++;
    const openTag = p.html.match(/^<shreddit-post\s([^>]*)>/);
    const parsed = openTag ? parseOpenTag(`<shreddit-post ${openTag[1]}>`) : null;
    if (!parsed) {
      violations.push('failed to re-parse shreddit-post opening tag');
      continue;
    }
    postEls.push(makeElement(parsed, p.html, 0));
  }

  // Run the real scanner over each captured post element (independent elements).
  for (const postEl of postEls) {
    let postData;
    try {
      postData = RedditScanner.extractFromShredditPost(postEl);
    } catch (err) {
      violations.push(`extractFromShredditPost threw for ${postEl.getAttribute('id')}: ${err.message}`);
      continue;
    }
    if (!postData) {
      violations.push('extractFromShredditPost returned null');
      continue;
    }
    if (!postData.mediaItems || postData.mediaItems.length === 0) {
      continue;
    }
    postsWithMedia++;
    const postInfo = {
      id: postData.id,
      title: postData.title,
      author: postData.author,
      subreddit: postData.subreddit,
      score: postData.score,
      isGallery: postData.isGallery
    };
    for (const mi of postData.mediaItems) {
      let item;
      try {
        item = RedditNormalizer.normalizeItem(mi, postInfo);
      } catch (err) {
        violations.push(`normalizeItem threw for ${mi.url}: ${err.message}`);
        continue;
      }
      if (!item) continue;
      totalItems++;
      sourceTypes[item.sourceType] = (sourceTypes[item.sourceType] || 0) + 1;

      if (!item.id) violations.push(`item without id from ${mi.url}`);
      const dl = /** @type {string} */ (item.downloadUrl || item.url);
      if (item.sourceType === 'redgifs') {
        // RedGifs items keep the watch URL for later API resolution; allowed.
        if (!hostAllowed(dl)) violations.push(`redgifs host not allowed: ${dl}`);
      } else if (!hostAllowed(dl)) {
        violations.push(`host not allowed: ${dl?.slice(0, 90)}`);
      }
      const baseUrl = /** @type {string} */ (item.metadata?.baseUrl);
      if (baseUrl && !baseUrl.includes('v.redd.it')) {
        violations.push(`baseUrl not v.redd.it: ${baseUrl}`);
      }
      // preview.redd.it must be upgraded to i.redd.it for direct images
      if (item.sourceType === 'reddit_image' && /preview\.redd\.it/.test(dl)) {
        violations.push(`preview URL not upgraded: ${dl.slice(0, 90)}`);
      }
    }
  }
}

// Empty profile is the zero-result guard: page renders, no posts, no items, no crash.
if (emptyProfileChecked.pages > 0 && emptyProfileChecked.posts > 0) {
  violations.push('perfil-vazio capture unexpectedly contained shreddit posts');
}

console.log('captured shreddit posts:', totalPosts, '| posts with media:', postsWithMedia, '| items:', totalItems);
console.log('sourceTypes:', JSON.stringify(sourceTypes));
console.log('empty profile guard: pages with html =', emptyProfileChecked.pages, ', posts =', emptyProfileChecked.posts);
console.log(violations.length ? `\nVIOLATIONS (${violations.length}):` : '\nNO VIOLATIONS');
for (const v of violations.slice(0, 20)) console.log(' -', v);
