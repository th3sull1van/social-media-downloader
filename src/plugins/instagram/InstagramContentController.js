/**
 * Social Media Downloader — Instagram Content-Script Controller
 * Uses InstagramDetector, InstagramNormalizer, and MetaCdn as single source of truth
 * (eliminating all duplicated normalizer/CDN code from content.js).
 * Loaded lazily only on instagram.com.
 */
import { InstagramDetector, IG_NON_PROFILE_ROUTES } from './InstagramDetector.js';
import { InstagramNormalizer } from './InstagramNormalizer.js';
import { MetaCdn } from '../meta-shared/MetaCdn.js';

export const INSTAGRAM_UI_CONFIG = {
  id: 'instagram',
  label: 'Instagram',
  fabThemeClass: '',
  modalThemeClass: '',
  chipClass: '',
  scanActions: [
    { id: 'smd-scan-posts', labelKey: 'scanPosts', action: 'posts' },
    { id: 'smd-scan-stories', labelKey: 'scanStories', action: 'stories' },
    { id: 'smd-scan-highlights', labelKey: 'scanHighlights', action: 'highlights' },
    { id: 'smd-scan-avatar', labelKey: 'scanAvatar', action: 'avatar' }
  ],
  filterTabs: [
    { id: 'all', labelKey: 'tabAll' },
    { id: 'image', labelKey: 'tabPhotos' },
    { id: 'video', labelKey: 'tabVideos' },
    { id: 'stories', labelKey: 'tabStories' },
    { id: 'highlights', labelKey: 'tabHighlights' }
  ],
  formatTitle: (s) => (s.username ? `@${s.username}` : s.targetName),
  matchesCustomFilter: (item, filterId) => {
    const cat = item.category || item.metadata?.category;
    if (filterId === 'stories') return cat === 'stories';
    if (filterId === 'highlights') return cat === 'highlights';
    return true;
  }
};

/**
 * @param {{
 *   env: any,
 *   runtime: any,
 *   bridge: any,
 *   navTracker: any,
 *   overlay: any,
 *   fallbackIconUrl: string
 * }} deps
 */
export function createInstagramContentController({ env, runtime, bridge, navTracker, overlay, fallbackIconUrl }) {
  const win = env.window || globalThis;
  const doc = env.document || document;
  const log = env.console || console;

  const {
    state,
    isAllowedMediaUrl,
    t,
    rememberTargetAvatar,
    addMediaItems
  } = runtime;

  let lastTargetKey = InstagramDetector.getTargetKey(win.location?.href || '');

  function detectTarget() {
    const url = win.location?.href || '';
    const detected = InstagramDetector.detectTarget({ url, document: doc });
    const parts = (win.location?.pathname || '').split('/').filter(Boolean);
    const first = (parts[0] || '').toLowerCase();

    if (detected.type === 'profile' && parts.length > 0 && !IG_NON_PROFILE_ROUTES.includes(first)) {
      state.username = parts[0];
      state.targetName = parts[0];
      state.targetType = 'profile';
      state.shortcode = '';
    } else if (detected.type === 'story' && parts.length >= 2) {
      state.username = parts[1];
      state.targetName = parts[1];
      state.targetType = 'stories';
      state.shortcode = '';
    } else if (detected.type === 'post' && parts.length >= 2) {
      state.targetType = 'post';
      state.shortcode = parts[1];
      let author = '';
      const authorEl = doc.querySelector('header a[role="link"], article header a, div[role="dialog"] header a');
      if (authorEl) {
        const href = authorEl.getAttribute('href') || '';
        const u = href.replace(/\//g, '').trim();
        if (u && !IG_NON_PROFILE_ROUTES.includes(u.toLowerCase())) {
          author = u;
        }
      }
      if (!author && doc.title) {
        const m = doc.title.match(/\(@([A-Za-z0-9_.]+)\)/);
        if (m && m[1]) author = m[1];
      }
      state.username = author || '';
      state.targetName = author ? `${author}_${parts[1]}` : `post_${parts[1]}`;
    } else {
      state.targetType = first || 'feed';
      state.username = '';
      state.shortcode = '';
      state.targetName = 'Instagram_Media';
    }
  }

  function resolveAvatarUrl() {
    if (isAllowedMediaUrl(state.targetAvatarUrl)) return state.targetAvatarUrl;
    if (isAllowedMediaUrl(state.profileInfo?.hdProfilePicUrl)) return state.profileInfo.hdProfilePicUrl;
    if (isAllowedMediaUrl(state.profileInfo?.profilePicUrl)) return state.profileInfo.profilePicUrl;
    const igAvatarEl = /** @type {HTMLImageElement | null} */ (doc.querySelector('header img[alt*="profile"], header img[alt*="perfil"], header img'));
    const igAvatar = igAvatarEl?.src;
    if (isAllowedMediaUrl(igAvatar)) return rememberTargetAvatar(igAvatar);
    return fallbackIconUrl;
  }

  function processPostNodes(nodes) {
    if (!Array.isArray(nodes) || nodes.length === 0) return;
    const items = [];
    for (const node of nodes) {
      if (!node) continue;
      const normalized = InstagramNormalizer.normalizePost(node);
      for (const item of normalized) {
        items.push({
          ...item,
          category: item.metadata?.category || 'posts',
          ...(item.metadata?.isCarousel ? {
            isCarousel: true,
            slideIndex: item.metadata.slideIndex,
            slideTotal: item.metadata.slideTotal
          } : {})
        });
      }
    }
    if (items.length > 0) addMediaItems(items);
  }

  function processStoryItem(item, category = 'stories', highlightTitle = null) {
    if (!item) return;
    const normalized = InstagramNormalizer.normalizeStory(item, /** @type {'stories' | 'highlights'} */ (category), highlightTitle);
    if (!normalized) return;
    addMediaItems([{
      ...normalized,
      category,
      highlightTitle
    }]);
  }

  function beginScan() {
    navTracker.check();
    const context = {
      generation: ++state.instagramScanGeneration,
      navigationKey: navTracker.currentNavigationKey(),
      requestIds: new Set(),
      cancelled: false
    };
    state.instagramScanContext = context;
    return context;
  }

  function isCurrentScan(context) {
    return !!context && !context.cancelled && state.instagramScanContext === context
      && context.generation === state.instagramScanGeneration
      && context.navigationKey === navTracker.currentNavigationKey();
  }

  function scanDom() {
    const items = [];
    const isPostTarget = state.targetType === 'post' || Boolean(state.shortcode);
    const dialogPost = doc.querySelector('div[role="dialog"] article, div[role="dialog"]');

    if (isPostTarget || dialogPost) {
      const container = dialogPost || doc.querySelector('article') || doc.body;
      const shortcode = state.shortcode || (win.location?.pathname?.match(/\/(?:p|reel|reels|tv)\/([^/?#]+)/)?.[1]) || 'post';

      const imgs = container.querySelectorAll('img');
      let slideIdx = 0;
      imgs.forEach((img) => {
        if (img.closest('header, ul, [data-testid*="comment"], nav, aside')) return;
        if (img.closest('[aria-label*="More posts" i], [aria-label*="Mais publicações" i]')) return;
        const w = img.naturalWidth || img.clientWidth || 0;
        const h = img.naturalHeight || img.clientHeight || 0;
        if ((w > 0 && w < 120) || (h > 0 && h < 120)) return;

        const src = img.currentSrc || img.src;
        if (!src || src.startsWith('data:') || src.includes('profile_pic') || src.includes('/rsrc.php/')) return;
        if (!isAllowedMediaUrl(src)) return;

        let bestSrc = src;
        const srcset = img.getAttribute('srcset');
        if (srcset) {
          const candidates = srcset.split(',').map((entry) => {
            const parts = entry.trim().split(/\s+/);
            return { url: parts[0], width: parseInt(parts[1], 10) || 0 };
          }).sort((a, b) => b.width - a.width);
          if (candidates[0]?.url) bestSrc = candidates[0].url;
        }

        const cleanUrl = MetaCdn.upgradeUrl(bestSrc, 'instagram');
        slideIdx++;
        items.push({
          schemaVersion: 1,
          id: `${shortcode}_slide${slideIdx}`,
          platform: 'instagram',
          type: 'image',
          sourceType: 'instagram_image',
          url: cleanUrl,
          downloadUrl: cleanUrl,
          thumbnailUrl: cleanUrl,
          width: img.naturalWidth || 1080,
          height: img.naturalHeight || 1080,
          category: 'posts',
          capabilities: { directDownload: true, requiresMuxing: false, requiresAuth: false, supportsThumbnail: true },
          metadata: {
            category: 'posts',
            shortcode,
            username: state.username,
            isVideo: false
          }
        });
      });

      const vids = container.querySelectorAll('video');
      vids.forEach((vid, vIdx) => {
        if (vid.closest('header, ul, nav, aside')) return;
        if (vid.closest('[aria-label*="More posts" i], [aria-label*="Mais publicações" i]')) return;
        const src = vid.getAttribute('src') || vid.src || vid.querySelector('source')?.src;
        if (!src || src.startsWith('blob:')) return;
        if (!isAllowedMediaUrl(src)) return;
        const cleanUrl = MetaCdn.upgradeUrl(src, 'instagram');
        const poster = vid.getAttribute('poster');
        const thumb = poster ? MetaCdn.upgradeUrl(poster, 'instagram') : cleanUrl;
        items.push({
          schemaVersion: 1,
          id: `${shortcode}_vid_${vIdx + 1}`,
          platform: 'instagram',
          type: 'video',
          sourceType: 'instagram_video',
          url: cleanUrl,
          downloadUrl: cleanUrl,
          thumbnailUrl: thumb,
          width: vid.videoWidth || 1080,
          height: vid.videoHeight || 1920,
          category: 'posts',
          capabilities: { directDownload: true, requiresMuxing: false, requiresAuth: false, supportsThumbnail: true },
          metadata: {
            category: 'posts',
            shortcode,
            username: state.username,
            isVideo: true
          }
        });
      });

      if (items.length > 0) addMediaItems(items);
      return;
    }

    // Profile grid DOM fallback
    const postLinks = doc.querySelectorAll('main a[href*="/p/"], main a[href*="/reel/"], main a[href*="/reels/"]');
    postLinks.forEach((link) => {
      if (link.closest('[aria-label*="Suggested" i], [aria-label*="Sugestões" i], nav, aside')) return;
      const href = link.getAttribute('href') || '';
      const m = href.match(/\/(?:p|reel|reels|tv)\/([^/?#]+)/);
      if (!m || !m[1]) return;
      const shortcode = m[1];

      const img = link.querySelector('img');
      const vid = link.querySelector('video');

      if (vid) {
        const src = vid.getAttribute('src') || vid.src || vid.querySelector('source')?.src;
        if (src && !src.startsWith('blob:') && isAllowedMediaUrl(src)) {
          const cleanUrl = MetaCdn.upgradeUrl(src, 'instagram');
          const poster = vid.getAttribute('poster');
          const thumb = poster ? MetaCdn.upgradeUrl(poster, 'instagram') : cleanUrl;
          items.push({
            schemaVersion: 1,
            id: `ig_post_${shortcode}`,
            platform: 'instagram',
            type: 'video',
            sourceType: 'instagram_video',
            url: cleanUrl,
            downloadUrl: cleanUrl,
            thumbnailUrl: thumb,
            width: vid.videoWidth || 1080,
            height: vid.videoHeight || 1920,
            category: 'posts',
            capabilities: { directDownload: true, requiresMuxing: false, requiresAuth: false, supportsThumbnail: true },
            metadata: {
              category: 'posts',
              shortcode,
              username: state.username,
              isVideo: true
            }
          });
          return;
        }
      }

      if (img) {
        const src = img.currentSrc || img.src;
        if (!src || src.startsWith('data:') || src.includes('profile_pic') || src.includes('/rsrc.php/')) return;
        if (!isAllowedMediaUrl(src)) return;

        let bestSrc = src;
        const srcset = img.getAttribute('srcset');
        if (srcset) {
          const candidates = srcset.split(',').map((entry) => {
            const parts = entry.trim().split(/\s+/);
            return { url: parts[0], width: parseInt(parts[1], 10) || 0 };
          }).sort((a, b) => b.width - a.width);
          if (candidates[0]?.url) bestSrc = candidates[0].url;
        }

        const cleanUrl = MetaCdn.upgradeUrl(bestSrc, 'instagram');
        items.push({
          schemaVersion: 1,
          id: `ig_post_${shortcode}`,
          platform: 'instagram',
          type: 'image',
          sourceType: 'instagram_image',
          url: cleanUrl,
          downloadUrl: cleanUrl,
          thumbnailUrl: cleanUrl,
          width: img.naturalWidth || 1080,
          height: img.naturalHeight || 1080,
          category: 'posts',
          capabilities: { directDownload: true, requiresMuxing: false, requiresAuth: false, supportsThumbnail: true },
          metadata: {
            category: 'posts',
            shortcode,
            username: state.username,
            isVideo: false
          }
        });
      }
    });

    if (items.length > 0) addMediaItems(items);
  }

  async function scanProfileAvatar(isIndependent = true, context = null) {
    context ||= beginScan();
    let failed = false;
    if (isIndependent) {
      state.isScanning = true;
      overlay.updateScanStatusUI(true, t('scanningProfile'));
    }
    try {
      if (!state.username) detectTarget();
      if (!state.username) return { success: false, status: 'empty' };
      if (!isIndependent && state.profileInfo?.username?.toLowerCase() === state.username.toLowerCase() && (state.profileInfo.id || state.profileInfo.hdProfilePicUrl)) {
        return { success: true, status: 'success' };
      }
      const res = await bridge.send('FETCH_IG_PROFILE', { username: state.username }, context);
      if (context && !isCurrentScan(context)) return { success: false, status: 'cancelled' };
      if (res.success && res.payload?.profile) {
        state.profileInfo = res.payload.profile;
        overlay.updateAvatarUI();
        if (state.profileInfo.hdProfilePicUrl && (!context || isCurrentScan(context))) {
          const avatarItem = InstagramNormalizer.normalizeAvatar(state.username, state.profileInfo.hdProfilePicUrl);
          addMediaItems([{ ...avatarItem, category: 'profile_pic' }]);
        }
      }
      if (!state.profileInfo?.hdProfilePicUrl && doc) {
        const domHeaderImg = /** @type {HTMLImageElement | null} */ (doc.querySelector('header img, main header img, img[alt*="profile"], img[alt*="perfil"]'));
        const domPic = doc.querySelector('meta[property="og:image"]')?.getAttribute('content') || domHeaderImg?.src;
        if (domPic && !domPic.startsWith('data:') && !domPic.includes('static.cdninstagram.com/rsrc.php')) {
          const cleanPic = MetaCdn.upgradeUrl(domPic, 'instagram');
          state.profileInfo = {
            ...(state.profileInfo || {}),
            username: state.username,
            hdProfilePicUrl: cleanPic,
            profilePicUrl: cleanPic
          };
          overlay.updateAvatarUI();
          if (!context || isCurrentScan(context)) {
            const avatarItem = InstagramNormalizer.normalizeAvatar(state.username, cleanPic);
            addMediaItems([{ ...avatarItem, category: 'profile_pic' }]);
          }
        }
      }
      if (!state.profileInfo?.id && doc) {
        try {
          const scripts = doc.querySelectorAll('script:not([src])');
          for (const s of scripts) {
            const text = s.textContent || '';
            if (!text) continue;
            const lowerText = text.toLowerCase();
            const targetLower = state.username.toLowerCase();
            if (lowerText.includes(targetLower) || lowerText.includes('profilepage') || lowerText.includes('polarisprofile')) {
              const m = text.match(/"profile_id":"(\d+)"/) ||
                        text.match(/"page_id":"profilePage_(\d+)"/) ||
                        text.match(/"props":\{"id":"(\d+)"[^}]*"profilePage/) ||
                        text.match(/"container_id":"(\d+)"/) ||
                        text.match(/"target_id":"(\d+)"/);
              if (m && m[1] && m[1] !== '0') {
                state.profileInfo = {
                  ...(state.profileInfo || {}),
                  id: m[1],
                  pk: m[1],
                  username: state.username
                };
                break;
              }
            }
          }
        } catch (e) {}
      }
      if (!res?.success && !state.profileInfo?.hdProfilePicUrl && !state.profileInfo?.id) {
        failed = true;
        if (isIndependent) overlay.updateScanStatusUI(true, t('scanFailed'), true);
      }
      return { success: res?.success === true || !!state.profileInfo?.id, status: state.profileInfo?.id ? 'success' : (res?.status || 'empty') };
    } catch (err) {
      if (context && !isCurrentScan(context)) return { success: false, status: 'cancelled' };
      failed = true;
      if (isIndependent) {
        log?.warn?.('[SMD Content] Instagram profile avatar scan failed:', err);
        overlay.updateScanStatusUI(true, t('scanFailed'), true);
      }
      return { success: false, status: 'network_failure' };
    } finally {
      if (isIndependent && (!context || isCurrentScan(context))) {
        state.isScanning = false;
        if (!failed) overlay.updateScanStatusUI(false);
        else overlay.setScanActionButtonsDisabled(false);
      }
    }
  }

  async function scanAllPosts(isIndependent = true, context = null) {
    context ||= beginScan();
    let failed = false;
    if (isIndependent) {
      state.isScanning = true;
      overlay.updateScanStatusUI(true, t('scanningPosts'));
    }
    try {
      if (state.targetType === 'post') {
        scanDom();
        return { success: true, status: 'success' };
      }
      if (!state.username) detectTarget();
      if (!state.username) {
        if (!context || isCurrentScan(context)) scanDom();
        return { success: false, status: 'empty' };
      }

      const res = await bridge.send('FETCH_IG_POSTS', { username: state.username, maxCount: 5000 }, context);
      if (!isCurrentScan(context)) return { success: false, status: 'cancelled' };
      const nodes = Array.isArray(res.payload?.nodes) ? res.payload.nodes : [];
      if (nodes.length > 0) processPostNodes(nodes);
      if (!res.success && res.status !== 'partial' && res.status !== 'empty') {
        log?.warn?.('[SMD Content] GraphQL posts scan failed; attempting DOM fallback...');
        if (isCurrentScan(context)) scanDom();
      }
      if (res.status === 'partial' || res.status === 'network_failure') {
        failed = true;
        overlay.updateScanStatusUI(true, t('scanFailed'), true);
      } else if (!nodes.length && isCurrentScan(context) && res.status !== 'empty') {
        scanDom();
      }
      return { success: res.success === true, status: res.status || (nodes.length ? 'success' : 'empty') };
    } catch (e) {
      if (!isCurrentScan(context)) return { success: false, status: 'cancelled' };
      failed = true;
      log?.warn?.('[SMD Content] Posts scan error:', e);
      scanDom();
      overlay.updateScanStatusUI(true, t('scanFailed'), true);
      return { success: false, status: 'network_failure' };
    } finally {
      if (isIndependent && isCurrentScan(context)) {
        state.isScanning = false;
        if (!failed) overlay.updateScanStatusUI(false);
        else overlay.setScanActionButtonsDisabled(false);
      }
    }
  }

  async function scanStories(isIndependent = true, context = null) {
    context ||= beginScan();
    let failed = false;
    if (isIndependent) {
      state.isScanning = true;
      overlay.updateScanStatusUI(true, t('scanningStories'));
    }
    try {
      if (!state.profileInfo?.id) await scanProfileAvatar(false, context);
      if (!isCurrentScan(context)) return { success: false, status: 'cancelled' };
      const userId = state.profileInfo?.id;
      if (!userId) return { success: false, status: 'empty' };

      const res = await bridge.send('FETCH_IG_STORIES', { userId }, context);
      if (!isCurrentScan(context)) return { success: false, status: 'cancelled' };
      const items = Array.isArray(res.payload?.items) ? res.payload.items : [];
      for (const it of items) {
        if (!isCurrentScan(context)) return { success: false, status: 'cancelled' };
        processStoryItem(it, 'stories');
      }
      if (res.status === 'network_failure' || res.status === 'partial') {
        failed = true;
        overlay.updateScanStatusUI(true, t('scanFailed'), true);
      }
      return { success: res.success === true, status: res.status || (items.length ? 'success' : 'empty') };
    } catch (e) {
      if (!isCurrentScan(context)) return { success: false, status: 'cancelled' };
      failed = true;
      log?.warn?.('[SMD Content] Stories scan error:', e);
      overlay.updateScanStatusUI(true, t('scanFailed'), true);
      return { success: false, status: 'network_failure' };
    } finally {
      if (isIndependent && isCurrentScan(context)) {
        state.isScanning = false;
        if (!failed) overlay.updateScanStatusUI(false);
        else overlay.setScanActionButtonsDisabled(false);
      }
    }
  }

  async function scanHighlights(isIndependent = true, context = null) {
    context ||= beginScan();
    let failed = false;
    if (isIndependent) {
      state.isScanning = true;
      overlay.updateScanStatusUI(true, t('scanningHighlights'));
    }
    try {
      if (!state.profileInfo?.id) await scanProfileAvatar(false, context);
      if (!isCurrentScan(context)) return { success: false, status: 'cancelled' };
      const userId = state.profileInfo?.id;
      if (!userId) return { success: false, status: 'empty' };

      const res = await bridge.send('FETCH_IG_HIGHLIGHTS', { userId }, context);
      if (!isCurrentScan(context)) return { success: false, status: 'cancelled' };
      if (!res.success && res.status !== 'partial' && res.status !== 'empty') throw new Error('instagram_highlights_failed');
      if (res.payload?.items) {
        for (const it of res.payload.items) {
          if (!isCurrentScan(context)) return { success: false, status: 'cancelled' };
          processStoryItem(it, 'highlights', it._highlightTitle);
        }
      }
      if (res.status === 'partial' || res.status === 'network_failure') {
        failed = true;
        overlay.updateScanStatusUI(true, t('scanFailed'), true);
      }
      return { success: res.success === true, status: res.status || (res.payload?.items?.length ? 'success' : 'empty') };
    } catch (e) {
      if (!isCurrentScan(context)) return { success: false, status: 'cancelled' };
      failed = true;
      log?.warn?.('[SMD Content] Highlights scan error:', e);
      overlay.updateScanStatusUI(true, t('scanFailed'), true);
      return { success: false, status: 'network_failure' };
    } finally {
      if (isIndependent && isCurrentScan(context)) {
        state.isScanning = false;
        if (!failed) overlay.updateScanStatusUI(false);
        else overlay.setScanActionButtonsDisabled(false);
      }
    }
  }

  async function scanAll() {
    if (state.isScanning) return;
    const context = beginScan();
    let failed = false;
    state.isScanning = true;
    overlay.updateScanStatusUI(true, t('scanningAllMedia'));
    try {
      if (state.targetType === 'post') {
        overlay.updateScanStatusUI(true, t('scanningPosts'));
        scanDom();
        return;
      }
      overlay.updateScanStatusUI(true, t('scanningProfile'));
      await scanProfileAvatar(false, context);
      if (!isCurrentScan(context)) return;
      overlay.updateScanStatusUI(true, t('scanningStoriesHighlights'));
      const [storiesRes, highlightsRes] = await Promise.all([
        scanStories(false, context),
        scanHighlights(false, context)
      ]);
      if (!isCurrentScan(context)) return;
      overlay.updateScanStatusUI(true, t('scanningPosts'));
      const postsRes = await scanAllPosts(false, context);
      if ([storiesRes, highlightsRes, postsRes].some((r) => r?.status === 'network_failure' || r?.status === 'partial')) {
        failed = true;
        overlay.updateScanStatusUI(true, t('scanFailed'), true);
      }
    } catch (e) {
      if (isCurrentScan(context)) {
        failed = true;
        log?.warn?.('[SMD Content] Scan all error:', e);
        overlay.updateScanStatusUI(true, t('scanFailed'), true);
      }
    } finally {
      if (isCurrentScan(context)) {
        state.isScanning = false;
        if (!failed) overlay.updateScanStatusUI(false);
        else overlay.setScanActionButtonsDisabled(false);
      }
    }
  }

  return {
    id: 'instagram',
    uiConfig: INSTAGRAM_UI_CONFIG,
    detectTarget,
    init() {
      if (state.targetType === 'post') scanDom();
      else overlay.updateAvatarUI();
    },
    onModalOpen() {
      detectTarget();
      if (state.targetType === 'profile' && !state.profileInfo && !state.isScanning) {
        void scanProfileAvatar(false);
      }
    },
    resolveAvatarUrl,
    scanAll,
    runAction(action) {
      if (action === 'posts') return scanAllPosts(true);
      if (action === 'stories') return scanStories(true);
      if (action === 'highlights') return scanHighlights(true);
      if (action === 'avatar') return scanProfileAvatar(true);
      return Promise.resolve({ success: false, status: 'unsupported' });
    },
    cancelScan() {
      state.instagramScanGeneration++;
      if (state.instagramScanContext) state.instagramScanContext.cancelled = true;
      bridge.send('CANCEL_SCAN').catch(() => {});
      state.isScanning = false;
      overlay.updateScanStatusUI(false);
    },
    onBridgeMessage(data) {
      const { source, payload } = data;
      if (source === 'SMD_IG_NAVIGATION_CHANGED') {
        const setTimer = env.setTimeout || setTimeout;
        setTimer(navTracker.check, 10);
        return;
      }
      const ctx = state.instagramScanContext;
      const trusted = Boolean(
        payload?.requestId &&
        ctx &&
        !ctx.cancelled &&
        ctx.generation === payload.generation &&
        ctx.requestIds.has(payload.requestId)
      );
      if ((source === 'SMD_IG_BATCH_POSTS' || source === 'SMD_IG_BATCH_HIGHLIGHTS') && trusted) {
        bridge.touchRequest(payload.requestId);
        if (source === 'SMD_IG_BATCH_POSTS' && payload.nodes) processPostNodes(payload.nodes);
        if (source === 'SMD_IG_BATCH_HIGHLIGHTS' && payload.items) {
          for (const it of payload.items) processStoryItem(it, 'highlights', it._highlightTitle);
        }
      }
    },
    onNavigation() {
      const nextTargetKey = InstagramDetector.getTargetKey(win.location?.href || '');
      const changedTarget = lastTargetKey !== nextTargetKey;
      lastTargetKey = nextTargetKey;
      if (changedTarget) {
        state.instagramScanGeneration++;
        if (state.instagramScanContext) state.instagramScanContext.cancelled = true;
        state.isScanning = false;
        bridge.send('CANCEL_SCAN').catch(() => {});
      }
      overlay.updateScanStatusUI(false);
      detectTarget();
      if (changedTarget) runtime.resetMediaState('target changed');
    },
    handleMessage(type, sendResponse) {
      if (type === 'TRIGGER_SCAN_POSTS') {
        scanAllPosts(true).then(sendResponse);
        return true;
      }
      if (type === 'TRIGGER_SCAN_STORIES') {
        scanStories(true).then(sendResponse);
        return true;
      }
      if (type === 'TRIGGER_SCAN_HIGHLIGHTS') {
        scanHighlights(true).then(sendResponse);
        return true;
      }
      if (type === 'TRIGGER_SCAN_AVATAR') {
        scanProfileAvatar(true).then(sendResponse);
        return true;
      }
      return false;
    }
  };
}

export const uiConfig = INSTAGRAM_UI_CONFIG;
export const createController = createInstagramContentController;
