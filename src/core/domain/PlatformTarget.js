/**
 * Social Media Downloader — Platform Target Domain Model
 * Describes the active context being scanned (profile, post, album, subreddit, etc.)
 */

/**
 * @typedef {"page" | "post" | "profile" | "album" | "collection" | "subreddit" | "story" | "unknown"} TargetType
 */

/**
 * @typedef {Object} PlatformTarget
 * @property {string} platform
 * @property {TargetType} type
 * @property {string=} id
 * @property {string=} name
 * @property {string=} url
 * @property {Record<string, unknown>} metadata
 */

export class PlatformTargetModel {
  /**
   * Creates and validates a canonical PlatformTarget.
   * @param {Partial<PlatformTarget> & { platform: string, type: TargetType }} data
   * @returns {PlatformTarget}
   */
  static create(data) {
    if (!data || typeof data !== 'object') {
      throw new TypeError('PlatformTarget data must be an object');
    }
    if (!data.platform || typeof data.platform !== 'string') {
      throw new TypeError('PlatformTarget requires a platform string');
    }

    const validTypes = ['page', 'post', 'profile', 'album', 'collection', 'subreddit', 'story', 'unknown'];
    const type = validTypes.includes(data.type) ? data.type : 'unknown';

    return {
      platform: data.platform.toLowerCase(),
      type: type,
      id: data.id ? String(data.id) : undefined,
      name: data.name ? String(data.name) : undefined,
      url: data.url ? String(data.url) : undefined,
      metadata: data.metadata && typeof data.metadata === 'object' ? { ...data.metadata } : {}
    };
  }

  /**
   * Formats a target name safely for display in UI.
   * This is deliberately platform-neutral. Platform-specific display formatting
   * (e.g. a "@" prefix for Instagram handles or a subreddit label for Reddit)
   * belongs to the owning plugin, not to the Core domain model.
   * @param {PlatformTarget} target
   * @returns {string}
   */
  static formatDisplayName(target) {
    if (!target) return 'Media Collection';
    if (typeof target.name === 'string' && target.name.trim()) return target.name;
    if (typeof target.url === 'string' && target.url.trim()) return target.url;
    return 'Media Collection';
  }
}
