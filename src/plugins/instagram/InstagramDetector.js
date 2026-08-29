/**
 * Social Media Downloader — Instagram Target Detector
 */
import { PlatformTargetModel } from '../../core/domain/PlatformTarget.js';

const IG_NON_PROFILE_ROUTES = ['explore', 'reels', 'stories', 'direct', 'accounts', 'emails', 'your_activity', 'settings'];

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
    const host = context.hostname || (context.url ? new URL(context.url).hostname : '');
    return host.includes('instagram.com');
  }

  /**
   * Detects the platform target from current URL and document.
   * @param {Object} context
   * @returns {import('../../core/domain/PlatformTarget.js').PlatformTarget}
   */
  static detectTarget(context = {}) {
    let urlStr = context.url || (typeof window !== 'undefined' ? window.location.href : '');
    let pathname = '';
    try {
      pathname = new URL(urlStr).pathname;
    } catch (e) {
      pathname = '';
    }

    const parts = pathname.split('/').filter(Boolean);
    let username = '';
    let targetType = 'profile';

    if (parts.length > 0 && !IG_NON_PROFILE_ROUTES.includes(parts[0])) {
      username = parts[0];
      targetType = 'profile';
    } else if (parts.length >= 2 && parts[0] === 'stories' && parts[1]) {
      username = parts[1];
      targetType = 'story';
    } else if (parts.length >= 2 && (parts[0] === 'p' || parts[0] === 'reel')) {
      username = parts[1];
      targetType = 'post';
    }

    if (!username && typeof document !== 'undefined') {
      const profileLink = document.querySelector('header a[href^="/"]');
      if (profileLink) {
        const u = profileLink.getAttribute('href')?.replace(/\//g, '');
        if (u && !IG_NON_PROFILE_ROUTES.includes(u)) {
          username = u;
        }
      }
      if (!username && document.title) {
        const m = document.title.match(/\(@([A-Za-z0-9_.]+)\)/);
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
      metadata: { username }
    });
  }
}
