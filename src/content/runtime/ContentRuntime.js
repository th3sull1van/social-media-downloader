/**
 * Social Media Downloader — Platform-Agnostic Content Runtime
 * Owns shared content-script state, media store deduplication/upgrading,
 * host-allowlisted URL checks, i18n formatting, and safe runtime messaging.
 */

/**
 * @param {{
 *   env?: any,
 *   platform: string,
 *   allowedHostSuffixesByPlatform: Record<string, string[]>,
 *   isDownscaledUrl?: (url: string) => boolean,
 *   onMediaChanged?: () => void,
 *   onStateReset?: (reason: string) => void
 * }} options
 */
export function createContentRuntime({
  env = /** @type {any} */ (globalThis),
  platform,
  allowedHostSuffixesByPlatform,
  isDownscaledUrl = () => false,
  onMediaChanged = () => {},
  onStateReset = () => {}
}) {
  const chromeApi = env.chrome || (typeof chrome !== 'undefined' ? chrome : undefined);
  const log = env.console || console;
  const allSuffixes = Array.from(new Set(Object.values(allowedHostSuffixesByPlatform).flat()));

  const state = {
    platform,
    targetName: 'Media_Collection',
    username: '',
    targetType: 'profile',
    shortcode: '',
    profileInfo: /** @type {any} */ (null),
    targetAvatarUrl: '',
    media: new Map(),
    selectedIds: new Set(),
    activeFilter: 'all',
    isScanning: false,
    isDownloading: false,
    autoSelectAll: true,
    lastReceiptDownloadId: /** @type {number | null} */ (null),
    redditScanGeneration: 0,
    instagramScanGeneration: 0,
    instagramScanContext: /** @type {any} */ (null)
  };

  /**
   * Validates whether a URL belongs to an allowed media host for the given platform.
   * @param {string} rawUrl
   * @param {string} [itemPlatform]
   * @returns {boolean}
   */
  function isAllowedMediaUrl(rawUrl, itemPlatform = platform) {
    if (!rawUrl || typeof rawUrl !== 'string') return false;
    if (!/^https?:\/\//i.test(rawUrl)) return false;
    try {
      const host = new URL(rawUrl).hostname.toLowerCase();
      const allowed = allowedHostSuffixesByPlatform[itemPlatform] || allSuffixes;
      return allowed.some((suffix) => host === suffix || host.endsWith('.' + suffix));
    } catch (e) {
      return false;
    }
  }

  function isExtensionContextValid() {
    try {
      if (!chromeApi || !chromeApi.runtime) return false;
      if ('id' in chromeApi.runtime && !chromeApi.runtime.id) return false;
      return typeof chromeApi.runtime.sendMessage === 'function';
    } catch (e) {
      return false;
    }
  }

  /**
   * @param {any} message
   * @param {(res: any) => void} [callback]
   */
  function safeSendRuntimeMessage(message, callback) {
    if (!isExtensionContextValid()) {
      if (typeof callback === 'function') callback(undefined);
      return;
    }
    try {
      chromeApi.runtime.sendMessage(message, (res) => {
        if (typeof callback === 'function') callback(res);
      });
    } catch (e) {
      if (typeof callback === 'function') callback(undefined);
    }
  }

  /**
   * @param {string} key
   * @param {string | string[]} [substitutions]
   * @returns {string}
   */
  function t(key, substitutions = []) {
    try {
      if (chromeApi?.i18n && typeof chromeApi.i18n.getMessage === 'function') {
        const subs = Array.isArray(substitutions) ? substitutions : [substitutions];
        const msg = chromeApi.i18n.getMessage(key, subs);
        if (msg) return msg;
      }
    } catch (e) {}
    return key;
  }

  /**
   * @param {string} rawUrl
   * @returns {string}
   */
  function rememberTargetAvatar(rawUrl) {
    const url = String(rawUrl || '').replace(/&amp;/g, '&').trim();
    if (!isAllowedMediaUrl(url)) return '';
    state.targetAvatarUrl = url;
    return url;
  }

  /**
   * Adds normalized media items into the runtime store, upgrading existing IDs
   * when higher resolution, video stream, non-downscaled variant, or dedicated
   * profile-header media arrives.
   * @param {any[]} items
   * @returns {number}
   */
  function addMediaItems(items) {
    if (!Array.isArray(items)) return 0;
    let changedCount = 0;

    for (const item of items) {
      if (!item || !item.id || !item.url) continue;
      const itemPlatform = item.platform || platform;
      if (!isAllowedMediaUrl(item.url, itemPlatform) || !isAllowedMediaUrl(item.downloadUrl || item.url, itemPlatform)) continue;

      if (!state.media.has(item.id)) {
        state.media.set(item.id, item);
        if (state.autoSelectAll) state.selectedIds.add(item.id);
        changedCount++;
      } else {
        const existing = state.media.get(item.id);
        const newPixels = (item.width || 0) * (item.height || 0);
        const oldPixels = (existing.width || 0) * (existing.height || 0);
        const newIsVideo = (item.type === 'video' || item.isVideo) && !(existing.type === 'video' || existing.isVideo);
        const existingIsDownscaled = isDownscaledUrl(existing.downloadUrl || existing.url);
        const newIsNotDownscaled = !isDownscaledUrl(item.downloadUrl || item.url);
        const itemIsProfileHeaderMedia = item.metadata?.source === 'profile_header';
        const existingIsProfileHeaderMedia = existing.metadata?.source === 'profile_header';

        if (itemIsProfileHeaderMedia || (!existingIsProfileHeaderMedia &&
            (newPixels > oldPixels || newIsVideo || (existingIsDownscaled && newIsNotDownscaled)))) {
          state.media.set(item.id, { ...existing, ...item });
          changedCount++;
        }
      }
    }

    if (changedCount > 0) {
      onMediaChanged();
    }
    return changedCount;
  }

  /**
   * Clears collected media state and triggers reset hooks.
   * @param {string} reason
   * @param {() => boolean} [extraReset]
   */
  function resetMediaState(reason, extraReset) {
    const hadCoreState = state.media.size > 0 || state.selectedIds.size > 0 ||
      state.profileInfo !== null || state.targetAvatarUrl !== '';
    state.media.clear();
    state.selectedIds.clear();
    state.profileInfo = null;
    state.targetAvatarUrl = '';
    const hadExtraState = typeof extraReset === 'function' ? Boolean(extraReset()) : false;
    if (!hadCoreState && !hadExtraState) return;
    onStateReset(reason || 'navigation');
    log?.log?.(`[SMD Content] Media state reset (${reason || 'navigation'}).`);
  }

  function readImageSource(element) {
    if (!element) return '';
    for (const property of ['currentSrc', 'src', 'href']) {
      const value = element[property];
      if (typeof value === 'string' && value.trim()) return value.trim();
    }
    for (const attribute of ['src', 'href', 'xlink:href', 'data-src', 'data-lazy-src', 'content']) {
      const value = element.getAttribute?.(attribute);
      if (value && value.trim()) return value.trim();
    }
    const srcset = element.getAttribute?.('srcset');
    if (srcset) {
      const first = srcset.split(',')[0]?.trim().split(/\s+/)[0];
      if (first) return first;
    }
    return '';
  }

  function elementAccessibleText(element) {
    const values = [];
    let current = element;
    for (let depth = 0; current && depth < 5; depth++, current = current.parentElement) {
      for (const attribute of ['alt', 'aria-label', 'title', 'data-testid']) {
        const value = current.getAttribute?.(attribute);
        if (value) values.push(value);
      }
    }
    return values.join(' ').toLowerCase();
  }

  return {
    state,
    isAllowedMediaUrl,
    isExtensionContextValid,
    safeSendRuntimeMessage,
    t,
    rememberTargetAvatar,
    addMediaItems,
    resetMediaState,
    readImageSource,
    elementAccessibleText
  };
}
