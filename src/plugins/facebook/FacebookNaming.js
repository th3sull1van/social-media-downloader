/**
 * Social Media Downloader — Facebook Naming Context
 * Resolves safe folder structures and clean filenames with guaranteed extensions.
 */
import { FilenameService } from '../../core/services/FilenameService.js';

export class FacebookNaming {
  static resolveExtension(item) {
    const isVideo = item.type === 'video';
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
   * Authentic Facebook CDN media basename pattern (e.g.
   * "470799140_2097219780727901_3327205746481550348_n.jpg"). Verified against
   * captured HAR traffic: 184/184 (2026-08-28) and 564/564 basenames match.
   */
  static AUTHENTIC_BASENAME_PATTERN = /^\d+(_\d+)*_n\.(jpg|jpeg|png|webp|heic|mp4|mov|webm)$/i;

  static getOriginalFilename(item, fallbackPrefix = 'facebook_media') {
    const ext = FacebookNaming.resolveExtension(item);

    // 1. Authentic original CDN filename from URL pathname (pattern-checked);
    //    query params (stp/cstp/ctp, signatures) never affect the basename.
    const rawUrl = item.downloadUrl || item.url || '';
    if (rawUrl && typeof rawUrl === 'string') {
      try {
        const parsed = new URL(rawUrl);
        const lastSlash = parsed.pathname.lastIndexOf('/');
        const rawBasename = lastSlash !== -1 ? parsed.pathname.substring(lastSlash + 1) : parsed.pathname;
        const decoded = decodeURIComponent(rawBasename);
        if (decoded && FacebookNaming.AUTHENTIC_BASENAME_PATTERN.test(decoded)) {
          return decoded.toLowerCase();
        }
      } catch (e) {}
    }

    // 2. Fallback: structured photo id with guaranteed extension.
    const photoId = item.metadata?.photoId || item.id || fallbackPrefix;
    const cleanId = FilenameService.sanitize(String(photoId), 50, fallbackPrefix);
    return `${cleanId}.${ext}`;
  }

  static resolveRelativePath(item, targetName, includeRoot = true) {
    const safeTarget = FilenameService.sanitize(targetName || 'Facebook_Media', 60, 'Facebook_Media');
    const rootDir = includeRoot ? `SMD/Facebook/${safeTarget}` : safeTarget;
    const filename = FacebookNaming.getOriginalFilename(item);
    return `${rootDir}/${filename}`;
  }
}
