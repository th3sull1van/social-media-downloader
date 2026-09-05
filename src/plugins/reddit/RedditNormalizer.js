/**
 * Social Media Downloader — Reddit Media Normalizer
 * Cleans preview URLs to uncompressed high-res, extracts identifiers, and deduplicates items.
 */
import { MediaItemModel } from '../../core/domain/MediaItem.js';
import { FilenameService } from '../../core/services/FilenameService.js';

export class RedditNormalizer {
  /**
   * Replaces preview.redd.it with uncompressed i.redd.it full-resolution original URLs.
   * @param {string} url
   * @returns {string}
   */
  static cleanMediaUrl(url) {
    if (!url || typeof url !== 'string') return '';
    url = url.replace(/&amp;/g, '&');

    if (url.includes('external-preview.redd.it') || url.includes('styles.redditmedia.com')) {
      return url.split('?')[0];
    }

    if (url.includes('preview.redd.it')) {
      const match = url.match(/([a-zA-Z0-9]{5,})\.(jpg|jpeg|png|gif|webp)(?:\?|$)/i);
      if (match) {
        return `https://i.redd.it/${match[1]}.${match[2]}`;
      }
      return url.split('?')[0];
    }

    return url;
  }

  /**
   * Extracts media ID from URL or item.
   * @param {any} itemOrUrl
   * @returns {string}
   */
  static extractMediaIdentifier(itemOrUrl) {
    let url = typeof itemOrUrl === 'string' ? itemOrUrl : (itemOrUrl?.url || itemOrUrl?.previewUrl || itemOrUrl?.downloadUrl || '');
    url = url.replace(/&amp;/g, '&');

    // 1. Reddit image / preview (e.g. i.redd.it/jbx4ht0eptkh1.jpg)
    const reddMatch = url.match(/(?:i\.redd\.it|preview\.redd\.it)\/(?:[a-zA-Z0-9_-]+-v0-)?([a-zA-Z0-9_-]+)\.(?:jpg|jpeg|png|gif|webp)/i);
    if (reddMatch) return reddMatch[1];

    // 2. Reddit video (v.redd.it/xyz)
    const vMatch = url.match(/v\.redd\.it\/([a-zA-Z0-9_-]+)/i);
    if (vMatch) return vMatch[1];

    // 3. RedGifs
    const rgMatch = url.match(/redgifs\.com\/(?:watch|ifr|gifs)\/([a-zA-Z0-9_-]+)/i);
    if (rgMatch) return rgMatch[1].toLowerCase();

    // 4. Imgur
    const imgurMatch = url.match(/imgur\.com\/([a-zA-Z0-9_-]+)/i);
    if (imgurMatch) return imgurMatch[1];

    // 5. If item has explicit media ID
    if (typeof itemOrUrl === 'object' && itemOrUrl?.id && typeof itemOrUrl.id === 'string' && /^[a-zA-Z0-9_-]+$/.test(itemOrUrl.id) && !itemOrUrl.id.startsWith('http')) {
      return itemOrUrl.id;
    }

    const clean = url.split('?')[0].split('#')[0];
    const base = clean.split('/').pop()?.replace(/\.[a-zA-Z0-9]{3,4}$/, '') || 'media';
    return FilenameService.sanitize(base, 40, 'media');
  }

  /**
   * Deduplicates Reddit media items across cross-posts keeping highest score.
   * @param {import('../../core/domain/MediaItem.js').MediaItem[]} items
   * @param {Object} [options]
   * @param {boolean} [options.keepHighestScore=true]
   * @returns {{ uniqueItems: import('../../core/domain/MediaItem.js').MediaItem[], duplicatesCount: number, removedItems: import('../../core/domain/MediaItem.js').MediaItem[] }}
   */
  static deduplicateMediaItems(items, options = { keepHighestScore: true }) {
    if (!Array.isArray(items) || items.length <= 1) {
      return { uniqueItems: items || [], duplicatesCount: 0, removedItems: [] };
    }

    const prepared = items.map(item => ({
      ...item,
      metadata: { ...item.metadata },
      deduplicationKey: item.deduplicationKey || RedditNormalizer.getDeduplicationKey(item),
      deduplicationPriority: typeof item.metadata?.score === 'number' ? item.metadata.score : 0
    }));
    const subreddits = new Map();
    for (const item of prepared) {
      if (!item.deduplicationKey) continue;
      const subs = subreddits.get(item.deduplicationKey) || new Set();
      if (item.metadata.subreddit) subs.add(item.metadata.subreddit);
      for (const sub of Array.isArray(item.metadata.crossPostedSubreddits) ? item.metadata.crossPostedSubreddits : []) subs.add(sub);
      subreddits.set(item.deduplicationKey, subs);
    }
    const result = MediaItemModel.deduplicate(prepared, options.keepHighestScore !== false);
    for (const item of result.uniqueItems) {
      const subs = subreddits.get(item.deduplicationKey);
      if (subs?.size > 1) item.metadata.crossPostedSubreddits = Array.from(subs);
    }
    return result;
  }

  /** Identity for dedup only; filename identifiers remain independent.
   * @param {any} item
   * @returns {string}
   */
  static getDeduplicationKey(item) {
    const raw = item.url || item.downloadUrl || item.previewUrl;
    if (!raw) return '';
    let url;
    try { url = new URL(raw.replace(/&amp;/g, '&')); } catch { return ''; }
    if (!['http:', 'https:'].includes(url.protocol)) return '';
    const host = url.hostname;
    const type = item.type || 'media';
    let match;
    if (['i.redd.it', 'preview.redd.it'].includes(host) &&
        (match = url.pathname.match(/\/(?:[a-zA-Z0-9_-]+-v0-)?([a-zA-Z0-9_-]+)\.(jpg|jpeg|png|gif|webp)$/i))) {
      return `${type}:reddit-image:${match[1]}`;
    }
    if (host === 'v.redd.it' && (match = url.pathname.match(/^\/([a-zA-Z0-9_-]+)(?:\/|$)/))) {
      return `${type}:reddit-video:${match[1]}`;
    }
    if (['redgifs.com', 'www.redgifs.com'].includes(host) &&
        (match = url.pathname.match(/^\/(?:watch|ifr|gifs)\/([a-zA-Z0-9_-]+)\/?$/i))) {
      return `${type}:redgifs:${match[1].toLowerCase()}`;
    }
    if (['imgur.com', 'www.imgur.com', 'i.imgur.com'].includes(host)) {
      if ((match = url.pathname.match(/^\/(a|gallery)\/([a-zA-Z0-9_-]+)\/?$/))) {
        return `${type}:imgur:${match[1]}:${match[2]}`;
      }
      if ((match = url.pathname.match(/^\/([a-zA-Z0-9_-]+)(?:\.(?:jpg|jpeg|png|gif|webp|mp4))?$/i))) {
        return `${type}:imgur-media:${match[1]}`;
      }
    }
    // Unknown origins retain path AND query: neither is proof of equivalence.
    url.hash = '';
    return `${type}:url:${url.href}`;
  }

  /**
   * Normalizes a raw item or post into canonical MediaItem.
   * @param {any} raw
   * @param {Object} [postInfo]
   * @returns {import('../../core/domain/MediaItem.js').MediaItem}
   */
  static normalizeItem(raw, postInfo = {}) {
    const rawUrl = raw.url || raw.highResUrl || raw.previewUrl || '';
    const cleanUrl = RedditNormalizer.cleanMediaUrl(rawUrl);
    const mediaId = RedditNormalizer.extractMediaIdentifier(raw);
    const isVideo = raw.type === 'video' || !!raw.baseUrl || raw.isRedGifs || raw.type === 'redgifs';
    const isRedGifs = raw.isRedGifs || raw.type === 'redgifs' || (rawUrl && rawUrl.includes('redgifs.com'));
    const isGallery = postInfo.isGallery || postInfo.postType === 'gallery' || raw.isGallery;

    const ext = raw.ext || (isVideo ? 'mp4' : (cleanUrl.match(/\.(png|gif|webp|jpeg|jpg)/i)?.[1] || 'jpg'));

    const title = postInfo.title || raw.title || 'reddit_media';
    const author = postInfo.author || raw.author || 'user';
    const subreddit = postInfo.subreddit || raw.subreddit || 'reddit';
    const score = postInfo.score ?? raw.score ?? 0;

    return MediaItemModel.create({
      id: raw.id || `${postInfo.id || 'post'}_${raw.index || 1}`,
      platform: 'reddit',
      type: isVideo ? 'video' : 'image',
      deduplicationKey: RedditNormalizer.getDeduplicationKey({ url: rawUrl, type: isVideo ? 'video' : 'image' }),
      deduplicationPriority: typeof score === 'number' && Number.isFinite(score) ? score : 0,
      sourceType: isRedGifs ? 'redgifs' : (isGallery ? 'reddit_gallery' : (isVideo ? 'reddit_video' : 'reddit_image')),
      url: cleanUrl,
      downloadUrl: cleanUrl,
      thumbnailUrl: raw.previewUrl || raw.thumbUrl || raw.posterUrl || cleanUrl,
      extension: ext,
      title: title.slice(0, 100),
      author: {
        username: author,
        name: author
      },
      collection: {
        id: subreddit,
        name: `r/${subreddit}`,
        type: 'subreddit'
      },
      metadata: {
        postId: postInfo.id || raw.postId,
        author,
        subreddit,
        score,
        mediaId,
        isGallery,
        isRedGifs,
        baseUrl: raw.baseUrl,
        fallbackUrl: raw.fallbackUrl,
        index: raw.index || 1,
        total: raw.total || 1
      },
      capabilities: {
        directDownload: !raw.baseUrl && !isRedGifs,
        requiresMuxing: !!raw.baseUrl,
        requiresAuth: false,
        supportsThumbnail: true
      }
    });
  }
}
