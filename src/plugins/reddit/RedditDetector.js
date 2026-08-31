/**
 * Social Media Downloader — Reddit Target Detector
 */
import { PlatformTargetModel } from '../../core/domain/PlatformTarget.js';

function isHostOnDomain(hostname, domain) {
  if (typeof hostname !== 'string') return false;
  const normalized = hostname.toLowerCase().replace(/\.+$/, '');
  return normalized === domain || normalized.endsWith(`.${domain}`);
}

export class RedditDetector {
  static matches(context) {
    if (!context) return false;
    let host = typeof context.hostname === 'string' ? context.hostname : '';
    if (!host && typeof context.url === 'string') {
      try { host = new URL(context.url).hostname; } catch (e) { return false; }
    }
    return isHostOnDomain(host, 'reddit.com') || isHostOnDomain(host, 'redd.it');
  }

  static detectTarget(context = {}) {
    const urlStr = context.url || (typeof window !== 'undefined' ? window.location.href : '');
    let targetType = 'feed';
    let targetName = 'Reddit Feed';
    let id = '';

    if (urlStr) {
      if (urlStr.includes('/user/') || urlStr.includes('/u/')) {
        const m = urlStr.match(/\/(?:user|u)\/([^/?#]+)/);
        if (m && m[1]) {
          targetType = 'profile';
          targetName = `u/${m[1]}`;
          id = m[1];
        }
      } else if (urlStr.includes('/r/')) {
        const m = urlStr.match(/\/r\/([^/?#]+)/);
        if (m && m[1]) {
          targetType = 'subreddit';
          targetName = `r/${m[1]}`;
          id = m[1];
        }
      } else if (urlStr.includes('/comments/') || urlStr.includes('/gallery/')) {
        const m = urlStr.match(/\/(?:comments|gallery)\/([a-zA-Z0-9]+)/);
        if (m && m[1]) {
          targetType = 'post';
          targetName = `Post_${m[1]}`;
          id = m[1];
        }
      }
    }

    return PlatformTargetModel.create({
      platform: 'reddit',
      type: /** @type {any} */ (targetType),
      id: id || undefined,
      name: targetName,
      url: urlStr,
      metadata: { targetType, targetName }
    });
  }
}
