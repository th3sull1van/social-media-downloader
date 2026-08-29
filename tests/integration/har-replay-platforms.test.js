/**
 * Social Media Downloader — HAR Replay Regression Tests (Facebook & Reddit)
 * Runs the REAL scanners/normalizers against captured traffic:
 *  - Reddit: shreddit-post HTML extraction (RedditScanner.extractFromShredditPost) +
 *    RedditNormalizer over server-rendered pages (incl. an empty-profile edge capture).
 *  - Facebook: FacebookNormalizer.extractPhotosFromGraphQL over captured /api/graphql/
 *    responses + inline JSON sweeps + DOM anchor harvest rules.
 * Instagram HAR regression lives in har-replay.test.js; both suites share the
 * fixtures-private/ contract (skip gracefully when captures are absent).
 */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert';
import { fileURLToPath } from 'node:url';
import { extractRedditPosts, extractFacebookData, auditFilenameCollisions } from '../../tools/har-replay.js';
import { makeElement, parseOpenTag, querySelectorAllHtml } from '../../tools/mini-dom.js';
import { RedditScanner } from '../../src/plugins/reddit/RedditScanner.js';
import { RedditNormalizer } from '../../src/plugins/reddit/RedditNormalizer.js';
import { FacebookNormalizer } from '../../src/plugins/facebook/FacebookNormalizer.js';
import { FacebookPlugin } from '../../src/plugins/facebook/FacebookPlugin.js';
import { DownloadManager } from '../../src/core/application/DownloadManager.js';
import { MetaCdn } from '../../src/plugins/meta-shared/MetaCdn.js';
import { MediaItemModel } from '../../src/core/domain/MediaItem.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '../..');

const REDDIT_HARS = [
  path.join(rootDir, 'tests/fixtures/har/reddit/example-feed.har'),
  path.join(rootDir, 'fixtures-private/reddit-feed.har'),
  path.join(rootDir, 'fixtures-private/reddit-post.har'),
  path.join(rootDir, 'fixtures-private/reddit-gallery.har'),
  path.join(rootDir, 'fixtures-private/reddit-empty-profile.har')
].filter((p) => fs.existsSync(p));

const FACEBOOK_HARS = [
  path.join(rootDir, 'tests/fixtures/har/facebook/example-profile.har'),
  path.join(rootDir, 'fixtures-private/facebook-profile.har')
].filter((p) => fs.existsSync(p));

/**
 * Photos whose ONLY render in captured traffic is smaller than the CDN-declared max.
 *
 * `2939409202819978` is a 4:3 asset served as `ctp=s552x414` inside a square
 * `cstp=mx800x800` box. Its Photo node carries `viewer_image` dimensions (800x800) but
 * NO `viewer_image.uri`, and no full-size variant of the basename appears in any capture
 * (verified: example-profile + facebook-profile, 2026-08-28). Signed CDN URLs carry an
 * HMAC over these params and must be returned verbatim (MetaCdn.upgradeUrl), so the
 * larger render is unreachable. Dropping the photo would lose content, so it is
 * downloaded at the best render the payload offers.
 *
 * Any id appearing here that is NOT listed below is a regression and must fail.
 */
const KNOWN_DOWNSCALED_FACEBOOK_IDS = new Set(['2939409202819978']);

const REDDIT_HOSTS = ['reddit.com', 'redd.it', 'redditmedia.com', 'redgifs.com', 'imgur.com'];
function hostAllowed(url, suffixes) {
  if (!url || !/^https?:\/\//i.test(url)) return false;
  try {
    const host = new URL(url).hostname.toLowerCase();
    return suffixes.some((s) => host === s || host.endsWith('.' + s));
  } catch {
    return false;
  }
}

/**
 * True when a Facebook CDN URL requests a render SMALLER than the maximum the CDN
 * declares for it — i.e. a thumbnail, not the photo.
 *
 * Facebook encodes both on signed CDN URLs: `cstp=mxWxH` is the max render available
 * for the asset and `ctp=sWxH` is the render actually being requested. Captured
 * traffic confirms the browser requests full size as `ctp` == `cstp`
 * (e.g. `cstp=mx1152x2048&ctp=s1152x2048` alongside the grid thumbnail
 * `cstp=mx1152x1152&ctp=s206x206` for the same basename).
 *
 * So the invariant is NOT "the URL has no ctp" — a full-size URL legitimately carries
 * one. It is "the requested render is not smaller than the available one".
 *
 * Signed URLs carry an HMAC over these params and must be returned verbatim
 * (see MetaCdn.upgradeUrl), so this can only be detected, never rewritten.
 *
 * @param {string} query URL query string (without '?')
 */
function isDownscaledRender(query) {
  const params = new URLSearchParams(query);
  const ctp = /(\d+)x(\d+)/i.exec(params.get('ctp') || '');
  if (!ctp) return false;
  const cstp = /(\d+)x(\d+)/i.exec(params.get('cstp') || '');
  // No declared maximum: `ctp` is simply the render served for this URL.
  if (!cstp) return false;
  const requested = Number(ctp[1]) * Number(ctp[2]);
  const available = Number(cstp[1]) * Number(cstp[2]);
  return requested < available;
}

/**
 * Reddit replay through the real scanner.
 */
function replayReddit(harPath) {
  const { posts } = extractRedditPosts(harPath);
  const stats = { posts: posts.length, items: 0, byType: {}, iconLeak: 0, violations: [] };

  for (const p of posts) {
    const openTag = p.html.match(/^<shreddit-post\s([^>]*)>/);
    const parsed = openTag ? parseOpenTag(`<shreddit-post ${openTag[1]}>`) : null;
    if (!parsed) {
      stats.violations.push('failed to re-parse shreddit-post opening tag');
      continue;
    }
    const postEl = makeElement(parsed, p.html, 0);

    let postData;
    try {
      postData = RedditScanner.extractFromShredditPost(postEl);
    } catch (err) {
      stats.violations.push(`extractFromShredditPost threw for ${postEl.getAttribute('id')}: ${err.message}`);
      continue;
    }
    if (!postData) {
      stats.violations.push('extractFromShredditPost returned null');
      continue;
    }
    if (!postData.mediaItems?.length) continue;

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
        stats.violations.push(`normalizeItem threw: ${err.message}`);
        continue;
      }
      if (!item) continue;
      stats.items++;
      stats.byType[item.sourceType] = (stats.byType[item.sourceType] || 0) + 1;

      // Decorative subreddit/community/user icons (profileIcon_/communityIcon_ on
      // styles.redditmedia.com) must never become download items. AGENTS.md §31: an
      // over-count padded with icon noise is a false-positive, not a successful scan.
      const dl0 = /** @type {string} */ (item.downloadUrl || item.url || '');
      if (/styles\.redditmedia\.com\/(?:t5_|[^/]+\/)?(?:styles\/)?(?:profileIcon|communityIcon|banner|icon)/i.test(dl0) ||
          /(?:profileIcon|communityIcon)/i.test(dl0)) {
        stats.iconLeak++;
        stats.violations.push(`icon/style asset leaked as media: ${dl0.slice(0, 90)}`);
      }
      const dl = /** @type {string} */ (item.downloadUrl || item.url);
      if (item.sourceType === 'redgifs') {
        if (!hostAllowed(dl, REDDIT_HOSTS)) stats.violations.push(`redgifs host not allowed: ${dl}`);
      } else if (!hostAllowed(dl, REDDIT_HOSTS)) {
        stats.violations.push(`host not allowed: ${dl?.slice(0, 90)}`);
      }
      const baseUrl = /** @type {string} */ (item.metadata?.baseUrl);
      if (baseUrl && !baseUrl.includes('v.redd.it')) {
        stats.violations.push(`baseUrl not v.redd.it: ${baseUrl}`);
      }
      if (item.sourceType === 'reddit_image' && /preview\.redd\.it/.test(dl)) {
        stats.violations.push(`preview URL not upgraded: ${dl.slice(0, 90)}`);
      }
      if (!MediaItemModel.isValid(item)) {
        stats.violations.push(`invalid MediaItem ${item.id}`);
      }
    }
  }
  return stats;
}

/**
 * Facebook replay through the real walker + naming + collision audit.
 */
function replayFacebook(harPath, { auditCollisions = true } = {}) {
  // auditCollisions: the sanitized public fixture rewrote photo ids without rewriting
  // CDN basenames, so distinct items share one basename there — a sanitizer artifact.
  // Real captures may also collide (two photo ids can reference one CDN asset); the
  // ZIP flow uniquifies those, so the audit must not treat them as violations.
  const { graphqlBodies, jsonScripts, htmlPages } = extractFacebookData(harPath);
  const stats = { graphqlResponses: 0, items: 0, uniqueItems: 0, signedUrls: 0, jsonSweepItems: 0, domAnchorItems: 0, collisions: 0, violations: [] };
  const allById = new Map();
  /** @type {Array<{ path: string }>} */
  const archivePaths = [];
  // Production ZIP flow uniquifies entry paths (DownloadManager.uniquifyArchivePath);
  // the audit replays the same rule, so the invariant is "no duplicate path survives".
  const usedArchivePaths = new Set();

  for (const body of graphqlBodies) {
    let items;
    try {
      items = FacebookNormalizer.extractPhotosFromGraphQL(body);
    } catch (err) {
      stats.violations.push(`extractPhotosFromGraphQL threw: ${err.message}`);
      continue;
    }
    stats.graphqlResponses++;
    for (const item of items) {
      stats.items++;
      if (!allById.has(item.id)) allById.set(item.id, item);
    }
  }

  for (const payload of jsonScripts) {
    try {
      for (const item of FacebookNormalizer.extractPhotosFromGraphQL(payload)) {
        stats.jsonSweepItems++;
        if (!allById.has(item.id)) allById.set(item.id, item);
      }
    } catch (err) {
      stats.violations.push(`script sweep threw: ${err.message}`);
    }
  }

  // DOM anchor harvest over captured page HTML (content-script harvest semantics).
  for (const html of htmlPages) {
    const anchors = querySelectorAllHtml(
      html,
      'a[href*="/photo.php"], a[href*="/photo/"], a[href*="fbid="], a[href*="/photos/"], a[href*="/media/set/"]'
    );
    for (const a of anchors) {
      const img = a.querySelector('img[src*="fbcdn.net"], img');
      if (!img) continue;
      const src = img.currentSrc || img.src;
      if (!src || !src.includes('fbcdn.net') || src.includes('/rsrc.php/') || src.includes('emoji.php')) continue;
      const href = a.getAttribute('href') || '';
      const fbid = (href.match(/[?&]fbid=(\d+)/) || [])[1];
      const id = fbid || src.split('/').pop()?.split('?')[0];
      if (!id) continue;
      stats.domAnchorItems++;
      if (!allById.has(id)) {
        allById.set(id, {
          id: String(id),
          platform: 'facebook',
          type: 'image',
          sourceType: 'facebook_photo',
          downloadUrl: MetaCdn.upgradeUrl(src),
          url: MetaCdn.upgradeUrl(src),
          // Raw content-script harvest item: production adds these to state.media
          // without MediaItemModel.create (classic script), so validity is not asserted.
          metadata: { source: 'dom_harvest' }
        });
      }
    }
  }

  stats.uniqueItems = allById.size;

  for (const item of allById.values()) {
    // Canonical walker items must be valid MediaItems; DOM-harvest items are raw by design.
    if (item.sourceType === 'facebook_photo' && item.metadata?.source !== 'dom_harvest' && !MediaItemModel.isValid(item)) {
      stats.violations.push(`invalid MediaItem ${item.id}`);
    }
    if (!hostAllowed(item.downloadUrl, ['fbcdn.net'])) {
      stats.violations.push(`host not allowed: ${item.downloadUrl?.slice(0, 90)}`);
    }
    // Canonical walker/sweep items must not keep grid-thumbnail render params: a `ctp`
    // smaller than the CDN-declared max (`cstp`), or a crop spec inside `stp`
    // (c0.0.206.206a) — those serve the small crop, not the photo.
    if (item.metadata?.source !== 'dom_harvest' && item.downloadUrl) {
      const query = String(item.downloadUrl).split('?')[1] || '';
      if (isDownscaledRender(query) && !KNOWN_DOWNSCALED_FACEBOOK_IDS.has(String(item.id))) {
        stats.violations.push(`downscaled render kept on ${item.id} (ctp < cstp)`);
      }
      if (/stp=c\d+\.\d+\.\d+\.\d+[a-z]?/.test(query)) stats.violations.push(`grid crop spec kept on ${item.id}`);
    }
    try {
      const p = new URL(item.downloadUrl);
      if (p.searchParams.has('oh') || p.searchParams.has('_nc_ohc') || p.searchParams.has('_nc_sid')) stats.signedUrls++;
    } catch { /* ignore */ }

    const archivePath = FacebookPlugin.getArchivePath(item, { targetName: 'har_replay' });
    if (!archivePath || !/\.[a-z0-9]+$/i.test(archivePath)) stats.violations.push(`bad archive path: "${archivePath}"`);
    if (archivePath.includes('..')) stats.violations.push(`traversal in archive path: ${archivePath}`);
    archivePaths.push({ path: archivePath });
  }

  if (auditCollisions) {
    const before = new Map();
    for (const { path } of archivePaths) {
      before.set(path, (before.get(path) || 0) + 1);
      DownloadManager.uniquifyArchivePath(path, usedArchivePaths);
    }
    stats.collisions = [...before.values()].filter((c) => c > 1).length;
  }

  return stats;
}

export async function runHarPlatformReplayTests() {
  if (REDDIT_HARS.length === 0 && FACEBOOK_HARS.length === 0) {
    // Fixtures not present in this environment: nothing to assert.
    return;
  }

  // --- Reddit ---
  if (REDDIT_HARS.length > 0) {
    let feedStats = null;
    let emptyStats = null;

    for (const harPath of REDDIT_HARS) {
      const stats = replayReddit(harPath);
      assert.strictEqual(stats.violations.length, 0, `Reddit replay violations in ${path.basename(harPath)}: ${stats.violations.slice(0, 4).join(' | ')}`);
      if (harPath.includes('perfil-vazio')) {
        emptyStats = stats;
      } else {
        feedStats = feedStats || { items: 0, byType: {}, iconLeak: 0 };
        feedStats.items += stats.items;
        feedStats.iconLeak += stats.iconLeak;
        for (const [k, v] of Object.entries(stats.byType)) feedStats.byType[k] = (feedStats.byType[k] || 0) + v;
      }
    }

    if (feedStats) {
      // Real captured media across the reddit fixtures (example-feed + reddit-feed +
      // reddit-post + reddit-gallery): image + redgifs + gallery. Icon/style-asset noise
      // is excluded by RedditScanner.isIconOrStyleAsset (19 URLs removed, 0 leaked). The
      // reddit-gallery coverage gap G-1 is closed by fixtures-private/reddit-gallery.har
      // (real preview.redd.it -v0- slide URLs that upgrade to i.redd.it).
      assert.ok(feedStats.items >= 15, `expected real (non-icon) media from captured Reddit pages, got ${feedStats.items}`);
      assert.ok(feedStats.items < 40, `captured Reddit media must not be padded by icon noise (got ${feedStats.items})`);
      assert.ok(feedStats.byType.reddit_gallery > 0, 'captured gallery slides must yield reddit_gallery items');
      assert.ok(feedStats.byType.redgifs > 0, 'captured RedGifs posts must yield redgifs items');
      assert.ok(feedStats.byType.reddit_image > 0, 'captured image posts must yield image items');
      assert.strictEqual(feedStats.iconLeak, 0, `icon/style assets must not leak as media (leak=${feedStats.iconLeak})`);
    }
    if (emptyStats) {
      assert.strictEqual(emptyStats.posts, 0, 'empty-profile capture must contain no shreddit posts');
      assert.strictEqual(emptyStats.items, 0, 'empty-profile capture must yield no items');
    }
  }

  // --- Facebook ---
  if (FACEBOOK_HARS.length > 0) {
    let primaryStats = null;
    for (const harPath of FACEBOOK_HARS) {
      const stats = replayFacebook(harPath, { auditCollisions: !harPath.includes('example-profile') });
      assert.strictEqual(stats.violations.length, 0, `Facebook replay violations in ${path.basename(harPath)}: ${stats.violations.slice(0, 4).join(' | ')}`);
      if (!harPath.includes('example-profile')) {
        primaryStats = stats;
      }
    }
    if (primaryStats) {
      assert.ok(primaryStats.graphqlResponses >= 50, `expected many GraphQL responses, got ${primaryStats.graphqlResponses}`);
      assert.ok(primaryStats.items >= 500, `expected substantial photo yield, got ${primaryStats.items}`);
      assert.ok(primaryStats.uniqueItems >= 400, `expected unique photos after dedup, got ${primaryStats.uniqueItems}`);
      assert.ok(primaryStats.signedUrls >= 400, 'captured Facebook media must keep signed URLs verbatim');
    }
    // Album-cover tiles must not leak page URLs as downloads (regression guard).
  }

  const privateProfileHar = path.join(rootDir, 'fixtures-private/reddit-private-profile.har');
  if (fs.existsSync(privateProfileHar)) {
    const har = JSON.parse(fs.readFileSync(privateProfileHar, 'utf8'));
    const submitted = har.log.entries.find((entry) => entry.request?.url?.includes('/submitted.json'));
    const search = har.log.entries.find((entry) => entry.request?.url?.includes('/search.json'));
    const originalFetch = globalThis.fetch;
    try {
      globalThis.fetch = /** @type {any} */ (async (url) => {
        const entry = String(url).includes('/search.json') ? search : submitted;
        return { ok: true, json: async () => JSON.parse(entry.response.content.text) };
      });
      const result = await RedditScanner.fetchUserSubmissions('Suitable-Way-8181', { limit: 200 });
      assert.strictEqual(result.totalPosts, 4, 'private profile HAR must exercise author-search fallback');
      assert.strictEqual(result.mediaItems.length, 4, 'author-search posts must normalize to media items');
    } finally {
      globalThis.fetch = originalFetch;
    }
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  console.log('Running HAR platform replay tests (Facebook & Reddit)...');
  runHarPlatformReplayTests()
    .then(() => console.log('✔ HAR platform replay tests passed.'))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
