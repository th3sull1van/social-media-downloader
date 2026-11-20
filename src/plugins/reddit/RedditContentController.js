/**
 * Social Media Downloader — Reddit Content-Script Controller
 * Owns Reddit target detection, dual-layer scanning (background JSON API +
 * authenticated origin fallback + shreddit DOM fallback), cross-post dedup,
 * and Reddit avatar resolution. Loaded lazily only on reddit.com / redd.it.
 */
import { RedditDetector } from './RedditDetector.js';
import { RedditScanner } from './RedditScanner.js';
import { RedditNormalizer } from './RedditNormalizer.js';

export const REDDIT_UI_CONFIG = {
  id: 'reddit',
  label: 'Reddit',
  fabThemeClass: 'smd-fab-reddit',
  modalThemeClass: 'smd-reddit-theme',
  chipClass: 'smd-chip-reddit',
  scanActions: [
    { id: 'smd-scan-reddit', labelKey: 'scanFeed', action: 'reddit_feed' }
  ],
  filterTabs: [
    { id: 'all', labelKey: 'tabAll' },
    { id: 'image', labelKey: 'tabPhotos' },
    { id: 'video', labelKey: 'tabVideos' },
    { id: 'gallery', labelKey: 'tabGalleries' },
    { id: 'redgifs', labelKey: 'tabRedgifs' }
  ],
  matchesCustomFilter: (item, filterId) => {
    if (filterId === 'gallery') return Boolean(item.sourceType === 'reddit_gallery' || item.metadata?.isGallery);
    if (filterId === 'redgifs') return Boolean(item.sourceType === 'redgifs' || item.metadata?.isRedGifs);
    return true;
  }
};

/**
 * @param {{
 *   env: any,
 *   runtime: any,
 *   navTracker: any,
 *   overlay: any,
 *   fallbackIconUrl: string
 * }} deps
 */
export function createRedditContentController({ env, runtime, navTracker, overlay, fallbackIconUrl }) {
  const win = env.window || globalThis;
  const doc = env.document || document;
  const chromeApi = env.chrome || (typeof chrome !== 'undefined' ? chrome : undefined);
  const setTimer = env.setTimeout || setTimeout;
  const log = env.console || console;
  const fetchFn = env.fetch || (typeof fetch === 'function' ? fetch : undefined);

  const {
    state,
    isAllowedMediaUrl,
    isExtensionContextValid,
    safeSendRuntimeMessage,
    t,
    rememberTargetAvatar,
    addMediaItems,
    readImageSource,
    elementAccessibleText
  } = runtime;

  function getTargetInfo() {
    const detected = RedditDetector.detectTarget({ url: win.location?.href || '' });
    if (detected.type === 'post' && detected.id) return { kind: 'post', id: detected.id };
    if (detected.type === 'profile' && detected.id) return { kind: 'user', id: detected.id };
    if (detected.type === 'subreddit' && detected.id) return { kind: 'subreddit', id: detected.id };
    return { kind: 'feed', id: '' };
  }

  function detectTarget() {
    const info = getTargetInfo();
    if (info.kind === 'post') {
      state.username = '';
      state.targetName = `post_${info.id}`;
      state.targetType = 'post';
    } else if (info.kind === 'user') {
      state.username = info.id;
      state.targetName = `u_${info.id}`;
      state.targetType = 'profile';
    } else if (info.kind === 'subreddit') {
      state.username = info.id;
      state.targetName = `r_${info.id}`;
      state.targetType = 'subreddit';
    } else {
      state.username = '';
      state.targetName = 'Reddit_Feed';
      state.targetType = 'feed';
    }
  }

  function resolveAvatarUrl() {
    if (isAllowedMediaUrl(state.targetAvatarUrl)) return state.targetAvatarUrl;

    const target = getTargetInfo();
    const scopes = [];
    for (const selector of [
      'shreddit-profile-header',
      'shreddit-profile-page',
      '[data-testid="profile-header"]',
      '[slot="profile-header"]',
      '#profile-header'
    ]) {
      const scope = doc.querySelector(selector);
      if (scope && !scopes.includes(scope)) scopes.push(scope);
    }
    const main = doc.querySelector('main') || doc.body;
    if (main && !scopes.includes(main)) scopes.push(main);
    if (scopes.length === 0 && doc.body) scopes.push(doc.body);

    const isCommunity = (url) => /communityIcon/i.test(url);
    const isUserAvatar = (url) => /profileIcon|snoovatar|useravatar|redditstatic\.com\/avatars\//i.test(url);
    let best = { score: 0, url: '' };

    for (const scope of scopes) {
      const elements = scope.querySelectorAll?.('img, image') || [];
      for (const image of elements) {
        const src = readImageSource(image);
        if (!src || !isAllowedMediaUrl(src)) continue;

        const community = isCommunity(src);
        const userAvatar = isUserAvatar(src);
        if (target.kind === 'user' && community) continue;
        if (target.kind === 'subreddit' && !community && !userAvatar) continue;
        if (target.kind === 'post') continue;

        let score = scope !== doc.body ? 35 : 0;
        const accessibleName = elementAccessibleText(image);
        if (/avatar|profile|usu[áa]rio|user|community|comunidade|subreddit/i.test(accessibleName)) score += 20;
        if (userAvatar) score += 80;
        if (community) score += target.kind === 'subreddit' ? 90 : 0;
        if (image.getAttribute?.('aria-hidden') === 'true' && target.kind !== 'subreddit') score -= 20;

        if (score > best.score) best = { score, url: src };
      }
    }

    if (best.url && best.score >= 35) return rememberTargetAvatar(best.url);
    return fallbackIconUrl;
  }

  function scheduleAvatarRefresh() {
    if (!isExtensionContextValid()) return;
    if (!state.targetAvatarUrl) {
      const target = getTargetInfo();
      if (target.kind === 'user' || target.kind === 'subreddit') {
        safeSendRuntimeMessage({
          type: 'REDDIT_FETCH_AVATAR',
          payload: { kind: target.kind, id: target.id }
        }, (response) => {
          if (chromeApi?.runtime?.lastError) return;
          const url = rememberTargetAvatar(response?.avatarUrl);
          if (url) overlay.updateAvatarUI();
        });
      }
    }
    for (const delay of [250, 1000, 2500]) {
      setTimer(() => {
        if (isExtensionContextValid()) overlay.updateAvatarUI();
      }, delay);
    }
  }

  function dedupItems(rawItems) {
    if (!Array.isArray(rawItems) || rawItems.length <= 1) return rawItems || [];
    return RedditNormalizer.deduplicateMediaItems(rawItems).uniqueItems;
  }

  async function domFallback(isCurrent = () => true) {
    const postEls = Array.from(doc.querySelectorAll('shreddit-post'));
    const collected = [];
    for (let i = 0; i < postEls.length; i++) {
      if (!isCurrent()) return 0;
      const postEl = postEls[i];
      if (i > 0 && i % 15 === 0) {
        await new Promise((r) => setTimer(r, 0));
      }
      let postData;
      try {
        postData = RedditScanner.extractFromShredditPost(postEl);
      } catch (err) {
        log?.warn?.('[SMD Content] shreddit post extraction failed:', err);
        continue;
      }
      if (!postData || !Array.isArray(postData.mediaItems) || postData.mediaItems.length === 0) continue;

      const postInfo = {
        id: postData.id,
        title: postData.title,
        author: postData.author,
        subreddit: postData.subreddit,
        score: postData.score,
        isGallery: postData.isGallery
      };
      for (const mi of postData.mediaItems) {
        if (!isCurrent()) return 0;
        try {
          const item = RedditNormalizer.normalizeItem(mi, postInfo);
          if (item) collected.push(item);
        } catch (err) {
          log?.warn?.('[SMD Content] shreddit media normalization failed:', err);
        }
      }
    }

    if (!isCurrent() || collected.length === 0) return 0;

    const { uniqueItems } = RedditNormalizer.deduplicateMediaItems(collected);
    if (isCurrent() && uniqueItems.length > 0) {
      addMediaItems(uniqueItems);
    }
    return uniqueItems.length;
  }

  async function scanAll(isIndependent = true) {
    if (isIndependent && state.isScanning) return true;
    navTracker.check();
    const generation = ++state.redditScanGeneration;
    const targetKey = navTracker.currentNavigationKey();
    const isCurrent = () => generation === state.redditScanGeneration && targetKey === navTracker.currentNavigationKey();
    let failed = false;
    if (isIndependent) {
      state.isScanning = true;
      overlay.updateScanStatusUI(true, t('scanning'));
    }
    try {
      const target = getTargetInfo();
      if (target.kind !== 'feed') {
        const res = await new Promise((resolve) => {
          safeSendRuntimeMessage({
            type: 'REDDIT_SCAN',
            payload: { kind: target.kind, id: target.id }
          }, (response) => {
            if (chromeApi?.runtime?.lastError) {
              resolve({ success: false, error: chromeApi.runtime.lastError.message });
            } else {
              resolve(response || { success: false, error: 'No response' });
            }
          });
        });

        if (!isCurrent()) return true;
        const responseAvatar = rememberTargetAvatar(res?.avatarUrl);
        if (responseAvatar) overlay.updateAvatarUI();

        const items = Array.isArray(res?.items) ? res.items : [];
        if (items.length > 0) {
          addMediaItems(dedupItems(items));
          if (res.status === 'partial' || res.status === 'network_failure') {
            failed = true;
            overlay.updateScanStatusUI(true, t('scanFailed'), true);
          }
          return !failed;
        }
        if (res.status === 'partial' || res.status === 'network_failure') {
          failed = true;
          overlay.updateScanStatusUI(true, t('scanFailed'), true);
        }

        // In-page JSON fallback using the tab's own Reddit origin (supports old/new/sh.reddit.com)
        if (fetchFn) {
          try {
            let pageItems = [];
            if (!isCurrent()) return true;
            if (!state.targetAvatarUrl && (target.kind === 'user' || target.kind === 'subreddit')) {
              const pageAvatar = await RedditScanner.fetchTargetAvatar(target.kind, target.id);
              if (!isCurrent()) return true;
              if (rememberTargetAvatar(pageAvatar)) overlay.updateAvatarUI();
            }
            const origin = win.location?.origin || '';
            const redditOrigin = /^https?:\/\/[^/]*reddit\.com$/i.test(origin)
              ? origin
              : 'https://www.reddit.com';
            if (target.kind === 'user') {
              const userUrl = `${redditOrigin}/user/${encodeURIComponent(target.id)}/submitted.json?limit=100&raw_json=1`;
              const uRes = await fetchFn(userUrl, { headers: { Accept: 'application/json' } });
              if (uRes.ok) {
                const uJson = await uRes.json();
                for (const child of (uJson.data?.children || [])) {
                  pageItems.push(...RedditScanner.parseApiPostObject(child.data));
                }
              }
            } else if (target.kind === 'subreddit') {
              const subUrl = `${redditOrigin}/r/${encodeURIComponent(target.id)}/hot.json?limit=100&raw_json=1`;
              const sRes = await fetchFn(subUrl, { headers: { Accept: 'application/json' } });
              if (sRes.ok) {
                const sJson = await sRes.json();
                for (const child of (sJson.data?.children || [])) {
                  pageItems.push(...RedditScanner.parseApiPostObject(child.data));
                }
              }
            } else if (target.kind === 'post') {
              const pResult = await RedditScanner.fetchPostById(target.id);
              pageItems = pResult.items || [];
            }

            if (!isCurrent()) return true;
            if (pageItems.length > 0) {
              failed = false;
              addMediaItems(dedupItems(pageItems));
              return true;
            }
          } catch (err) {
            log?.warn?.('[SMD Content] In-page JSON fetch fallback error:', err);
          }
        }
      }

      if (!isCurrent()) return true;
      const domCount = await domFallback(isCurrent);
      if (!isCurrent()) return true;
      if (domCount > 0) failed = false;
      if (!state.targetAvatarUrl) overlay.updateAvatarUI();
      if (domCount === 0) {
        log?.warn?.('[SMD Content] Reddit scan returned 0 items (empty, private, or quarantined target).');
      }
      return !failed;
    } catch (e) {
      if (!isCurrent()) return true;
      failed = true;
      log?.warn?.('[SMD Content] Reddit scan failed:', e);
      overlay.updateScanStatusUI(true, t('scanFailed'), true);
      return false;
    } finally {
      if (isIndependent && isCurrent()) {
        state.isScanning = false;
        if (!failed) overlay.updateScanStatusUI(false);
        else overlay.setScanActionButtonsDisabled(false);
      }
    }
  }

  return {
    id: 'reddit',
    uiConfig: REDDIT_UI_CONFIG,
    detectTarget,
    init() {
      scheduleAvatarRefresh();
    },
    resolveAvatarUrl,
    scanAll,
    runAction(action) {
      if (action === 'reddit_feed') return scanAll(true);
      return Promise.resolve(false);
    },
    cancelScan() {
      state.redditScanGeneration++;
      state.isScanning = false;
      overlay.updateScanStatusUI(false);
    },
    onNavigation() {
      state.redditScanGeneration++;
      state.isScanning = false;
      overlay.updateScanStatusUI(false);
      detectTarget();
      runtime.resetMediaState('target changed');
      scheduleAvatarRefresh();
    },
    handleMessage(type, sendResponse) {
      if (type === 'TRIGGER_SCAN_GALLERIES') {
        overlay.setModalActiveFilter('gallery');
        scanAll(true).then(() => sendResponse({ success: true }));
        return true;
      }
      if (type === 'TRIGGER_SCAN_VIDEOS') {
        overlay.setModalActiveFilter('video');
        scanAll(true).then(() => sendResponse({ success: true }));
        return true;
      }
      if (type === 'TRIGGER_SCAN_REDGIFS') {
        overlay.setModalActiveFilter('redgifs');
        scanAll(true).then(() => sendResponse({ success: true }));
        return true;
      }
      return false;
    }
  };
}

export const uiConfig = REDDIT_UI_CONFIG;
export const createController = createRedditContentController;
