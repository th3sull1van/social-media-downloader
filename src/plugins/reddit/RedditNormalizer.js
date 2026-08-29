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

    const uniqueMap = new Map();
    const removedItems = [];

    for (const item of items) {
      const mediaId = RedditNormalizer.extractMediaIdentifier(item);
      const cleanUrl = item.url ? RedditNormalizer.cleanMediaUrl(item.url) : '';
      const key = (mediaId && mediaId !== 'media' && !mediaId.startsWith('media_'))
        ? `${item.type || 'media'}_${mediaId}`
        : (cleanUrl || item.id || `item_${Math.random()}`);

      const itemScore = typeof item.metadata?.score === 'number' ? item.metadata.score : 0;
      const sub = item.metadata?.subreddit || '';

      if (!uniqueMap.has(key)) {
        uniqueMap.set(key, {
          item: { ...item },
          score: itemScore,
          subreddits: sub ? new Set([sub]) : new Set()
        });
      } else {
        const existing = uniqueMap.get(key);
        if (sub) existing.subreddits.add(sub);

        if (options.keepHighestScore && itemScore > existing.score) {
          removedItems.push(existing.item);
          existing.item = { ...item };
          existing.score = itemScore;
        } else {
          removedItems.push(item);
        }
      }
    }

    const uniqueItems = Array.from(uniqueMap.values()).map(entry => {
      const item = entry.item;
      if (entry.subreddits.size > 1) {
        if (!item.metadata) item.metadata = {};
        item.metadata.crossPostedSubreddits = Array.from(entry.subreddits);
      }
      return item;
    });

    return {
      uniqueItems,
      duplicatesCount: removedItems.length,
      removedItems
    };
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
