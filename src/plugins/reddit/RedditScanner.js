/**
 * Social Media Downloader — Reddit Scanner
 * Extracts media from Shreddit / Old Reddit DOM and queries Reddit public JSON endpoints.
 */
import { RedditNormalizer } from './RedditNormalizer.js';

export class RedditScanner {
  static inferExtension(url, fallback = 'jpg') {
    const match = String(url || '').split(/[?#]/)[0].match(/\.([a-z0-9]{2,5})$/i);
    return match ? match[1].toLowerCase() : fallback;
  }

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

  static isDirectImageCandidate(rawUrl) {
    if (!rawUrl || typeof rawUrl !== 'string') return false;
    if (RedditScanner.isIconOrStyleAsset(rawUrl)) return false;
    let parsed;
    try {
      parsed = new URL(rawUrl, 'https://www.reddit.com');
    } catch {
      return false;
    }
    if (!['http:', 'https:'].includes(parsed.protocol)) return false;
    const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
    if (host === 'v.redd.it' || host === 'instagram.com' || host.endsWith('.instagram.com') || host === 'facebook.com' || host.endsWith('.facebook.com')) {
      return false;
    }
    if (host === 'imgur.com' && /^\/(?:a|gallery)\//i.test(parsed.pathname)) {
      return false;
    }
    if (['i.redd.it', 'preview.redd.it', 'external-preview.redd.it', 'i.imgur.com'].includes(host)) {
      return true;
    }
    return false;
  }

  /**
   * Extracts media from a shreddit-post DOM element.
   * @param {{ getAttribute: (name: string) => string | null, hasAttribute: (name: string) => boolean, querySelector: (sel: string) => any, querySelectorAll: (sel: string) => any[] }} postEl
   * @returns {Object | null}
   */
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
    if (postData.mediaItems.length === 0 && (domain === 'redgifs.com' || domain.endsWith('.redgifs.com') || RedditNormalizer.isRedGifsHost(contentHref))) {
      postData.postType = 'redgifs';
      const thumbImg = postEl.querySelector?.('img[src], shreddit-embed img');
      const thumbSrc = thumbImg?.getAttribute?.('src') || '';
      postData.mediaItems = [{
        type: 'redgifs',
        url: contentHref,
        previewUrl: RedditScanner.isIconOrStyleAsset(thumbSrc) ? '' : thumbSrc,
        ext: 'mp4',
        title: postData.title,
        index: 1,
        total: 1
      }];
    }

    // 4. Single Image Detection (attribute lookup first, DOM fallback only if needed)
    if (postData.mediaItems.length === 0) {
      let src = '';
      if (RedditScanner.isDirectImageCandidate(contentHref)) {
        src = contentHref;
      } else {
        const img = postEl.querySelector?.('img[src*="redd.it"], img[src*="redditmedia.com"], [slot="post-media-container"] img');
        src = img?.getAttribute('src') || '';
      }

      if (RedditScanner.isDirectImageCandidate(src)) {
        postData.mediaItems = [{
          type: 'image',
          url: RedditNormalizer.cleanMediaUrl(src),
          previewUrl: src,
          ext: RedditScanner.inferExtension(src),
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
    imgs.forEach((img) => {
      const src = img.getAttribute('src') || img.getAttribute('data-src');
      // Skip decorative subreddit/community/user icons that leak into the query.
      if (src && !RedditScanner.isIconOrStyleAsset(src)) {
        items.push({
          type: 'image',
          url: RedditNormalizer.cleanMediaUrl(src),
          previewUrl: src,
          index: items.length + 1,
          isGallery: true
        });
      }
    });
    for (const item of items) {
      item.total = items.length;
    }
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
   * Fetches the target user's or subreddit's avatar from the public about
   * endpoint. The page DOM can render avatars inside SVG <image> nodes or
   * after the initial content script run, so this is the stable fallback for
   * the in-page target header.
   * @param {'user'|'subreddit'} kind
   * @param {string} id
   * @returns {Promise<string>}
   */
  static async fetchTargetAvatar(kind, id) {
    if (!id || !['user', 'subreddit'].includes(kind)) return '';

    const encodedId = encodeURIComponent(id);
    const endpoint = kind === 'user'
      ? `https://www.reddit.com/user/${encodedId}/about.json?raw_json=1`
      : `https://www.reddit.com/r/${encodedId}/about.json?raw_json=1`;
    const response = await fetch(endpoint);
    if (!response.ok) return '';

    const json = await response.json();
    const data = json?.data || {};
    const candidates = kind === 'user'
      ? [data.snoovatar_img, data.icon_img, data.profile_image, data.avatar]
      : [data.icon_img, data.community_icon, data.profile_image, data.avatar];

    for (const candidate of candidates) {
      const url = String(candidate || '').replace(/&amp;/g, '&').trim();
      if (!/^https?:\/\//i.test(url)) continue;
      try {
        const host = new URL(url).hostname.toLowerCase();
        if (['reddit.com', 'redditmedia.com', 'redditstatic.com', 'redd.it']
          .some((suffix) => host === suffix || host.endsWith(`.${suffix}`))) {
          return url;
        }
      } catch {
        // Ignore malformed avatar fields and try the next API candidate.
      }
    }
    return '';
  }

  /**
   * Parses public Reddit JSON API post object into normalized media items.
   * @param {any} postData
   * @returns {import('../../core/domain/MediaItem.js').MediaItem[]}
   */
  static parseApiPostObject(postData) {
    if (!postData) return [];
    const results = [];
    const mediaPost = (!postData.is_gallery && !postData.media_metadata && !postData.is_video &&
      !postData.media?.reddit_video && !postData.secure_media?.reddit_video &&
      Array.isArray(postData.crosspost_parent_list) && postData.crosspost_parent_list[0])
      ? postData.crosspost_parent_list[0]
      : postData;

    const postInfo = {
      id: postData.id,
      title: postData.title || mediaPost.title || '',
      author: postData.author || mediaPost.author || '',
      subreddit: postData.subreddit || mediaPost.subreddit || '',
      score: postData.score || 0,
      isGallery: !!mediaPost.is_gallery || !!mediaPost.gallery_data
    };

    // 1. Gallery
    if (mediaPost.is_gallery && mediaPost.media_metadata) {
      const galleryItems = mediaPost.gallery_data?.items || [];
      galleryItems.forEach((gItem) => {
        const meta = mediaPost.media_metadata[gItem.media_id];
        if (meta && meta.status !== 'failed') {
          const rawExt = meta.m ? String(meta.m).split('/').pop().toLowerCase() : 'jpg';
          const ext = rawExt === 'jpeg' ? 'jpg' : rawExt;
          const highRes = `https://i.redd.it/${gItem.media_id}.${ext}`;
          const previewCandidates = meta.p || [];
          const midPreview = previewCandidates[Math.min(2, previewCandidates.length - 1)]?.u || meta.s?.u;
          const preview = midPreview ? midPreview.replace(/&amp;/g, '&') : highRes;
          results.push(RedditNormalizer.normalizeItem({
            id: gItem.media_id,
            url: highRes,
            previewUrl: preview,
            ext,
            index: results.length + 1,
            total: galleryItems.length,
            isGallery: true
          }, postInfo));
        }
      });
      for (const item of results) {
        if (item.metadata) item.metadata.total = results.length;
      }
      return results;
    }

    // 2. Reddit Video (also handle v.redd.it links where is_video is omitted)
    const rVideo = mediaPost.media?.reddit_video || mediaPost.secure_media?.reddit_video;
    const vReddMatch = !rVideo && typeof mediaPost.url === 'string'
      ? mediaPost.url.match(/^https?:\/\/v\.redd\.it\/([a-zA-Z0-9_-]+)/i)
      : null;
    if ((rVideo && (mediaPost.is_video || rVideo.fallback_url)) || vReddMatch) {
      const fallbackUrl = rVideo?.fallback_url || `https://v.redd.it/${vReddMatch[1]}/DASH_720.mp4`;
      const baseUrl = rVideo?.fallback_url
        ? fallbackUrl.replace(/\/DASH_[^\/?#]+.*$/, '')
        : `https://v.redd.it/${vReddMatch[1]}`;
      const thumbUrl = (postData.thumbnail && /^https?:\/\//i.test(postData.thumbnail))
        ? postData.thumbnail
        : (mediaPost.preview?.images?.[0]?.source?.url || postData.preview?.images?.[0]?.source?.url || '').replace(/&amp;/g, '&');
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
    if (mediaPost.url && RedditNormalizer.isRedGifsHost(mediaPost.url)) {
      const thumbUrl = (postData.thumbnail && /^https?:\/\//i.test(postData.thumbnail))
        ? postData.thumbnail
        : (mediaPost.preview?.images?.[0]?.source?.url || postData.preview?.images?.[0]?.source?.url || '').replace(/&amp;/g, '&');
      results.push(RedditNormalizer.normalizeItem({
        id: postData.id,
        type: 'redgifs',
        url: mediaPost.url,
        isRedGifs: true,
        previewUrl: thumbUrl,
        ext: 'mp4',
        index: 1,
        total: 1
      }, postInfo));
      return results;
    }

    // 4. Direct Image
    if (mediaPost.url && RedditScanner.isDirectImageCandidate(mediaPost.url)) {
      const cleanUrl = RedditNormalizer.cleanMediaUrl(mediaPost.url);
      const previewImgs = mediaPost.preview?.images?.[0]?.resolutions || postData.preview?.images?.[0]?.resolutions || [];
      const midPreview = previewImgs[Math.min(2, previewImgs.length - 1)]?.url;
      const thumbUrl = (midPreview ? midPreview.replace(/&amp;/g, '&') : '') ||
        ((postData.thumbnail && /^https?:\/\//i.test(postData.thumbnail)) ? postData.thumbnail : '') ||
        cleanUrl;

      results.push(RedditNormalizer.normalizeItem({
        id: postData.id,
        type: 'image',
        url: cleanUrl,
        previewUrl: thumbUrl,
        ext: RedditScanner.inferExtension(cleanUrl),
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
   * @returns {Promise<{ mediaItems: import('../../core/domain/MediaItem.js').MediaItem[], totalPosts: number, status: 'success' | 'partial' | 'empty' | 'network_failure', errorCode?: string }>}
   */
  static async fetchUserSubmissions(username, options = {}) {
    const limit = options.limit || 500;
    const allItems = [];
    const seenPostIds = new Set();
    const seenCursors = new Set();
    let after = null;
    let totalPosts = 0;
    let submittedOk = false;
    let hadNetworkFailure = false;

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
      const url = `https://www.reddit.com/user/${encodeURIComponent(username)}/submitted.json?limit=100&raw_json=1${after ? `&after=${encodeURIComponent(after)}` : ''}`;
      try {
        const res = await fetch(url);
        if (!res.ok) {
          hadNetworkFailure = true;
          break;
        }
        submittedOk = true;
        const json = await res.json();
        const children = json.data?.children || [];
        if (children.length === 0) break;
        const beforeCount = totalPosts;
        processChildren(children);
        const nextAfter = json.data?.after;
        if (!nextAfter || seenCursors.has(nextAfter) || totalPosts === beforeCount) break;
        seenCursors.add(nextAfter);
        after = nextAfter;
      } catch {
        hadNetworkFailure = true;
        break;
      }
      await new Promise(r => setTimeout(r, 400));
    }

    // Reddit's profile listing can omit posts that remain available through
    // the author search endpoint. This dual-source discovery provides complete coverage.
    let searchAfter = null;
    const seenSearchCursors = new Set();
    let searchPages = 0;
    while (totalPosts < limit && searchPages < 3) {
      searchPages++;
      const searchUrl = `https://www.reddit.com/search.json?q=author%3A${encodeURIComponent(username)}&sort=new&limit=100&include_over_18=on&raw_json=1${searchAfter ? `&after=${encodeURIComponent(searchAfter)}` : ''}`;
      try {
        const searchRes = await fetch(searchUrl);
        if (!searchRes.ok) {
          hadNetworkFailure = true;
          break;
        }
        const searchJson = await searchRes.json();
        const searchChildren = searchJson.data?.children || [];
        if (searchChildren.length === 0) break;
        processChildren(searchChildren);
        const nextSearchAfter = searchJson.data?.after;
        if (!nextSearchAfter || seenSearchCursors.has(nextSearchAfter)) break;
        seenSearchCursors.add(nextSearchAfter);
        searchAfter = nextSearchAfter;
      } catch {
        hadNetworkFailure = true;
        break;
      }
      await new Promise(r => setTimeout(r, 400));
    }

    const status = hadNetworkFailure
      ? (allItems.length > 0 ? 'partial' : (submittedOk ? 'empty' : 'network_failure'))
      : (allItems.length > 0 ? 'success' : 'empty');
    return {
      mediaItems: allItems,
      totalPosts,
      status,
      ...(hadNetworkFailure ? { errorCode: 'REDDIT_API_HTTP_ERROR' } : {})
    };
  }

  /**
   * Scans a subreddit's posts from the public Reddit JSON API.
   * @param {string} subreddit
   * @param {Object} [options]
   * @param {number} [options.limit=300]
   * @param {"hot"|"new"|"top"} [options.sort="hot"]
   * @returns {Promise<{ items: import('../../core/domain/MediaItem.js').MediaItem[], totalPosts: number, status: 'success' | 'partial' | 'empty' | 'network_failure', errorCode?: string }>}
   */
  static async fetchSubredditPosts(subreddit, options = {}) {
    const limit = options.limit || 300;
    const sort = ['hot', 'new', 'top'].includes(options.sort) ? options.sort : 'hot';
    const allItems = [];
    const seenPostIds = new Set();
    const seenCursors = new Set();
    let after = null;
    let totalPosts = 0;
    let hadNetworkFailure = false;

    while (totalPosts < limit) {
      const url = `https://www.reddit.com/r/${encodeURIComponent(subreddit)}/${sort}.json?limit=100&raw_json=1${after ? `&after=${encodeURIComponent(after)}` : ''}`;
      let children;
      let json;
      try {
        const res = await fetch(url);
        if (!res.ok) {
          hadNetworkFailure = true;
          break;
        }
        json = await res.json();
        children = json.data?.children || [];
      } catch {
        hadNetworkFailure = true;
        break;
      }
      if (children.length === 0) break;

      const beforeCount = totalPosts;
      for (const child of children) {
        const postId = String(child?.data?.id || '').replace(/^t3_/, '');
        if (!postId || seenPostIds.has(postId)) continue;
        seenPostIds.add(postId);
        totalPosts++;
        allItems.push(...RedditScanner.parseApiPostObject(child.data));
      }

      const nextAfter = json.data?.after;
      if (!nextAfter || seenCursors.has(nextAfter) || totalPosts === beforeCount) break;
      seenCursors.add(nextAfter);
      after = nextAfter;
      await new Promise(r => setTimeout(r, 400));
    }

    const status = hadNetworkFailure
      ? (allItems.length > 0 ? 'partial' : 'network_failure')
      : (allItems.length > 0 ? 'success' : 'empty');
    return {
      items: allItems,
      totalPosts,
      status,
      ...(hadNetworkFailure ? { errorCode: 'REDDIT_API_HTTP_ERROR' } : {})
    };
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
