/**
 * Social Media Downloader — Reddit Scanner
 * Extracts media from Shreddit / Old Reddit DOM and queries Reddit public JSON endpoints.
 */
import { RedditNormalizer } from './RedditNormalizer.js';

export class RedditScanner {
  /**
   * Extracts media from a shreddit-post DOM element.
   * @param {{ getAttribute: (name: string) => string | null, hasAttribute: (name: string) => boolean, querySelector: (sel: string) => any, querySelectorAll: (sel: string) => any[], shadowRoot?: any }} postEl
   * @returns {Object | null}
   */
  /**
   * True when a URL is a subreddit/community/user icon or other style asset
   * (e.g. `styles.redditmedia.com/t5_xxx/styles/profileIcon_*` or
   * `.../communityIcon_*`) rather than post media. These leak into `img[src*=redditmedia.com]`
   * DOM queries and must not become download items — they are decorative avatars.
   * @param {string} url
   * @returns {boolean}
   */
  static isIconOrStyleAsset(url) {
    if (!url || typeof url !== 'string') return false;
    if (/styles\.redditmedia\.com/i.test(url)) {
      return /(?:profileIcon|communityIcon|banner|icon)_(?:[a-z0-9]+)\./i.test(url) ||
        /\/(?:profileIcon|communityIcon|banner|icon)/i.test(url);
    }
    // Old-reddit / public-API avatar hosts are never post media either.
    return /reddit\.com\/(?:av|useravatar|r\/[^\/]+\/icon)/i.test(url) ||
      /(?:profileIcon|communityIcon)/i.test(url);
  }

  static extractFromShredditPost(postEl) {
    if (!postEl) return null;

    const id = postEl.getAttribute('id') || postEl.getAttribute('post-id') || '';
    const cleanId = id.replace(/^t3_/, '');
    const title = postEl.getAttribute('post-title') || postEl.querySelector?.('h1, [slot="title"]')?.textContent?.trim() || 'reddit_post';
    const author = postEl.getAttribute('author') || postEl.getAttribute('author-name') || 'reddit_user';
    const subreddit = postEl.getAttribute('subreddit-prefixed-name') || postEl.getAttribute('subreddit-name') || '';
    const postType = (postEl.getAttribute('post-type') || '').toLowerCase();
    const contentHref = postEl.getAttribute('content-href') || '';
    const permalink = postEl.getAttribute('permalink') || '';
    const domain = (postEl.getAttribute('domain') || '').toLowerCase();
    const score = parseInt(postEl.getAttribute('score') || '0', 10);
    const createdTimestamp = postEl.getAttribute('created-timestamp') || '';

    const postData = {
      id: cleanId || id,
      title: title.trim(),
      author: author.replace(/^u\//, ''),
      subreddit: subreddit.replace(/^r\//, ''),
      postType,
      contentHref,
      permalink: permalink.startsWith('/') ? `https://www.reddit.com${permalink}` : permalink,
      domain,
      score: isNaN(score) ? 0 : score,
      createdTimestamp,
      mediaItems: []
    };

    // 1. Gallery Detection
    const isGalleryPost = postData.postType === 'gallery' ||
      contentHref.includes('/gallery/') ||
      postEl.hasAttribute('gallery-data') ||
      !!postEl.querySelector?.('gallery-carousel, ul[slot="gallery-items"], faceplate-carousel');

    if (isGalleryPost) {
      postData.postType = 'gallery';
      postData.isGallery = true;
      const items = RedditScanner.extractGalleryFromDom(postEl);
      if (items.length > 0) postData.mediaItems = items;
    }

    // 2. Video Detection
    const isVideoPost = postData.postType === 'video' ||
      domain === 'v.redd.it' ||
      contentHref.includes('v.redd.it') ||
      !!postEl.querySelector?.('shreddit-player, shreddit-player-2');

    if (!postData.mediaItems.length && isVideoPost) {
      postData.postType = 'video';
      const videoInfo = RedditScanner.extractVideoFromDom(postEl, contentHref);
      if (videoInfo) postData.mediaItems = [videoInfo];
    }

    // 3. RedGifs Detection
    if (postData.mediaItems.length === 0 && (domain.includes('redgifs') || contentHref.includes('redgifs.com'))) {
      postData.postType = 'redgifs';
      postData.mediaItems = [{
        type: 'redgifs',
        url: contentHref,
        ext: 'mp4',
        title: postData.title,
        index: 1,
        total: 1
      }];
    }

    // 4. Single Image Detection (attribute lookup first, DOM fallback only if needed)
    if (postData.mediaItems.length === 0) {
      let src = '';
      if (contentHref && !RedditScanner.isIconOrStyleAsset(contentHref) && (contentHref.includes('redd.it') || contentHref.includes('imgur.com') || /\.(jpg|jpeg|png|gif|webp)/i.test(contentHref))) {
        src = contentHref;
      } else {
        const img = postEl.querySelector?.('img[src*="redd.it"], img[src*="redditmedia.com"], [slot="post-media-container"] img');
        src = img?.getAttribute('src') || '';
      }

      if (src && !RedditScanner.isIconOrStyleAsset(src) && (src.includes('redd.it') || src.includes('imgur.com') || /\.(jpg|jpeg|png|gif|webp)/i.test(src))) {
        postData.mediaItems = [{
          type: 'image',
          url: RedditNormalizer.cleanMediaUrl(src),
          previewUrl: src,
          ext: 'jpg',
          index: 1,
          total: 1
        }];
      }
    }

    return postData;
  }

  static extractGalleryFromDom(postEl) {
    const items = [];
    const imgs = postEl.querySelectorAll('gallery-carousel img, faceplate-carousel img, ul[slot="gallery-items"] img, [slot="post-media-container"] img');
    imgs.forEach((img, idx) => {
      const src = img.getAttribute('src') || img.getAttribute('data-src');
      // Skip decorative subreddit/community/user icons that leak into the query.
      if (src && !RedditScanner.isIconOrStyleAsset(src)) {
        items.push({
          type: 'image',
          url: RedditNormalizer.cleanMediaUrl(src),
          previewUrl: src,
          index: idx + 1,
          isGallery: true
        });
      }
    });
    return items;
  }

  static extractVideoFromDom(postEl, contentHref) {
    const player = postEl.querySelector('shreddit-player, shreddit-player-2');
    const src = player?.getAttribute('src') || player?.getAttribute('stream-url') || contentHref;
    const preview = player?.getAttribute('poster') || player?.getAttribute('preview') || '';
    if (!src) return null;

    const isHls = src.includes('.m3u8') || src.includes('HLS');
    const baseUrl = src.replace(/\/(?:HLSPlaylist\.m3u8|DASH_[^\/?#]+.*)$/, '');

    return {
      type: 'video',
      url: src,
      baseUrl: baseUrl.includes('v.redd.it') ? baseUrl : undefined,
      fallbackUrl: src,
      previewUrl: preview,
      isHls,
      ext: 'mp4',
      index: 1,
      total: 1
    };
  }

  /**
   * Parses public Reddit JSON API post object into normalized media items.
   * @param {any} postData
   * @returns {import('../../core/domain/MediaItem.js').MediaItem[]}
   */
  static parseApiPostObject(postData) {
    if (!postData) return [];
    const results = [];
    const postInfo = {
      id: postData.id,
      title: postData.title || '',
      author: postData.author || '',
      subreddit: postData.subreddit || '',
      score: postData.score || 0,
      isGallery: !!postData.is_gallery || !!postData.gallery_data
    };

    // 1. Gallery
    if (postData.is_gallery && postData.media_metadata) {
      const galleryItems = postData.gallery_data?.items || [];
      galleryItems.forEach((gItem, idx) => {
        const meta = postData.media_metadata[gItem.media_id];
        if (meta) {
          const ext = meta.m ? meta.m.split('/').pop() : 'jpg';
          const highRes = `https://i.redd.it/${gItem.media_id}.${ext}`;
          const previewCandidates = meta.p || [];
          const midPreview = previewCandidates[Math.min(2, previewCandidates.length - 1)]?.u || meta.s?.u;
          const preview = midPreview ? midPreview.replace(/&amp;/g, '&') : highRes;
          results.push(RedditNormalizer.normalizeItem({
            id: gItem.media_id,
            url: highRes,
            previewUrl: preview,
            ext,
            index: idx + 1,
            total: galleryItems.length,
            isGallery: true
          }, postInfo));
        }
      });
      return results;
    }

    // 2. Reddit Video
    if (postData.is_video && postData.media?.reddit_video) {
      const rVideo = postData.media.reddit_video;
      const fallbackUrl = rVideo.fallback_url || '';
      const baseUrl = fallbackUrl.replace(/\/DASH_[^\/?#]+.*$/, '');
      const thumbUrl = (postData.thumbnail && /^https?:\/\//i.test(postData.thumbnail)) ? postData.thumbnail : '';
      results.push(RedditNormalizer.normalizeItem({
        id: postData.id,
        type: 'video',
        url: fallbackUrl,
        baseUrl,
        fallbackUrl,
        previewUrl: thumbUrl,
        ext: 'mp4',
        index: 1,
        total: 1
      }, postInfo));
      return results;
    }

    // 3. RedGifs embed
    if (postData.url && postData.url.includes('redgifs.com')) {
      const thumbUrl = (postData.thumbnail && /^https?:\/\//i.test(postData.thumbnail)) ? postData.thumbnail : '';
      results.push(RedditNormalizer.normalizeItem({
        id: postData.id,
        type: 'redgifs',
        url: postData.url,
        isRedGifs: true,
        previewUrl: thumbUrl,
        ext: 'mp4',
        index: 1,
        total: 1
      }, postInfo));
      return results;
    }

    // 4. Direct Image
    if (postData.url && !RedditScanner.isIconOrStyleAsset(postData.url) && (postData.url.includes('redd.it') || postData.url.includes('imgur.com') || /\.(jpg|jpeg|png|gif|webp)/i.test(postData.url))) {
      const cleanUrl = RedditNormalizer.cleanMediaUrl(postData.url);
      const previewImgs = postData.preview?.images?.[0]?.resolutions || [];
      const midPreview = previewImgs[Math.min(2, previewImgs.length - 1)]?.url;
      const thumbUrl = (midPreview ? midPreview.replace(/&amp;/g, '&') : '') ||
        ((postData.thumbnail && /^https?:\/\//i.test(postData.thumbnail)) ? postData.thumbnail : '') ||
        cleanUrl;

      results.push(RedditNormalizer.normalizeItem({
        id: postData.id,
        type: 'image',
        url: cleanUrl,
        previewUrl: thumbUrl,
        ext: 'jpg',
        index: 1,
        total: 1
      }, postInfo));
      return results;
    }

    return results;
  }

  /**
   * Scans user submissions from public Reddit JSON API.
   * @param {string} username
   * @param {Object} [options]
   * @returns {Promise<{ mediaItems: import('../../core/domain/MediaItem.js').MediaItem[], totalPosts: number }>}
   */
  static async fetchUserSubmissions(username, options = {}) {
    const limit = options.limit || 500;
    const allItems = [];
    const seenPostIds = new Set();
    let after = null;
    let totalPosts = 0;

    const processChildren = (children) => {
      for (const child of children) {
        const post = child?.data;
        const postId = String(post?.id || '').replace(/^t3_/, '');
        if (!post || !postId || seenPostIds.has(postId)) continue;
        seenPostIds.add(postId);
        totalPosts++;
        allItems.push(...RedditScanner.parseApiPostObject(post));
      }
    };

    while (totalPosts < limit) {
      const url = `https://www.reddit.com/user/${encodeURIComponent(username)}/submitted.json?limit=100&raw_json=1${after ? `&after=${after}` : ''}`;
      const res = await fetch(url);
      if (!res.ok) break;

      const json = await res.json();
      const children = json.data?.children || [];
      if (children.length === 0) break;

      processChildren(children);

      after = json.data?.after;
      if (!after) break;
      await new Promise(r => setTimeout(r, 400));
    }

    // Reddit's profile listing can omit posts that remain available through
    // the author search endpoint. This dual-source discovery provides complete coverage.
    let searchAfter = null;
    let searchPages = 0;
    while (totalPosts < limit && searchPages < 3) {
      searchPages++;
      const searchUrl = `https://www.reddit.com/search.json?q=author%3A${encodeURIComponent(username)}&sort=new&limit=100&include_over_18=on&raw_json=1${searchAfter ? `&after=${encodeURIComponent(searchAfter)}` : ''}`;
      const searchRes = await fetch(searchUrl);
      if (!searchRes.ok) break;
      const searchJson = await searchRes.json();
      const searchChildren = searchJson.data?.children || [];
      if (searchChildren.length === 0) break;
      processChildren(searchChildren);
      searchAfter = searchJson.data?.after;
      if (!searchAfter) break;
      await new Promise(r => setTimeout(r, 400));
    }

    return { mediaItems: allItems, totalPosts };
  }

  /**
   * Scans a subreddit's posts from the public Reddit JSON API.
   * @param {string} subreddit
   * @param {Object} [options]
   * @param {number} [options.limit=300]
   * @param {"hot"|"new"|"top"} [options.sort="hot"]
   * @returns {Promise<{ items: import('../../core/domain/MediaItem.js').MediaItem[], totalPosts: number }>}
   */
  static async fetchSubredditPosts(subreddit, options = {}) {
    const limit = options.limit || 300;
    const sort = options.sort || 'hot';
    const allItems = [];
    let after = null;
    let totalPosts = 0;

    while (totalPosts < limit) {
      const url = `https://www.reddit.com/r/${encodeURIComponent(subreddit)}/${sort}.json?limit=100&raw_json=1${after ? `&after=${after}` : ''}`;
      const res = await fetch(url);
      if (!res.ok) break;

      const json = await res.json();
      const children = json.data?.children || [];
      if (children.length === 0) break;

      for (const child of children) {
        totalPosts++;
        allItems.push(...RedditScanner.parseApiPostObject(child.data));
      }

      after = json.data?.after;
      if (!after) break;
      await new Promise(r => setTimeout(r, 400));
    }

    return { items: allItems, totalPosts };
  }

  /**
   * Fetches a single post (or its full comment tree) by base36 post ID and extracts its media.
   * @param {string} postId
   * @returns {Promise<{ items: import('../../core/domain/MediaItem.js').MediaItem[] }>}
   */
  static async fetchPostById(postId) {
    const cleanId = String(postId || '').replace(/^t3_/, '');
    if (!cleanId) return { items: [] };

    const url = `https://www.reddit.com/comments/${encodeURIComponent(cleanId)}.json?limit=1&raw_json=1`;
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} when fetching post ${cleanId}`);
    }

    const json = await res.json();
    const listing = Array.isArray(json) ? json[0] : null;
    const postData = listing?.data?.children?.[0]?.data;
    if (!postData) return { items: [] };

    return { items: RedditScanner.parseApiPostObject(postData) };
  }
}
