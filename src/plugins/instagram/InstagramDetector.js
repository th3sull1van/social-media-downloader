/**
 * Social Media Downloader — Instagram Target Detector
 */
import { PlatformTargetModel } from '../../core/domain/PlatformTarget.js';

export const IG_NON_PROFILE_ROUTES = [
  'p',
  'reel',
  'reels',
  'stories',
  'explore',
  'direct',
  'accounts',
  'emails',
  'your_activity',
  'settings',
  'live',
  'tv',
  'share',
  'api',
  'about',
  'legal'
];

function isHostOnDomain(hostname, domain) {
  if (typeof hostname !== 'string') return false;
  const normalized = hostname.toLowerCase().replace(/\.+$/, '');
  return normalized === domain || normalized.endsWith(`.${domain}`);
}

export class InstagramDetector {
  /**
   * Checks if context matches Instagram.
   * @param {Object} context
   * @param {string} [context.url]
   * @param {string} [context.hostname]
   * @returns {boolean}
   */
  static matches(context) {
    if (!context) return false;
    let host = typeof context.hostname === 'string' ? context.hostname : '';
    if (!host && typeof context.url === 'string') {
      try { host = new URL(context.url).hostname; } catch (e) { return false; }
    }
    return isHostOnDomain(host, 'instagram.com');
  }

  /**
   * Computes a stable target identity key for SPA navigation comparisons.
   * @param {string} urlStr
   * @returns {string}
   */
  static getTargetKey(urlStr) {
    if (!urlStr) return '';
    let pathname = '';
    try {
      pathname = new URL(urlStr).pathname;
    } catch {
      return '';
    }
    const parts = pathname.split('/').filter(Boolean);
    if (!parts.length) return 'feed';
    const first = parts[0].toLowerCase();
    if (!IG_NON_PROFILE_ROUTES.includes(first)) {
      return `profile:${first}`;
    }
    if (first === 'stories' && parts[1]) {
      return `stories:${parts[1].toLowerCase()}`;
    }
    if ((first === 'p' || first === 'reel' || first === 'reels' || first === 'tv') && parts[1]) {
      return `post:${parts[1]}`;
    }
    return `route:${first}`;
  }

  /**
   * Detects the platform target from current URL and document.
   * @param {Object} context
   * @returns {import('../../core/domain/PlatformTarget.js').PlatformTarget}
   */
  static detectTarget(context = {}) {
    const doc = context.document || (typeof document !== 'undefined' ? document : null);
    let urlStr = context.url || (typeof window !== 'undefined' ? window.location.href : '');
    let pathname = '';
    try {
      pathname = new URL(urlStr).pathname;
    } catch (e) {
      pathname = '';
    }

    const parts = pathname.split('/').filter(Boolean);
    const firstPart = (parts[0] || '').toLowerCase();
    let username = '';
    let targetType = 'profile';
    let shortcode = '';

    if (parts.length > 0 && !IG_NON_PROFILE_ROUTES.includes(firstPart)) {
      username = parts[0];
      targetType = 'profile';
    } else if (parts.length >= 2 && firstPart === 'stories' && parts[1]) {
      username = parts[1];
      targetType = 'story';
    } else if (parts.length >= 2 && (firstPart === 'p' || firstPart === 'reel' || firstPart === 'reels' || firstPart === 'tv')) {
      shortcode = parts[1];
      username = parts[1];
      targetType = 'post';
    }

    if (!username && doc) {
      const profileLink = doc.querySelector('header a[href^="/"]');
      if (profileLink) {
        const u = profileLink.getAttribute('href')?.replace(/\//g, '');
        if (u && !IG_NON_PROFILE_ROUTES.includes(u.toLowerCase())) {
          username = u;
        }
      }
      if (!username && doc.title) {
        const m = doc.title.match(/\(@([A-Za-z0-9_.]+)\)/);
        if (m && m[1]) {
          username = m[1];
        }
      }
    }

    return PlatformTargetModel.create({
      platform: 'instagram',
      type: /** @type {any} */ (targetType),
      id: username || undefined,
      name: username || 'Instagram_Profile',
      url: urlStr,
      metadata: { username, shortcode }
    });
  }
}
