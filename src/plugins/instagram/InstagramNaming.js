/**
 * Social Media Downloader — Instagram Naming Context
 * Resolves safe folder structures and authentic, original CDN filenames with guaranteed extensions.
 */
import { FilenameService } from '../../core/services/FilenameService.js';

export class InstagramNaming {
  /**
   * Resolves extension from URL or media type.
   * @param {import('../../core/domain/MediaItem.js').MediaItem} item
   * @returns {string}
   */
  static resolveExtension(item) {
    const isVideo = item.type === 'video' || !!(item.metadata?.isVideo);
    const defaultExt = isVideo ? 'mp4' : 'jpg';

    if (item.extension) return item.extension.toLowerCase();

    const rawUrl = item.downloadUrl || item.url || '';
    if (rawUrl) {
      try {
        const parsed = new URL(rawUrl);
        const m = parsed.pathname.match(/\.(jpg|jpeg|png|webp|heic|mp4|mov|webm)(?:$|\?)/i);
        if (m && m[1]) {
          let e = m[1].toLowerCase();
          if (e === 'jpeg') e = 'jpg';
          return e;
        }
      } catch (e) {}
    }

    return defaultExt;
  }

  /**
   * Authentic Instagram CDN media basename pattern (e.g.
   * "714823214_18556244662067792_4244871484690731199_n.jpg"; legacy short form
   * "111_n.jpg" also accepted). Verified against captured HAR traffic: 794/794
   * image basenames match this convention; video basenames are opaque session
   * tokens ("AQ...", 92-107 chars) served from /o1/v/t2/ paths and are useless
   * as filenames.
   */
  static AUTHENTIC_BASENAME_PATTERN = /^\d+(_\d+)*_n\.(jpg|jpeg|png|webp|heic|mp4|mov|webm)$/i;

  /**
   * Extracts original CDN filename (e.g. 758180480_18641479288003777_7235938730091106999_n.jpg)
   * or falls back to a clean structured identifier with guaranteed extension.
   *
   * The CDN basename is only used when it matches the authentic Instagram media
   * pattern. Opaque CDN tokens (video session IDs like "AQNoX5...mp4") would
   * otherwise become unreadable 100-char filenames.
   * @param {import('../../core/domain/MediaItem.js').MediaItem} item
   * @param {string} [fallbackPrefix='media']
   * @returns {string}
   */
  static getOriginalFilename(item, fallbackPrefix = 'media') {
    const ext = InstagramNaming.resolveExtension(item);

    // 1. Authentic original CDN filename from URL pathname (pattern-checked)
    const rawUrl = item.downloadUrl || item.url || '';
    if (rawUrl && typeof rawUrl === 'string') {
      try {
        const parsed = new URL(rawUrl);
        const lastSlash = parsed.pathname.lastIndexOf('/');
        const rawBasename = lastSlash !== -1 ? parsed.pathname.substring(lastSlash + 1) : parsed.pathname;
        const decoded = decodeURIComponent(rawBasename);
        if (decoded && InstagramNaming.AUTHENTIC_BASENAME_PATTERN.test(decoded)) {
          return decoded.toLowerCase();
        }
      } catch (e) {}
    }

    // 2. Deterministic fallbacks
    const category = /** @type {any} */ (item.metadata)?.category || item.sourceType || '';
    const shortcode = /** @type {any} */ (item.metadata)?.shortcode || /** @type {any} */ (item).code;
    const postId = /** @type {any} */ (item.metadata)?.postId || item.id;
    const slideIdx = /** @type {any} */ (item.metadata)?.slideIndex || /** @type {any} */ (item).slideIndex;
    const isCarousel = /** @type {any} */ (item.metadata)?.isCarousel || /** @type {any} */ (item).isCarousel || !!slideIdx;

    if (category === 'profile_pic' || item.sourceType === 'profile_pic') {
      const u = /** @type {any} */ (item.metadata)?.username || fallbackPrefix;
      const cleanUser = FilenameService.sanitize(u, 40, 'user');
      return `${cleanUser}_profile_pic.${ext}`;
    }

    if (isCarousel && slideIdx) {
      const codeOrId = shortcode || postId || fallbackPrefix;
      const cleanCode = FilenameService.sanitize(String(codeOrId), 40, 'post');
      return `${cleanCode}_slide${slideIdx}.${ext}`;
    }

    if (category === 'stories' || item.sourceType === 'story_item') {
      const cleanId = FilenameService.sanitize(String(postId || item.id || fallbackPrefix), 40, 'story');
      return `story_${cleanId}.${ext}`;
    }

    if (category === 'highlights' || item.sourceType === 'highlight_item') {
      const cleanId = FilenameService.sanitize(String(postId || item.id || fallbackPrefix), 40, 'highlight');
      return `highlight_${cleanId}.${ext}`;
    }

    if (shortcode) {
      const cleanCode = FilenameService.sanitize(String(shortcode), 40, 'post');
      return `${cleanCode}.${ext}`;
    }

    if (postId) {
      const cleanId = FilenameService.sanitize(String(postId), 40, 'post');
      return `${cleanId}.${ext}`;
    }

    return `${FilenameService.sanitize(String(item.id || fallbackPrefix), 40, 'media')}.${ext}`;
  }

  /**
   * Resolves relative path for an Instagram file within a local directory or ZIP archive.
   * @param {import('../../core/domain/MediaItem.js').MediaItem} item
   * @param {string} username
   * @param {boolean} [includeRoot=true]
   * @returns {string}
   */
  static resolveRelativePath(item, username, includeRoot = true) {
    const safeUser = FilenameService.sanitize(username || 'Instagram_Profile', 60, 'Instagram_Profile');
    const rootDir = includeRoot ? `SMD/Instagram/${safeUser}` : '';
    const filename = InstagramNaming.getOriginalFilename(item);

    let subDir = 'posts';
    const category = item.metadata?.category;
    if (category === 'stories') {
      subDir = 'stories';
    } else if (category === 'highlights') {
      const hlTitle = FilenameService.sanitize(String(item.metadata?.albumTitle || item.metadata?.highlightTitle || 'Highlights'), 60, 'Highlights');
      subDir = `highlights/${hlTitle}`;
    } else if (category === 'profile_pic') {
      subDir = 'profile_pic';
    }

    return rootDir ? `${rootDir}/${subDir}/${filename}` : `${subDir}/${filename}`;
  }
}
