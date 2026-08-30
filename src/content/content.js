/**
 * Social Media Downloader — Content Script (Isolated World)
 * Manages in-page floating widget, embedded modal overlay, DOM scanning (Instagram / Facebook),
 * Reddit scan requests, and bridges communication between injected scripts, popup, and background.
 *
 * Notes:
 * - This is a classic script (no ES modules): shared logic with src/plugins/* is duplicated here
 *   deliberately (see docs/platforms/<platform>/KNOWN_LIMITATIONS.md).
 * - The floating widget must be reachable on all three supported surfaces:
 *   Instagram (GraphQL scans), Facebook (photo-tab navigation scans), Reddit (public JSON API scans).
 */

(function () {
  'use strict';

  if (typeof window !== 'undefined' && window.top && window !== window.top) return;
  if (window.__SOCIAL_MEDIA_DOWNLOADER_CONTENT__) return;
  window.__SOCIAL_MEDIA_DOWNLOADER_CONTENT__ = true;

  const hostname = window.location.hostname;
  const isInstagram = hostname.includes('instagram.com');
  const isFacebook = hostname.includes('facebook.com');
  const isReddit = hostname.includes('reddit.com') || hostname.includes('redd.it');
  const platform = isInstagram ? 'instagram' : (isFacebook ? 'facebook' : (isReddit ? 'reddit' : 'unknown'));

  // Host allowlist for any URL that ends up in chrome.downloads or <img src>.
  const DOWNLOAD_URL_HOST_SUFFIXES = [
    'instagram.com', 'cdninstagram.com', 'fbcdn.net',
    'reddit.com', 'redd.it', 'redditmedia.com', 'redgifs.com', 'imgur.com'
  ];

  function isAllowedMediaUrl(rawUrl) {
    if (!rawUrl || typeof rawUrl !== 'string') return false;
    if (!/^https?:\/\//i.test(rawUrl)) return false;
    try {
      const host = new URL(rawUrl).hostname.toLowerCase();
      return DOWNLOAD_URL_HOST_SUFFIXES.some((suffix) => host === suffix || host.endsWith('.' + suffix));
    } catch (e) {
      return false;
    }
  }

  const state = {
    platform,
    targetName: 'Media_Collection',
    username: '',
    profileInfo: null,
    media: new Map(),
    selectedIds: new Set(),
    activeFilter: 'all',
    isScanning: false,
    isDownloading: false,
    autoSelectAll: true,
    pendingRequests: new Map()
  };

  // Lazy module import. Used to share the same Video/Reel/CollectionTile
  // classifier between the content-script walker and the service-worker
  // normalizer, so a Reel cover can never be emitted as a photo from one
  // path while the other filters it out.
  let metaNodePromise = null;
  function loadMetaNode() {
    if (!metaNodePromise) {
      try {
        metaNodePromise = import(chrome.runtime.getURL('src/plugins/meta-shared/MetaNode.js'));
      } catch (e) {
        metaNodePromise = Promise.resolve(null);
      }
    }
    return metaNodePromise;
  }
  // Synchronous fallbacks used when the module hasn't loaded yet (e.g. the
  // very first sweep). Keep them identical to MetaNode.isVideoNode /
  // MetaNode.isCollectionTile so the two paths never disagree.
  function fbIsVideoNodeSync(node) {
    if (!node || typeof node !== 'object') return false;
    if (node.__typename === 'Video' || node.__typename === 'ReelsTrayItem') return true;
    if (node.playable_url || node.playable_url_dash) return true;
    if (Array.isArray(node.video_versions) && node.video_versions.length > 0) return true;
    return false;
  }
  function fbIsCollectionTileSync(node) {
    if (!node || typeof node !== 'object') return false;
    if (node.__typename === 'TimelineAppCollectionItem') return true;
    return 'collection_item_type' in node;
  }

  // One-time nonce for the content <-> injected-world bridge.
  // Raises the bar for page scripts spoofing our postMessage protocol.
  const BRIDGE_NONCE = 'smd_' + Math.random().toString(36).slice(2, 12);

  function t(key, substitutions = []) {
    try {
      if (typeof chrome !== 'undefined' && chrome.i18n && typeof chrome.i18n.getMessage === 'function') {
        const subs = Array.isArray(substitutions) ? substitutions : [substitutions];
        const msg = chrome.i18n.getMessage(key, subs);
        if (msg) return msg;
      }
    } catch (e) {}
    return key;
  }

  // 1. Injected Scripts for Main World
  function injectMainWorldScript(scriptPath) {
    try {
      const script = document.createElement('script');
      script.src = chrome.runtime.getURL(scriptPath);
      script.onload = function () { this.remove(); };
      (document.head || document.documentElement).appendChild(script);
    } catch (e) {
      console.warn('[SMD Content] Failed to inject main-world script:', e);
    }
  }

  if (isInstagram) {
    injectMainWorldScript('src/plugins/instagram/main-world/injected.js');
  } else if (isFacebook) {
    injectMainWorldScript('src/plugins/facebook/main-world/injected.js');
    sendToInjected('PING').catch(() => {});
  }

  // 2. Main-World Bridge (nonce-verified).
  function sendToInjected(type, payload = {}) {
    return new Promise((resolve) => {
      const requestId = 'req_' + Math.random().toString(36).slice(2, 9);
      state.pendingRequests.set(requestId, resolve);

      window.postMessage({
        source: 'SMD_CONTENT',
        nonce: BRIDGE_NONCE,
        type,
        requestId,
        payload
      }, '*');

      setTimeout(() => {
        if (state.pendingRequests.has(requestId)) {
          state.pendingRequests.delete(requestId);
          console.warn(`[SMD Bridge] ${type} timed out (30s).`);
          resolve({ success: false, error: 'Timeout' });
        }
      }, 30000);
    });
  }

  window.addEventListener('message', (event) => {
    if (event.source !== window || !event.data) return;
    const { source, nonce, requestId, success, payload, error } = event.data;

    if (nonce !== BRIDGE_NONCE) return;

    // Response from request
    if (source === 'SMD_IG_INJECTED_RESPONSE' || source === 'SMD_FB_INJECTED_RESPONSE') {
      if (state.pendingRequests.has(requestId)) {
        const resolve = state.pendingRequests.get(requestId);
        state.pendingRequests.delete(requestId);
        resolve({ success, payload, error });
      }
    }

    // Real-time batch streams during deep scans
    if (source === 'SMD_IG_BATCH_POSTS' && payload?.nodes) {
      processInstagramPostNodes(payload.nodes);
    }

    if (source === 'SMD_IG_BATCH_HIGHLIGHTS' && payload?.items) {
      for (const it of payload.items) {
        processInstagramStoryItem(it, 'highlights', it._highlightTitle);
      }
    }

    if (source === 'SMD_FB_MEDIA_BATCH' && payload?.items) {
      addMediaItems(payload.items);
    }

    if (source === 'SMD_FB_BATCH_PHOTOS' && payload?.text) {
      fbProcessGraphQLText(payload.text);
    }
  });

  // 3. Target Detection + SPA navigation tracking.
  function currentNavigationKey() {
    return platform + '::' + window.location.pathname + '::' + window.location.search;
  }

  function resetMediaState(reason) {
    if (state.media.size === 0 && state.selectedIds.size === 0) return;
    state.media.clear();
    state.selectedIds.clear();
    state.profileInfo = null;
    updateFloatingWidgetBadge();
    renderModalGrid();
    console.log(`[SMD Content] Media state reset (${reason || 'navigation'}).`);
  }

  let lastNavigationKey = currentNavigationKey();
  let lastFacebookTargetKey = null;
  let facebookScanTargetKey = '';
  // photoId -> full-resolution URL learned from embedded Comet payloads (Photo.viewer_image).
  // The rendered grid tiles only expose thumbnail URLs; the harvest prefers this map.
  const facebookFullByPhotoId = new Map();

  function facebookTargetKey(url = window.location.href) {
    if (!isFacebook) return '';
    let parsed;
    try { parsed = new URL(url, window.location.origin); } catch { return ''; }
    const pathname = parsed.pathname || '';
    const profileId = pathname.match(/^\/profile\.php$/i)
      ? parsed.searchParams.get('id')
      : null;
    if (profileId) return `profile:${profileId}`;
    const parts = pathname.split('/').filter(Boolean);
    const reserved = new Set(['photos', 'photos_by', 'photos_of', 'photos_albums', 'media', 'albums', 'reels', 'videos']);
    const profileSlug = parts.find((part) => !reserved.has(part.toLowerCase()));
    return profileSlug ? `profile:${profileSlug.toLowerCase()}` : '';
  }

  function isSameFacebookTarget(nextTarget) {
    if (!isFacebook) return false;
    const previous = state.username || state.targetName || '';
    return previous === nextTarget;
  }

  function checkNavigationChanged() {
    const key = currentNavigationKey();
    if (key !== lastNavigationKey) {
      const previousFacebookTarget = lastFacebookTargetKey || facebookScanTargetKey || facebookTargetKey();
      lastNavigationKey = key;
      detectTarget();
      const nextFacebookTarget = facebookTargetKey();
      lastFacebookTargetKey = nextFacebookTarget || previousFacebookTarget;
      // Facebook changes the pathname for every photo tab. Those routes still
      // belong to the same profile, so route changes must not erase collected
      // media. Reset only when both route identities are known and differ.
      const changedFacebookProfile = isFacebook && previousFacebookTarget && nextFacebookTarget
        && previousFacebookTarget !== nextFacebookTarget;
      const shouldReset = !isFacebook
        ? true
        : changedFacebookProfile && !state.isScanning;
      if (shouldReset) resetMediaState('target changed');
    }
  }

  // The three sites are SPAs: patch history + poll as a cheap safety net.
  try {
    const origPush = history.pushState.bind(history);
    const origReplace = history.replaceState.bind(history);
    history.pushState = function () {
      const r = origPush.apply(this, arguments);
      setTimeout(checkNavigationChanged, 60);
      return r;
    };
    history.replaceState = function () {
      const r = origReplace.apply(this, arguments);
      setTimeout(checkNavigationChanged, 60);
      return r;
    };
    window.addEventListener('popstate', () => setTimeout(checkNavigationChanged, 60));
  } catch (e) {}
  setInterval(checkNavigationChanged, 1000);

  const FB_GENERIC_TERMS = new Set([
    'facebook', 'notificações', 'notificacoes', 'notifications', 'notificaciones',
    'menu', 'navegação', 'navigation', 'feed', 'amigos', 'friends', 'fotos', 'photos',
    'álbuns', 'albuns', 'albums', 'sobre', 'about', 'watch', 'vídeos', 'videos',
    'marketplace', 'gaming', 'grupos', 'groups', 'mensagens', 'messages', 'pesquisar',
    'search', 'configurações', 'settings', 'ajuda', 'help', 'publicações', 'posts',
    'facebook_media', 'media_collection'
  ]);

  function fbIsGenericTerm(str) {
    if (!str || typeof str !== 'string') return true;
    const s = str.trim().toLowerCase();
    if (!s || s.length < 2) return true;
    if (FB_GENERIC_TERMS.has(s)) return true;
    if (s === 'facebook' || s.startsWith('facebook ') || (s.startsWith('facebook') && (s.includes('entre') || s.includes('log in') || s.includes('sign up')))) return true;
    return false;
  }

  function fbCleanTitle(title) {
    if (!title || typeof title !== 'string') return '';
    let cleaned = title
      .replace(/^\s*[\(\[]\s*\d+\+?\s*[\)\]]\s*/, '')
      .replace(/\s*(?:\||–|—|-|•)\s*Facebook(?:\s*\(.*\))?\s*$/i, '')
      .replace(/\s+(?:on|no|en|auf|sur|em)\s+Facebook\s*$/i, '')
      .replace(/\s*\|\s*Meta\s*$/i, '')
      .trim();

    const sectionMatch = cleaned.match(/^(.+?)\s*(?:[-–—|•:]\s*(?:Fotos|Photos|Sobre|About|Amigos|Friends|Vídeos|Videos|Reels|Álbuns|Albums))$/i);
    if (sectionMatch && sectionMatch[1] && !fbIsGenericTerm(sectionMatch[1])) {
      cleaned = sectionMatch[1].trim();
    }

    return fbIsGenericTerm(cleaned) ? '' : cleaned;
  }

  /**
   * Extracts a profile identity from the URL when the DOM offers none (SPA
   * photo-viewer dialogs wipe document.title and carry no og:title/h1).
   * Handles the observed link grammars (2026-08-29 capture):
   *   profile.php?id=<pid>            -> profile_<pid>
   *   /photo/?fbid=<fid>&set=pb.<pid>.<epoch>  -> profile_<pid>
   *   /photo/?fbid=<fid>&set=t.<pid>           -> profile_<pid>
   *   /photo/?fbid=<fid>&set=a.<album>[.<pid>[.<epoch>]] -> profile_<pid> (segment that differs from the album)
   *   /<slug>/photos/...              -> slug with dots spaced
   * Returns '' when nothing identity-bearing is found (caller decides fallback).
   */
  function fbNameFromUrl(href) {
    try {
      const url = new URL(href);
      const profileId = url.searchParams.get('id');
      if (profileId && /^\d+$/.test(profileId)) return `profile_${profileId}`;

      const setId = url.searchParams.get('set') || '';
      if (setId) {
        const segs = setId.split('.');
        if (/^pb$/i.test(segs[0]) && /^\d+$/.test(segs[1] || '')) return `profile_${segs[1]}`;
        if (/^t$/i.test(segs[0]) && /^\d+$/.test(segs[1] || '')) return `profile_${segs[1]}`;
        if (/^a$/i.test(segs[0])) {
          const pid = segs.slice(1).find((s) => /^\d+$/.test(s) && s.length >= 15 && s !== segs[1]);
          if (pid) return `profile_${pid}`;
        }
      }

      const parts = url.pathname.split('/').filter(Boolean);
      const FB_GENERIC_ROUTES = new Set([
        'home.php', 'watch', 'gaming', 'marketplace', 'groups', 'events', 'saved',
        'memories', 'pages', 'ads', 'messages', 'notifications', 'friends', 'bookmarks',
        'settings', 'help', 'login', 'recover', 'stories', 'reels', 'share', 'photo',
        'photos', 'media', 'permalink.php', 'story.php', 'search', 'photo.php', 'profile.php'
      ]);
      if (parts.length >= 2 && parts[0] === 'people') {
        return parts[1].replace(/[-_+.]+/g, ' ').trim();
      }
      if (parts.length > 0 && !FB_GENERIC_ROUTES.has(parts[0].toLowerCase())) {
        return parts[0].replace(/\.\d+$/, '').replace(/\./g, ' ').trim();
      }
    } catch (e) {}
    return '';
  }

  function detectTarget() {
    const pathname = window.location.pathname;

    if (isInstagram) {
      const parts = pathname.split('/').filter(Boolean);
      const IG_NON_ROUTES = [
        'p', 'reel', 'reels', 'stories', 'explore', 'direct', 'accounts',
        'emails', 'your_activity', 'settings', 'live', 'tv', 'share', 'api', 'about', 'legal'
      ];
      if (parts.length > 0 && !IG_NON_ROUTES.includes(parts[0].toLowerCase())) {
        state.username = parts[0];
        state.targetName = parts[0];
      } else if (parts.length >= 2 && parts[0] === 'stories' && parts[1]) {
        state.username = parts[1];
        state.targetName = parts[1];
      } else {
        // Fallback: extract author from page elements (post view / dialog)
        const authorEl = document.querySelector('header a[role="link"], article header a, div[role="dialog"] header a');
        if (authorEl) {
          const href = authorEl.getAttribute('href') || '';
          const u = href.replace(/\//g, '').trim();
          if (u && !IG_NON_ROUTES.includes(u.toLowerCase())) {
            state.username = u;
            state.targetName = u;
          }
        }
        if (!state.username && document.title) {
          const m = document.title.match(/\(@([A-Za-z0-9_.]+)\)/);
          if (m && m[1]) {
            state.username = m[1];
            state.targetName = m[1];
          }
        }
      }
    } else if (isFacebook) {
      let name = fbCleanTitle(document.title);

      if (!name) {
        const h1 = document.querySelector('div[role="main"] h1, main h1, h1[dir="auto"], h1');
        const text = (h1?.textContent || '').trim();
        if (text && !fbIsGenericTerm(text)) {
          name = text;
        }
      }

      if (!name) {
        const ogTitle = document.querySelector('meta[property="og:title"]')?.getAttribute('content');
        if (ogTitle) {
          const cleanedOg = fbCleanTitle(ogTitle);
          if (cleanedOg && !fbIsGenericTerm(cleanedOg)) {
            name = cleanedOg;
          }
        }
      }

      if (!name) {
        name = fbNameFromUrl(window.location.href);
      }

      // SPA photo-viewer dialogs wipe document.title to a generic value; when
      // neither the DOM nor the URL yields an identity, KEEP the previous
      // target instead of degrading a good name to the generic fallback.
      // Otherwise the ZIP is named facebook_Facebook_Media_...zip even though
      // the profile was identified earlier. See user report 2026-08-29.
      if (!name) {
        const previous = state.username || state.targetName || '';
        if (previous && previous !== 'Facebook_Media') {
          name = previous;
        }
      }

      if (!name || fbIsGenericTerm(name)) {
        name = 'Facebook_Media';
      }

      const nextTarget = name.replace(/^slug:/i, '').trim() || 'Facebook_Media';
      state.targetName = nextTarget;
      state.username = nextTarget;
    } else if (isReddit) {
      // Mirror redditTargetInfo(): user → subreddit → post, keeping the raw id.
      const m = pathname.match(/\/(?:user|u)\/([^/?#]+)/);
      if (m && m[1]) {
        state.username = m[1];
        state.targetName = `u_${m[1]}`;
      } else {
        const r = pathname.match(/\/r\/([^/?#]+)/);
        if (r && r[1]) {
          state.username = r[1];
          state.targetName = `r_${r[1]}`;
        } else {
          const p = pathname.match(/\/comments\/([a-z0-9]+)/i);
          if (p && p[1]) {
            state.username = '';
            state.targetName = `post_${p[1]}`;
          }
        }
      }
    }
  }

  detectTarget();

  function isDownscaledRender(url) {
    if (!url || typeof url !== 'string') return false;
    try {
      const u = new URL(url);
      const ctp = /(\d+)x(\d+)/i.exec(u.searchParams.get('ctp'));
      const cstp = /(\d+)x(\d+)/i.exec(u.searchParams.get('cstp'));
      if (ctp && cstp) {
        const requested = Number(ctp[1]) * Number(ctp[2]);
        const available = Number(cstp[1]) * Number(cstp[2]);
        if (requested < available) return true;
      }
      const stp = u.searchParams.get('stp');
      if (/[?&]stp=[^&]*[sc]\d+x\d+/i.test(url) || /c\d+\.\d+\.\d+\.\d+/i.test(stp)) {
        return true;
      }
      return false;
    } catch (e) {
      return false;
    }
  }

  // 4. Media Accumulation & Normalization
  let renderFrameScheduled = false;
  function scheduleModalGridRender() {
    if (renderFrameScheduled) return;
    renderFrameScheduled = true;
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => {
        renderFrameScheduled = false;
        renderModalGrid();
      });
    } else {
      setTimeout(() => {
        renderFrameScheduled = false;
        renderModalGrid();
      }, 0);
    }
  }

  function addMediaItems(items) {
    if (!Array.isArray(items)) return;
    let addedCount = 0;

    for (const item of items) {
      if (!item || !item.id || !item.url) continue;
      if (!isAllowedMediaUrl(item.url)) continue;
      if (!state.media.has(item.id)) {
        state.media.set(item.id, item);
        if (state.autoSelectAll) state.selectedIds.add(item.id);
        addedCount++;
      } else {
        const existing = state.media.get(item.id);
        const newPixels = (item.width || 0) * (item.height || 0);
        const oldPixels = (existing.width || 0) * (existing.height || 0);
        const newIsVideo = (item.type === 'video' || item.isVideo) && !(existing.type === 'video' || existing.isVideo);
        const existingIsDownscaled = isDownscaledRender(existing.downloadUrl || existing.url);
        const newIsNotDownscaled = !isDownscaledRender(item.downloadUrl || item.url);

        if (newPixels > oldPixels || newIsVideo || (existingIsDownscaled && newIsNotDownscaled)) {
          state.media.set(item.id, { ...existing, ...item });
        }
      }
    }

    if (addedCount > 0) {
      updateFloatingWidgetBadge();
      scheduleModalGridRender();
    }
  }

  // Deduplicated via MetaCdn (meta-shared), loaded lazily like MetaNode — the
  // content script is a classic script and cannot use static imports.
  let metaCdnPromise = null;
  function loadMetaCdn() {
    if (!metaCdnPromise) {
      try {
        metaCdnPromise = import(chrome.runtime.getURL('src/plugins/meta-shared/MetaCdn.js'));
      } catch (e) {
        metaCdnPromise = Promise.resolve(null);
      }
    }
    return metaCdnPromise;
  }

  function upgradeCdnUrl(url, platform = 'instagram') {
    // Synchronous passthrough until the shared module resolves; the very first
    // sweep may see raw URLs, subsequent calls get the upgraded variants.
    loadMetaCdn().then((mod) => {
      if (mod?.MetaCdn) metaCdnUpgrade = mod.MetaCdn.upgradeUrl;
    });
    if (metaCdnUpgrade) return metaCdnUpgrade(url, platform);
    return url;
  }
  let metaCdnUpgrade = null;

  function sortIgCandidates(candidates) {
    if (!Array.isArray(candidates)) return [];
    const cropRank = (c) => (/[?&]stp=[^&]*c\d+\.\d+\.\d+\.\d+[a-z]?/i.test(String(c?.url || '')) ? 1 : 0);
    return [...candidates].sort((a, b) => {
      const areaA = (a.width || 0) * (a.height || 0);
      const areaB = (b.width || 0) * (b.height || 0);
      return (areaB - areaA) || ((b.width || 0) - (a.width || 0)) || (cropRank(a) - cropRank(b));
    });
  }

  function processInstagramPostNodes(nodes) {
    const items = [];
    for (const node of nodes) {
      const postId = String(node.id || node.pk || '');
      const postCode = node.code || postId;
      const caption = typeof node.caption === 'object' && node.caption !== null
        ? (node.caption.text || '')
        : (typeof node.caption === 'string' ? node.caption : '');
      const takenAt = node.taken_at || Math.floor(Date.now() / 1000);
      const mediaType = node.media_type || (node.video_versions && node.video_versions.length > 0 ? 2 : 1);

      // Carousel
      if (mediaType === 8 || (Array.isArray(node.carousel_media) && node.carousel_media.length > 0)) {
        const carItems = node.carousel_media || [];
        carItems.forEach((cItem, cIdx) => {
          const isVid = cItem.media_type === 2 || (cItem.video_versions && cItem.video_versions.length > 0);
          let highResUrl = null;
          let thumbUrl = null;
          let width = 0;
          let height = 0;

          if (isVid && cItem.video_versions?.length > 0) {
            const sorted = [...cItem.video_versions].sort((a, b) => (b.width || 0) - (a.width || 0));
            highResUrl = sorted[0].url;
            width = sorted[0].width || 1080;
            height = sorted[0].height || 1920;
          }

          if (cItem.image_versions2?.candidates?.length > 0) {
            const sortedImgs = sortIgCandidates(cItem.image_versions2.candidates);
            if (!highResUrl) {
              highResUrl = sortedImgs[0].url;
              width = sortedImgs[0].width || 1080;
              height = sortedImgs[0].height || 1080;
            }
            const mid = Math.min(1, sortedImgs.length - 1);
            thumbUrl = sortedImgs[mid]?.url || sortedImgs[0]?.url;
          }

          if (highResUrl) {
            const cleanUrl = upgradeCdnUrl(highResUrl);
            const cleanThumb = thumbUrl ? upgradeCdnUrl(thumbUrl) : cleanUrl;
            items.push({
              id: `${postId}_slide${cIdx + 1}`,
              platform: 'instagram',
              type: isVid ? 'video' : 'image',
              url: cleanUrl,
              downloadUrl: cleanUrl,
              thumbnailUrl: cleanThumb,
              width,
              height,
              caption,
              category: 'posts',
              isCarousel: true,
              slideIndex: cIdx + 1,
              slideTotal: carItems.length,
              metadata: {
                shortcode: postCode,
                postId,
                slideIndex: cIdx + 1,
                slideTotal: carItems.length,
                takenAt,
                category: 'posts',
                isCarousel: true,
                isVideo: isVid
              }
            });
          }
        });
        continue;
      }

      // Single Video
      if (mediaType === 2 || (Array.isArray(node.video_versions) && node.video_versions.length > 0)) {
        const sorted = [...(node.video_versions || [])].sort((a, b) => (b.width || 0) - (a.width || 0));
        const highResUrl = sorted[0]?.url;
        let thumbUrl = null;
        let width = sorted[0]?.width || 1080;
        let height = sorted[0]?.height || 1920;

        if (node.image_versions2?.candidates?.length > 0) {
          const sortedImgs = sortIgCandidates(node.image_versions2.candidates);
          const mid = Math.min(1, sortedImgs.length - 1);
          thumbUrl = sortedImgs[mid]?.url || sortedImgs[0]?.url;
        }

        if (highResUrl) {
          const cleanUrl = upgradeCdnUrl(highResUrl);
          const cleanThumb = thumbUrl ? upgradeCdnUrl(thumbUrl) : (node.display_url || cleanUrl);
          items.push({
            id: postId,
            platform: 'instagram',
            type: 'video',
            url: cleanUrl,
            downloadUrl: cleanUrl,
            thumbnailUrl: cleanThumb,
            width,
            height,
            caption,
            category: 'posts',
            metadata: {
              shortcode: postCode,
              postId,
              takenAt,
              category: 'posts',
              isVideo: true
            }
          });
        }
        continue;
      }

      // Single Photo
      if (node.image_versions2?.candidates?.length > 0) {
        const sortedImgs = sortIgCandidates(node.image_versions2.candidates);
        const highResUrl = sortedImgs[0].url;
        const mid = Math.min(1, sortedImgs.length - 1);
        const thumbUrl = sortedImgs[mid]?.url || highResUrl;
        const cleanUrl = upgradeCdnUrl(highResUrl);
        const cleanThumb = upgradeCdnUrl(thumbUrl);

        items.push({
          id: postId,
          platform: 'instagram',
          type: 'image',
          url: cleanUrl,
          downloadUrl: cleanUrl,
          thumbnailUrl: cleanThumb,
          width: sortedImgs[0].width || 1080,
          height: sortedImgs[0].height || 1080,
          caption,
          category: 'posts',
          metadata: {
            shortcode: postCode,
            postId,
            takenAt,
            category: 'posts',
            isVideo: false
          }
        });
      }
    }

    addMediaItems(items);
  }

  function processInstagramStoryItem(item, category = 'stories', highlightTitle = null) {
    if (!item) return;
    const isVid = item.media_type === 2 || (Array.isArray(item.video_versions) && item.video_versions.length > 0);
    let highResUrl = null;
    let thumbUrl = null;
    let width = 0;
    let height = 0;

    if (isVid && item.video_versions?.length > 0) {
      const sorted = [...item.video_versions].sort((a, b) => (b.width || 0) - (a.width || 0));
      highResUrl = sorted[0].url;
      width = sorted[0].width || 1080;
      height = sorted[0].height || 1920;
    }

    if (item.image_versions2?.candidates?.length > 0) {
      const sortedImgs = sortIgCandidates(item.image_versions2.candidates);
      if (!highResUrl) {
        highResUrl = sortedImgs[0].url;
        width = sortedImgs[0].width || 1080;
        height = sortedImgs[0].height || 1920;
      }
      const mid = Math.min(1, sortedImgs.length - 1);
      thumbUrl = sortedImgs[mid]?.url || sortedImgs[0]?.url;
    }

    if (!highResUrl) return;
    const cleanUrl = upgradeCdnUrl(highResUrl);
    const cleanThumb = thumbUrl ? upgradeCdnUrl(thumbUrl) : cleanUrl;

    addMediaItems([{
      id: String(item.id || item.pk),
      platform: 'instagram',
      type: isVid ? 'video' : 'image',
      url: cleanUrl,
      downloadUrl: cleanUrl,
      thumbnailUrl: cleanThumb,
      width,
      height,
      category,
      highlightTitle,
      metadata: {
        category,
        highlightTitle,
        albumTitle: highlightTitle,
        isVideo: isVid
      }
    }]);
  }

  function getAvatarUrl() {
    const fallbackIcon = chrome.runtime.getURL('assets/icons/icon32.png');
    if (state.profileInfo?.hdProfilePicUrl) return state.profileInfo.hdProfilePicUrl;
    if (state.profileInfo?.profilePicUrl) return state.profileInfo.profilePicUrl;
    if (isInstagram) {
      const igAvatar = document.querySelector('header img[alt*="profile"], header img[alt*="perfil"], header img')?.src;
      if (igAvatar) return igAvatar;
    } else if (isFacebook) {
      const fbAvatar = document.querySelector('svg[aria-label] image, div[role="main"] image')?.getAttribute('xlink:href');
      if (fbAvatar) return fbAvatar;
    } else if (isReddit) {
      // Scope to header element to avoid whole-document DOM query on infinite-scroll pages
      const headerScope = document.querySelector('shreddit-profile-header, header, [slot="header"], #profile-header') || document.body;
      const redditAvatar = headerScope?.querySelector(
        'img[src*="profileIcon"], img[src*="communityIcon"], img[src*="useravatar"], img[alt*="avatar" i]'
      );
      const redditSrc = redditAvatar ? (redditAvatar.src || '').split('?')[0] : '';
      if (redditSrc) return redditSrc;
    }
    return fallbackIcon;
  }

  function updateAvatarUI() {
    const avatarEl = uiGetById('smd-target-avatar');
    if (avatarEl) {
      avatarEl.src = isFacebook ? getFacebookTargetAvatarUrl() : getAvatarUrl();
      avatarEl.onerror = function () {
        this.src = chrome.runtime.getURL('assets/icons/icon32.png');
      };
    }
  }

  function getFacebookTargetAvatarUrl() {
    const fallbackIcon = chrome.runtime.getURL('assets/icons/icon32.png');
    const main = document.querySelector('div[role="main"]') || document.body;
    const images = main.querySelectorAll('img[src*="fbcdn.net"], image[xlink\\:href*="fbcdn.net"], image[href*="fbcdn.net"]');
    // The first fbcdn image on a profile page is the COVER photo (wide, often
    // aria-hidden). The profile avatar is circular (border-radius) and its
    // accessible name mentions "foto de perfil"/"profile picture" (user report
    // 2026-08-29: cover thumbnail was being shown instead of the avatar).
    let bestCircularSrc = '';
    let bestCircularWidth = 0;
    for (const image of images) {
      const src = image.currentSrc || image.getAttribute('src') || image.getAttribute('xlink:href') || image.getAttribute('href') || '';
      if (!src || !isAllowedMediaUrl(src) || src.includes('emoji.php')) continue;

      // Decorative cover/banners advertise themselves as aria-hidden.
      if (image.getAttribute('aria-hidden') === 'true') continue;

      const accessibleName = (image.getAttribute('alt') || '')
        + ' ' + (image.closest('[role="img"], [aria-label]')?.getAttribute('aria-label') || '');
      if (/foto de perfil|profile picture|photo de profil/i.test(accessibleName)) {
        return src;
      }

      // Circular render => profile avatar candidate (keep the widest).
      const rect = image.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0 && rect.width / rect.height < 1.2) {
        const radius = getComputedStyle(image).borderRadius;
        const circular = radius === '50%' || radius === '9999px' || radius === '9999px 9999px 9999px 9999px';
        if (circular && rect.width > bestCircularWidth) {
          bestCircularWidth = rect.width;
          bestCircularSrc = src;
        }
      }
    }
    if (bestCircularSrc) return bestCircularSrc;
    return fallbackIcon;
  }

  // 5. Instagram Scanning Methods
  async function scanProfileAvatar(isIndependent = true) {
    if (isIndependent) {
      state.isScanning = true;
      updateScanStatusUI(true, t('scanningProfile'));
    }
    try {
      if (!state.username) detectTarget();
      if (!state.username) return;
      const res = await sendToInjected('FETCH_IG_PROFILE', { username: state.username });
      if (res.success && res.payload?.profile) {
        state.profileInfo = res.payload.profile;
        updateAvatarUI();
        if (state.profileInfo.hdProfilePicUrl) {
          const cleanPic = upgradeCdnUrl(state.profileInfo.hdProfilePicUrl);
          addMediaItems([{
            id: `profile_pic_${state.username}`,
            platform: 'instagram',
            type: 'image',
            url: cleanPic,
            downloadUrl: cleanPic,
            thumbnailUrl: cleanPic,
            width: 1080,
            height: 1080,
            category: 'profile_pic',
            metadata: { category: 'profile_pic', username: state.username }
          }]);
        }
      }
    } catch (err) {
      if (isIndependent) {
        console.warn('[SMD Content] Instagram profile avatar scan failed:', err);
        updateScanStatusUI(true, t('scanFailed'), true);
        setTimeout(() => updateScanStatusUI(false), 6000);
      }
    } finally {
      if (isIndependent) {
        state.isScanning = false;
        updateScanStatusUI(false);
      }
    }
  }

  function scanInstagramDom() {
    const items = [];

    const imgElements = document.querySelectorAll('article img, div[role="dialog"] img, main img');
    imgElements.forEach((img, idx) => {
      const src = img.getAttribute('src') || img.src;
      if (!src || src.startsWith('data:') || src.includes('s150x150')) return;
      const cleanUrl = upgradeCdnUrl(src);
      const isAvatar = src.includes('profile_pic') || (img.alt && img.alt.includes('profile'));
      const cat = isAvatar ? 'profile_pic' : 'posts';
      const id = `dom_ig_img_${idx}_${cleanUrl.slice(-20)}`;
      items.push({
        id,
        platform: 'instagram',
        type: 'image',
        url: cleanUrl,
        downloadUrl: cleanUrl,
        thumbnailUrl: cleanUrl,
        width: img.naturalWidth || 1080,
        height: img.naturalHeight || 1080,
        category: cat,
        metadata: {
          category: cat,
          username: state.username,
          isVideo: false
        }
      });
    });

    const videoElements = document.querySelectorAll('article video, div[role="dialog"] video, main video');
    videoElements.forEach((vid, idx) => {
      const src = vid.getAttribute('src') || vid.src || vid.querySelector('source')?.src;
      if (!src || src.startsWith('blob:')) return;
      const cleanUrl = upgradeCdnUrl(src);
      const thumb = vid.getAttribute('poster') ? upgradeCdnUrl(vid.getAttribute('poster')) : cleanUrl;
      const id = `dom_ig_vid_${idx}_${cleanUrl.slice(-20)}`;
      items.push({
        id,
        platform: 'instagram',
        type: 'video',
        url: cleanUrl,
        downloadUrl: cleanUrl,
        thumbnailUrl: thumb,
        width: vid.videoWidth || 1080,
        height: vid.videoHeight || 1920,
        category: 'posts',
        metadata: {
          category: 'posts',
          username: state.username,
          isVideo: true
        }
      });
    });

    if (items.length > 0) {
      addMediaItems(items);
    }
  }

  async function scanAllPosts(isIndependent = true) {
    if (isIndependent) {
      state.isScanning = true;
      updateScanStatusUI(true, t('scanningPosts'));
    }
    try {
      if (!state.username) detectTarget();
      if (!state.username) {
        scanInstagramDom();
        return;
      }

      const res = await sendToInjected('FETCH_IG_POSTS', { username: state.username, maxCount: 5000 });
      if (res.success && res.payload?.nodes?.length > 0) {
        processInstagramPostNodes(res.payload.nodes);
      } else {
        console.warn('[SMD Content] GraphQL returned 0 posts or failed, attempting DOM fallback...');
        scanInstagramDom();
      }
    } catch (e) {
      console.warn('[SMD Content] Posts scan error:', e);
      scanInstagramDom();
    } finally {
      if (isIndependent) {
        state.isScanning = false;
        updateScanStatusUI(false);
      }
    }
  }

  async function scanStories(isIndependent = true) {
    if (isIndependent) {
      state.isScanning = true;
      updateScanStatusUI(true, t('scanningStories'));
    }
    try {
      if (!state.profileInfo?.id) await scanProfileAvatar(false);
      const userId = state.profileInfo?.id;
      if (!userId) return;

      const res = await sendToInjected('FETCH_IG_STORIES', { userId });
      if (res.success && res.payload?.items) {
        for (const it of res.payload.items) {
          processInstagramStoryItem(it, 'stories');
        }
      }
    } catch (e) {
      console.warn('[SMD Content] Stories scan error:', e);
      updateScanStatusUI(true, t('scanFailed'), true);
    } finally {
      if (isIndependent) {
        state.isScanning = false;
        updateScanStatusUI(false);
      }
    }
  }

  async function scanHighlights(isIndependent = true) {
    if (isIndependent) {
      state.isScanning = true;
      updateScanStatusUI(true, t('scanningHighlights'));
    }
    try {
      if (!state.profileInfo?.id) await scanProfileAvatar(false);
      const userId = state.profileInfo?.id;
      if (!userId) return;

      const res = await sendToInjected('FETCH_IG_HIGHLIGHTS', { userId });
      if (res.success && res.payload?.items) {
        for (const it of res.payload.items) {
          processInstagramStoryItem(it, 'highlights', it._highlightTitle);
        }
      }
    } catch (e) {
      console.warn('[SMD Content] Highlights scan error:', e);
      updateScanStatusUI(true, t('scanFailed'), true);
    } finally {
      if (isIndependent) {
        state.isScanning = false;
        updateScanStatusUI(false);
      }
    }
  }

  async function scanAll() {
    state.isScanning = true;
    updateScanStatusUI(true, t('scanningAllMedia'));
    try {
      if (isInstagram) {
        updateScanStatusUI(true, t('scanningProfile'));
        await scanProfileAvatar(false);
        updateScanStatusUI(true, t('scanningStoriesHighlights'));
        await Promise.all([scanStories(false), scanHighlights(false)]);
        updateScanStatusUI(true, t('scanningPosts'));
        await scanAllPosts(false);
      } else if (isFacebook) {
        await scanFacebookAllTabs();
      } else if (isReddit) {
        await redditScanAll();
      }
    } catch (e) {
      console.warn('[SMD Content] Scan all error:', e);
      updateScanStatusUI(true, t('scanFailed'), true);
    } finally {
      state.isScanning = false;
      updateScanStatusUI(false);
    }
  }

  // 6. Facebook Scanning (photo-tab navigation flow)
  function fbGetBaseProfileUrl(rawUrl = window.location.href) {
    try {
      const u = new URL(rawUrl, window.location.origin);
      const id = u.searchParams.get('id');
      if (id) {
        return `${window.location.origin}/profile.php?id=${id}`;
      }
      const pathParts = u.pathname.split('/').filter(Boolean);
      if (pathParts.length > 0) {
        const slug = pathParts[0];
        if (!['photos', 'photos_by', 'photos_of', 'photos_albums', 'media', 'groups', 'watch', 'marketplace', 'home.php'].includes(slug.toLowerCase())) {
          return `${window.location.origin}/${slug}`;
        }
      }
      return window.location.origin;
    } catch (e) {
      return window.location.origin;
    }
  }

  function fbBuildSubtabUrl(baseProfileUrl, subtab) {
    if (!baseProfileUrl) return '';
    if (baseProfileUrl.includes('profile.php?id=')) {
      return `${baseProfileUrl}&sk=${subtab}`;
    }
    return `${baseProfileUrl.replace(/\/$/, '')}/${subtab}`;
  }

  function fbGetCanonicalTabKey(elOrUrl) {
    if (!elOrUrl) return '';

    let rawHref = '';
    let text = '';

    if (typeof elOrUrl === 'string') {
      rawHref = elOrUrl;
    } else if (elOrUrl && elOrUrl.nodeType === 1) {
      rawHref = elOrUrl.getAttribute('href') || elOrUrl.href || '';
      text = (elOrUrl.innerText || elOrUrl.textContent || '').trim().toLowerCase();
    }

    const hrefLower = rawHref.toLowerCase();

    if (hrefLower.includes('photos_by') || hrefLower.includes('sk=photos_by')) return 'photos_by';
    if (hrefLower.includes('photos_of') || hrefLower.includes('sk=photos_of')) return 'photos_of';
    if (hrefLower.includes('photos_albums') || hrefLower.includes('sk=photos_albums') || hrefLower.includes('/albums')) return 'photos_albums';

    if (text) {
      if (/suas\s*fotos|your\s*photos|fotos\s*carregadas|uploads|carregamentos|photos\s*by|fotos\s*por|fotos\s*de\s*voc[eê]/i.test(text)) return 'photos_by';
      if (/fotos\s*com\s*voc[eê]|photos\s*of(\s*you)?|marcada|tagged|identificad/i.test(text)) return 'photos_of';
      if (/([aá]lbuns|albums)/i.test(text)) return 'photos_albums';
    }

    const setMatch = hrefLower.match(/[?&]set=([a-z0-9._]+)/i) || hrefLower.match(/\/albums\/(\d+)/i);
    if (setMatch && setMatch[1]) return `album_${setMatch[1]}`;

    if (hrefLower.includes('/photos') || hrefLower.includes('sk=photos')) return 'photos_all';

    return '';
  }

  function fbIsGenuinePhotoLink(link) {
    if (!link) return false;
    const href = (link.getAttribute('href') || link.href || '').toLowerCase();
    if (!href) return false;

    const isPhotoUrl = href.includes('/photo.php') ||
                       href.includes('/photo/') ||
                       href.includes('fbid=') ||
                       (href.includes('/photos/') && !href.includes('/photos_') && !href.endsWith('/photos')) ||
                       href.includes('/media/set/');

    if (!isPhotoUrl) return false;

    if (href.includes('/places/') ||
        href.includes('/reviews/') ||
        href.includes('/recommendations/') ||
        href.includes('/events/') ||
        href.includes('/groups/') ||
        href.includes('checkin') ||
        href.includes('review') ||
        href.includes('/map')) {
      return false;
    }

    return true;
  }

  function facebookImageDimensions(url) {
    try {
      const parsed = new URL(url);
      const dims = { width: 0, height: 0 };
      const parseSize = (value) => {
        const m = String(value || '').match(/(\d+)x(\d+)/i);
        return m ? { width: parseInt(m[1], 10), height: parseInt(m[2], 10) } : null;
      };
      const ctpSize = parseSize(parsed.searchParams.get('ctp'));
      const cstpSize = parseSize(parsed.searchParams.get('cstp'));
      if (ctpSize && cstpSize && (ctpSize.width * ctpSize.height < cstpSize.width * cstpSize.height)) {
        return ctpSize;
      }
      if (cstpSize) return cstpSize;
      const pathSize = parsed.pathname.match(/\/(?:[sp](\d+)x(\d+))/i);
      if (pathSize) return { width: parseInt(pathSize[1], 10), height: parseInt(pathSize[2], 10) };
      return ctpSize || parseSize(parsed.searchParams.get('stp')) || dims;
    } catch (e) {
      return { width: 0, height: 0 };
    }
  }

  function fbRegisterFullResolution(id, url, width, height) {
    if (!url || typeof url !== 'string') return;
    const cleanUrl = upgradeCdnUrl(url);
    const record = { url: cleanUrl, width: width || 0, height: height || 0 };

    if (id) {
      facebookFullByPhotoId.set(String(id), record);
    }

    try {
      const parsed = new URL(cleanUrl);
      const pathname = parsed.pathname;
      const filename = pathname.split('/').filter(Boolean).pop();
      if (filename) {
        facebookFullByPhotoId.set(filename, record);
        const nameWithoutExt = filename.replace(/\.[a-z0-9]+$/i, '');
        facebookFullByPhotoId.set(nameWithoutExt, record);
        facebookFullByPhotoId.set(nameWithoutExt.replace(/[^a-zA-Z0-9_-]/g, '_'), record);

        const parts = nameWithoutExt.split('_');
        for (const p of parts) {
          if (p && p.length >= 6 && /^\d+$/.test(p)) {
            if (!facebookFullByPhotoId.has(p)) {
              facebookFullByPhotoId.set(p, record);
            }
          }
        }
      }
    } catch (e) {}
  }

  function fbLookupFullRes(itemId, src, href) {
    if (itemId && facebookFullByPhotoId.has(String(itemId))) {
      return facebookFullByPhotoId.get(String(itemId));
    }
    if (href) {
      const m = href.match(/[?&]fbid=(\d+)/) || href.match(/\/photo(?:\.php)?\/?\?.*fbid=(\d+)/) || href.match(/\/photo\/(\d+)/);
      if (m && m[1] && facebookFullByPhotoId.has(m[1])) {
        return facebookFullByPhotoId.get(m[1]);
      }
    }
    if (src) {
      try {
        const u = new URL(src);
        const fn = u.pathname.split('/').filter(Boolean).pop();
        if (fn) {
          if (facebookFullByPhotoId.has(fn)) return facebookFullByPhotoId.get(fn);
          const noExt = fn.replace(/\.[a-z0-9]+$/i, '');
          if (facebookFullByPhotoId.has(noExt)) return facebookFullByPhotoId.get(noExt);
          const norm = noExt.replace(/[^a-zA-Z0-9_-]/g, '_');
          if (facebookFullByPhotoId.has(norm)) return facebookFullByPhotoId.get(norm);
          const parts = noExt.split('_');
          for (const p of parts) {
            if (p && p.length >= 6 && /^\d+$/.test(p) && facebookFullByPhotoId.has(p)) {
              return facebookFullByPhotoId.get(p);
            }
          }
        }
      } catch (e) {}
    }
    return null;
  }

  function fbStablePhotoId(src, href) {
    if (href) {
      const fbidMatch = href.match(/[?&]fbid=(\d+)/) || href.match(/\/photo(?:\.php)?\/?\?.*fbid=(\d+)/) || href.match(/\/photo\/(\d+)/);
      if (fbidMatch && fbidMatch[1]) return fbidMatch[1];
    }
    if (src) {
      const srcIdMatch = src.match(/\/(\d+_\d+_\d+_[a-z0-9]+)_[a-z0-9]+\.(?:jpg|png|webp)/i) ||
                         src.match(/\/([a-z0-9_-]{10,}\.(?:jpg|png|webp))/i);
      if (srcIdMatch && srcIdMatch[1]) return srcIdMatch[1].replace(/[^a-zA-Z0-9_-]/g, '_');
      try {
        const u = new URL(src);
        const p = u.pathname.split('/').filter(Boolean).pop();
        if (p) return p.split('?')[0].replace(/[^a-zA-Z0-9_-]/g, '_');
      } catch (e) {}
    }
    return null;
  }

  function fbWalkAndHarvest(obj, collectedItems, depth = 0, videoAncestor = false) {
    if (!obj || typeof obj !== 'object' || depth > 40) return;
    if (Array.isArray(obj)) {
      for (let i = 0; i < obj.length; i++) {
        fbWalkAndHarvest(obj[i], collectedItems, depth + 1, videoAncestor);
      }
      return;
    }

    const isCollectionTile = fbIsCollectionTileSync(obj);
    const isVideoNode = fbIsVideoNodeSync(obj);
    // Same ancestor-tracking trick as the service-worker normalizer: a Reel
    // sub-object like `media.preferred_thumbnail` has `image.uri` + `id` but
    // no `playable_url` and no `__typename: 'Video'`, so the per-node check
    // above misses it. Ancestor context catches every descendant.
    const inVideoSubtree = videoAncestor || isVideoNode;
    const hasViewerImage = !!(obj.viewer_image?.uri);
    const hasImage = !!(obj.image?.uri);
    const hasId = !!(obj.id || obj.photo_id);
    if (!isCollectionTile && !inVideoSubtree && !obj.profile_picture) {
      if (hasViewerImage && hasId) {
        const id = String(obj.id || obj.photo_id);
        const cleanUrl = upgradeCdnUrl(obj.viewer_image.uri, 'facebook');
        const w = obj.viewer_image.width || 0;
        const h = obj.viewer_image.height || 0;
        fbRegisterFullResolution(id, cleanUrl, w, h);

        if (isAllowedMediaUrl(cleanUrl)) {
          collectedItems.push({
            id,
            platform: 'facebook',
            type: 'image',
            url: cleanUrl,
            downloadUrl: cleanUrl,
            thumbnailUrl: obj.thumbnail_image?.uri || obj.image?.uri || cleanUrl,
            width: w || undefined,
            height: h || undefined,
            category: 'facebook_album',
            metadata: { category: 'facebook_album', photoId: id, source: 'graphql_payload' }
          });
        }
      } else if (hasImage && hasId) {
        const id = String(obj.id || obj.photo_id);
        const cleanUrl = upgradeCdnUrl(obj.image.uri, 'facebook');
        const dims = facebookImageDimensions(cleanUrl);
        const w = obj.image.width || dims.width || 0;
        const h = obj.image.height || dims.height || 0;

        if (isAllowedMediaUrl(cleanUrl)) {
          collectedItems.push({
            id,
            platform: 'facebook',
            type: 'image',
            url: cleanUrl,
            downloadUrl: cleanUrl,
            thumbnailUrl: obj.thumbnail_image?.uri || cleanUrl,
            width: w || undefined,
            height: h || undefined,
            category: 'facebook_album',
            metadata: { category: 'facebook_album', photoId: id, source: 'graphql_payload' }
          });
        }
      }
    }
    if (obj.node && typeof obj.node === 'object') {
      fbWalkAndHarvest(obj.node, collectedItems, depth + 1, inVideoSubtree);
    }

    const keys = Object.keys(obj);
    for (const key of keys) {
      if (key === 'extensions' || (key === 'viewer' && depth > 2)) continue;
      fbWalkAndHarvest(obj[key], collectedItems, depth + 1, inVideoSubtree);
    }
  }

  function fbProcessGraphQLText(text) {
    if (!text || typeof text !== 'string') return;
    const clean = text.replace(/^for\s*\(;;\);/, '');
    const lines = clean.split('\n').filter(Boolean);
    const collectedItems = [];

    for (const line of lines) {
      try {
        const data = JSON.parse(line);
        fbWalkAndHarvest(data, collectedItems);
      } catch (e) {}
    }

    if (collectedItems.length > 0) {
      addMediaItems(collectedItems);
    }
  }

  /**
   * Harvests photos currently rendered in the Facebook DOM.
   */
  function harvestFacebookDomPhotos() {
    if (!isFacebook) return;
    const items = [];
    const main = document.querySelector('div[role="main"]') || document.body;

    const pushItem = (img, href, itemId) => {
      const src = img.currentSrc || img.src;
      if (!src || !src.includes('fbcdn.net') || src.includes('/rsrc.php/') || src.includes('emoji.php')) return;
      if (!isAllowedMediaUrl(src)) return;

      const fullRecord = fbLookupFullRes(itemId, src, href);
      // Without a full-res record, upgrade the tile URL in place: the
      // ctp→cstp rewrite (validated 2026-08-29) recovers the max render from
      // any cstp-carrying URL. Drop only when the URL has no cstp at all
      // (e.g. a bare TimelineAppCollectionItem cover with a crop-only stp —
      // nothing to upgrade from, would push a miniature).
      const upgradedSrc = upgradeCdnUrl(src, 'facebook');
      if (!fullRecord && isDownscaledRender(upgradedSrc) && !(new URL(upgradedSrc).searchParams.has('cstp'))) return;
      const highRes = fullRecord ? fullRecord.url : upgradedSrc;
      const dims = facebookImageDimensions(highRes);
      const width = fullRecord?.width || dims.width || img.naturalWidth || 0;
      const height = fullRecord?.height || dims.height || img.naturalHeight || 0;

      items.push({
        id: itemId,
        platform: 'facebook',
        type: 'image',
        url: highRes,
        downloadUrl: highRes,
        thumbnailUrl: src,
        width: width || undefined,
        height: height || undefined,
        category: 'facebook_album',
        metadata: {
          category: 'facebook_album',
          photoId: itemId,
          pageHref: href || '',
          source: 'dom_harvest'
        }
      });
    };

    // 1. Traditional photo links with <img>
    const photoLinks = main.querySelectorAll('a[href*="/photo.php"], a[href*="/photo/"], a[href*="fbid="], a[href*="/photos/"], a[href*="/media/set/"]');
    for (const link of photoLinks) {
      if (!fbIsGenuinePhotoLink(link)) continue;
      const img = link.querySelector('img');
      if (!img) continue;
      const src = img.currentSrc || img.src;
      const href = link.getAttribute('href') || '';
      const itemId = fbStablePhotoId(src, href);
      if (!itemId) continue;
      pushItem(img, href, itemId);
    }

    // 2. Direct <img> elements with genuine photo parent links
    const allImgs = main.querySelectorAll('img[src*="fbcdn.net"], img[data-visualcompletion]');
    for (const img of allImgs) {
      const src = img.currentSrc || img.src;
      const w = img.naturalWidth || img.clientWidth || 0;
      const h = img.naturalHeight || img.clientHeight || 0;
      if (w > 0 && w < 80 && h > 0 && h < 80) continue;

      const parentLink = img.closest('a');
      if (!parentLink || !fbIsGenuinePhotoLink(parentLink)) continue;

      const href = parentLink.getAttribute('href') || '';
      const itemId = fbStablePhotoId(src, href);
      if (!itemId) continue;
      pushItem(img, href, itemId);
    }

    if (items.length) {
      addMediaItems(items);
    }
  }

  /**
   * Sweeps embedded JSON script tags for pre-loaded Facebook photo payloads.
   */
  function fbSweepScriptTags() {
    if (!isFacebook) return;
    const items = [];
    const scripts = document.querySelectorAll('script[type="application/json"]');
    for (const s of scripts) {
      const text = s.textContent;
      if (!text || !text.includes('fbcdn.net')) continue;
      try {
        const data = JSON.parse(text);
        fbWalkAndHarvest(data, items);
      } catch (e) {}
    }
    if (items.length) {
      addMediaItems(items);
    }
  }

  function fbClickElement(el) {
    if (!el) return;
    try {
      el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    } catch (e) {}

    const target = el.querySelector('span') || el.querySelector('div') || el;

    try {
      const rect = target.getBoundingClientRect();
      const baseEventInit = {
        bubbles: true,
        cancelable: true,
        composed: true,
        view: window,
        clientX: rect.left + rect.width / 2,
        clientY: rect.top + rect.height / 2,
        button: 0,
        buttons: 1
      };
      const pointerInit = { ...baseEventInit, pointerId: 1, pointerType: 'mouse', isPrimary: true, pressure: 0.5 };
      target.dispatchEvent(new PointerEvent('pointerover', pointerInit));
      target.dispatchEvent(new PointerEvent('pointerenter', pointerInit));
      target.dispatchEvent(new PointerEvent('pointerdown', pointerInit));
      target.dispatchEvent(new MouseEvent('mousedown', baseEventInit));
      target.dispatchEvent(new PointerEvent('pointerup', { ...pointerInit, buttons: 0, pressure: 0 }));
      target.dispatchEvent(new MouseEvent('mouseup', { ...baseEventInit, buttons: 0 }));
      target.dispatchEvent(new MouseEvent('click', { ...baseEventInit, buttons: 0 }));
    } catch (e) {
      try { target.click(); } catch (err) {}
    }
  }

  /**
   * Progressive pagination engine for Facebook photo collections.
   */
  async function fbScrollCurrentTab(tabLabel = '') {
    let lastMediaCount = state.media.size;
    let unchangedRounds = 0;
    let stalledScrollRounds = 0;
    const maxSteps = 400;

    window.scrollTo({ top: 0, behavior: 'instant' });
    await new Promise(r => setTimeout(r, 200));

    fbSweepScriptTags();
    harvestFacebookDomPhotos();

    for (let i = 0; i < maxSteps; i++) {
      if (!state.isScanning) break;

      const prevScrollY = window.scrollY;

      const scrollStep = Math.min(Math.round(window.innerHeight * 0.8), 650);
      window.scrollBy({ top: scrollStep, behavior: 'instant' });

      try {
        window.dispatchEvent(new Event('scroll', { bubbles: true }));
      } catch (e) {}

      // Auto-click "load more" buttons
      const actionButtons = document.querySelectorAll('div[role="button"], a[role="button"], span');
      for (const btn of actionButtons) {
        const text = (btn.innerText || btn.textContent || '').trim().toLowerCase();
        if (text === 'carregar mais fotos' || text === 'carregar mais' || text === 'ver mais' || text === 'tentar novamente' || text === 'load more' || text === 'see more' || text === 'retry') {
          fbClickElement(btn);
          break;
        }
      }

      const main = document.querySelector('div[role="main"]') || document.body;
      const isLoading = !!main.querySelector('[role="progressbar"], div[data-visualcompletion="loading-state"]');
      const waitTime = isLoading ? 700 : 400;
      await new Promise(r => setTimeout(r, waitTime));

      fbSweepScriptTags();
      harvestFacebookDomPhotos();

      const count = state.media.size;

      const currentScrollY = window.scrollY;
      const didNotScroll = Math.abs(currentScrollY - prevScrollY) < 5;

      if (count > lastMediaCount) {
        lastMediaCount = count;
        unchangedRounds = 0;
        stalledScrollRounds = 0;
      } else {
        if (didNotScroll) {
          stalledScrollRounds++;
          if (stalledScrollRounds >= 3 && !isLoading) {
            break;
          }
        } else {
          stalledScrollRounds = 0;
        }

        unchangedRounds++;
        if (unchangedRounds >= 8 && !isLoading) {
          break;
        }
        if (unchangedRounds >= 15) {
          break;
        }
      }
    }
  }

  function fbFindAlbumLinks() {
    const main = document.querySelector('div[role="main"]') || document.body;
    const links = main.querySelectorAll('a[href*="/media/set/"], a[href*="/albums/"]');
    const albumList = [];
    const seenSets = new Set();

    for (const link of links) {
      const href = link.getAttribute('href') || link.href || '';
      if (!href) continue;
      if (href.includes('/places/') || href.includes('/reviews/') || href.includes('checkin')) continue;

      const setMatch = href.match(/[?&]set=([a-z0-9._]+)/i) || href.match(/\/albums\/(\d+)/i);
      const setKey = setMatch ? setMatch[1] : href;
      if (!seenSets.has(setKey)) {
        seenSets.add(setKey);
        const albumName = (link.innerText || link.textContent || '').trim().split('\n')[0] || `Album ${setKey}`;
        const targetUrl = new URL(href, window.location.origin).href;
        albumList.push({
          key: `album_${setKey}`,
          url: targetUrl,
          label: albumName
        });
      }
    }
    return albumList;
  }

  async function fbNavigateToTab(targetKey, targetUrl, label = '') {
    if (!state.isScanning) return;
    updateScanStatusUI(true, `${label || targetKey}...`);
    const scanTarget = facebookTargetKey(targetUrl) || facebookScanTargetKey;
    facebookScanTargetKey = scanTarget;
    lastFacebookTargetKey = scanTarget || lastFacebookTargetKey;

    const currentKey = fbGetCanonicalTabKey(window.location.href);
    if (currentKey !== targetKey) {
      window.scrollTo({ top: 0, behavior: 'instant' });
      await new Promise(r => setTimeout(r, 200));

      let routed = false;

      // 1. Click the DOM tab link directly (most native route)
      const domLink = document.querySelector(
        `a[href*="/${targetKey}"], a[href*="sk=${targetKey}"], div[role="tablist"] a[href*="${targetKey}"]`
      );
      if (domLink) {
        domLink.scrollIntoView({ behavior: 'instant', block: 'center' });
        await new Promise(r => setTimeout(r, 100));
        fbClickElement(domLink);
        try { domLink.click(); } catch (e) {}
        routed = true;
      } else {
        const allTabs = Array.from(document.querySelectorAll('a[role="tab"], div[role="tablist"] a, div[role="tablist"] [role="tab"], div[role="tablist"] div[role="button"]'));
        for (const tabEl of allTabs) {
          if (fbGetCanonicalTabKey(tabEl) === targetKey) {
            tabEl.scrollIntoView({ behavior: 'instant', block: 'center' });
            await new Promise(r => setTimeout(r, 100));
            fbClickElement(tabEl);
            try { tabEl.click(); } catch (e) {}
            routed = true;
            break;
          }
        }
      }

      // 2. Comet Router via injected script
      if (!routed && targetUrl) {
        try {
          const res = await sendToInjected('NAVIGATE_FB_TAB', { href: targetUrl });
          if (res && res.success && res.payload && res.payload.navigated) routed = true;
        } catch (e) {}
      }

      // 3. History API fallback
      if (!routed && targetUrl) {
        try {
          const u = new URL(targetUrl, window.location.origin);
          window.history.pushState(null, '', u.pathname + u.search);
          window.dispatchEvent(new PopStateEvent('popstate'));
        } catch (e) {}
      }

      // Allow the React view to mount and fetch initial data
      await new Promise(r => setTimeout(r, 1500));
    }

    window.scrollTo({ top: 0, behavior: 'instant' });
    await new Promise(r => setTimeout(r, 200));
    await fbScrollCurrentTab(label || targetKey);
  }

  async function scanFacebookAllTabs() {
    state.isScanning = true;
    facebookScanTargetKey = facebookTargetKey();
    updateScanStatusUI(true, t('scanning'));
    try {
      const visitedTabKeys = new Set();
      const baseProfileUrl = fbGetBaseProfileUrl();

      const primaryTabs = [
        { key: 'photos_of', label: t('tabPhotosOf'), subtab: 'photos_of' },
        { key: 'photos_by', label: t('tabPhotosBy') || t('tabPhotos'), subtab: 'photos_by' },
        { key: 'photos_albums', label: t('tabAlbums'), subtab: 'photos_albums' }
      ];

      for (const tab of primaryTabs) {
        if (!state.isScanning) break;
        visitedTabKeys.add(tab.key);
        const targetUrl = fbBuildSubtabUrl(baseProfileUrl, tab.subtab);
        await fbNavigateToTab(tab.key, targetUrl, tab.label);
      }

      // Individual albums discovered on the /photos_albums page
      if (state.isScanning) {
        const albums = fbFindAlbumLinks();
        for (const album of albums) {
          if (!state.isScanning) break;
          if (visitedTabKeys.has(album.key)) continue;
          visitedTabKeys.add(album.key);
          await fbNavigateToTab(album.key, album.url, album.label);
        }
      }

      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (e) {
      console.warn('[SMD Content] Facebook multi-tab scan failed:', e);
      updateScanStatusUI(true, t('scanFailed'), true);
    } finally {
      state.isScanning = false;
      facebookScanTargetKey = '';
      updateScanStatusUI(false);
    }
  }


  function scanFacebookCurrentPage() {
    try {
      state.isScanning = true;
      updateScanStatusUI(true, t('scanning'));
      fbSweepScriptTags();
      harvestFacebookDomPhotos();
    } catch (e) {
      console.warn('[SMD Content] Facebook current page scan failed:', e);
      updateScanStatusUI(true, t('scanFailed'), true);
    } finally {
      state.isScanning = false;
      updateScanStatusUI(false);
    }
  }

  // 7. Reddit Scanning (public JSON API via the service worker, which holds host permissions)
  function redditTargetInfo() {
    const pathname = window.location.pathname;
    let m = pathname.match(/\/(?:user|u)\/([^/?#]+)/);
    if (m) return { kind: 'user', id: m[1] };
    m = pathname.match(/\/r\/([^/?#]+)/);
    if (m) return { kind: 'subreddit', id: m[1] };
    m = pathname.match(/\/comments\/([a-z0-9]+)/i);
    if (m) return { kind: 'post', id: m[1] };
    return { kind: 'subreddit', id: 'popular' };
  }

  async function redditScanAll() {
    state.isScanning = true;
    updateScanStatusUI(true, t('scanning'));
    try {
      const target = redditTargetInfo();
      const res = await new Promise((resolve) => {
        chrome.runtime.sendMessage({
          type: 'REDDIT_SCAN',
          payload: { kind: target.kind, id: target.id }
        }, (response) => {
          if (chrome.runtime.lastError) {
            resolve({ success: false, error: chrome.runtime.lastError.message });
          } else {
            resolve(response || { success: false, error: 'No response' });
          }
        });
      });

      const items = res.success && Array.isArray(res.items) ? res.items : [];

      if (items.length > 0) {
        addMediaItems(items);
        return;
      }

      // If background fetch returned 0 items (often 403 network policy from SW),
      // try in-page fetch from the authenticated tab origin before DOM fallback.
      try {
        let pageItems = [];
        const { RedditScanner: sc } = await import(chrome.runtime.getURL('src/plugins/reddit/RedditScanner.js'));
        if (target.kind === 'user') {
          const userUrl = `https://www.reddit.com/user/${encodeURIComponent(target.id)}/submitted.json?limit=100&raw_json=1`;
          const uRes = await fetch(userUrl, { headers: { 'Accept': 'application/json' } });
          if (uRes.ok) {
            const uJson = await uRes.json();
            const children = uJson.data?.children || [];
            for (const child of children) {
              pageItems.push(...sc.parseApiPostObject(child.data));
            }
          }
        } else if (target.kind === 'subreddit') {
          const subUrl = `https://www.reddit.com/r/${encodeURIComponent(target.id)}/hot.json?limit=100&raw_json=1`;
          const sRes = await fetch(subUrl, { headers: { 'Accept': 'application/json' } });
          if (sRes.ok) {
            const sJson = await sRes.json();
            const children = sJson.data?.children || [];
            for (const child of children) {
              pageItems.push(...sc.parseApiPostObject(child.data));
            }
          }
        } else if (target.kind === 'post') {
          const pResult = await sc.fetchPostById(target.id);
          pageItems = pResult.items || [];
        }

        if (pageItems.length > 0) {
          addMediaItems(pageItems);
          return;
        }
      } catch (err) {
        console.warn('[SMD Content] In-page JSON fetch fallback error:', err);
      }

      // Fallback: extract media from the server-rendered shreddit HTML.
      const domCount = await redditDomFallback();
      if (domCount === 0) {
        console.warn('[SMD Content] Reddit scan returned 0 items (empty, private, or quarantined target).');
      }
    } catch (e) {
      console.warn('[SMD Content] Reddit scan failed:', e);
      updateScanStatusUI(true, t('scanFailed'), true);
    } finally {
      state.isScanning = false;
      updateScanStatusUI(false);
    }
  }

  /**
   * Extracts media from server-rendered shreddit posts using the real RedditScanner
   * module (dynamic import keeps the plugin as the single source of truth).
   * @returns {Promise<number>} number of items added
   */
  async function redditDomFallback() {
    let scanner;
    let normalizer;
    try {
      ({ RedditScanner: scanner } = await import(chrome.runtime.getURL('src/plugins/reddit/RedditScanner.js')));
      ({ RedditNormalizer: normalizer } = await import(chrome.runtime.getURL('src/plugins/reddit/RedditNormalizer.js')));
    } catch (err) {
      console.warn('[SMD Content] Reddit DOM fallback unavailable (module load failed):', err);
      return 0;
    }

    const postEls = Array.from(document.querySelectorAll('shreddit-post'));
    const collected = [];
    for (let i = 0; i < postEls.length; i++) {
      const postEl = postEls[i];
      if (i > 0 && i % 15 === 0) {
        await new Promise(r => setTimeout(r, 0));
      }
      let postData;
      try {
        postData = scanner.extractFromShredditPost(postEl);
      } catch (err) {
        console.warn('[SMD Content] shreddit post extraction failed:', err);
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
        try {
          const item = normalizer.normalizeItem(mi, postInfo);
          if (item) collected.push(item);
        } catch (err) {
          console.warn('[SMD Content] shreddit media normalization failed:', err);
        }
      }
    }

    if (collected.length === 0) return 0;

    // Cross-post/repost dedup with score ranking (Reddit platform invariant).
    const { uniqueItems } = normalizer.deduplicateMediaItems(collected);
    if (uniqueItems.length > 0) {
      addMediaItems(uniqueItems);
    }
    return uniqueItems.length;
  }

  // 8. Floating In-Page Widget & Embedded Modal UI
  let uiRoot = null;
  let uiShadow = null;
  let floatingWidget = null;
  let floatingModal = null;

  function uiGetById(id) {
    return uiShadow?.querySelector(`#${id}`) || null;
  }

  function createFloatingUI() {
    if (floatingWidget) return;

    // The Reddit page applies global rules to buttons, images, and text
    // elements. Keep all extension UI inside a closed styling boundary.
    uiRoot = document.createElement('div');
    uiRoot.id = 'smd-ui-root';
    uiShadow = uiRoot.attachShadow({ mode: 'open' });
    const stylesheet = document.createElement('link');
    stylesheet.rel = 'stylesheet';
    stylesheet.href = chrome.runtime.getURL('src/content/inpage_overlay.css');
    uiShadow.appendChild(stylesheet);
    document.body.appendChild(uiRoot);

    // A. Floating FAB Launch Button
    floatingWidget = document.createElement('div');
    floatingWidget.id = 'smd-floating-widget';
    const fabTheme = isFacebook ? 'smd-fab-fb' : (isReddit ? 'smd-fab-reddit' : '');
    floatingWidget.innerHTML = `
      <button class="smd-fab ${fabTheme}">
        <span>${t('downloadFloating')}</span>
        <span class="smd-badge">0</span>
      </button>
    `;

    floatingWidget.querySelector('button')?.addEventListener('click', toggleModal);
    uiShadow.appendChild(floatingWidget);

    // B. Embedded Modal Overlay
    floatingModal = document.createElement('div');
    floatingModal.id = 'smd-modal-overlay';
    floatingModal.className = `smd-modal-overlay ${isFacebook ? 'smd-fb-theme' : (isReddit ? 'smd-reddit-theme' : '')}`;
    floatingModal.style.display = 'none';
    floatingModal.setAttribute('role', 'dialog');
    floatingModal.setAttribute('aria-modal', 'true');
    floatingModal.setAttribute('aria-labelledby', 'smd-target-title');

    const chipClass = isFacebook ? 'smd-chip-fb' : (isReddit ? 'smd-chip-reddit' : '');
    const platformLabel = isInstagram ? 'Instagram' : (isFacebook ? 'Facebook' : 'Reddit');
    const fallbackIcon = chrome.runtime.getURL('assets/icons/icon32.png');

    // Static shell only: trusted strings + translations. Remote data is rendered via DOM APIs.
    let scanButtons = '';
    if (isInstagram) {
      scanButtons = `
        <button id="smd-scan-posts" class="smd-btn-action">${t('scanPosts')}</button>
        <button id="smd-scan-stories" class="smd-btn-action">${t('scanStories')}</button>
        <button id="smd-scan-highlights" class="smd-btn-action">${t('scanHighlights')}</button>
        <button id="smd-scan-avatar" class="smd-btn-action">${t('scanAvatar')}</button>
      `;
    } else if (isFacebook) {
      scanButtons = `
        <button id="smd-scan-fb-page" class="smd-btn-action">${t('scanPage')}</button>
        <button id="smd-scan-fb-tabs" class="smd-btn-action">${t('scanPhotoTabs')}</button>
      `;
    } else if (isReddit) {
      scanButtons = `
        <button id="smd-scan-reddit" class="smd-btn-action">${t('scanFeed')}</button>
      `;
    }

    const extraFilterTabs = isInstagram ? `
      <button class="smd-tab" data-filter="stories">${t('tabStories')} <span id="smd-t-stories">(0)</span></button>
      <button class="smd-tab" data-filter="highlights">${t('tabHighlights')} <span id="smd-t-highlights">(0)</span></button>
    ` : (isReddit ? `
      <button class="smd-tab" data-filter="gallery">${t('tabGalleries')} <span id="smd-t-gallery">(0)</span></button>
      <button class="smd-tab" data-filter="redgifs">${t('tabRedgifs')} <span id="smd-t-redgifs">(0)</span></button>
    ` : '');

    floatingModal.innerHTML = `
      <div class="smd-modal-content">
        <!-- Header -->
        <div class="smd-modal-header">
          <div class="smd-header-info">
            <img id="smd-target-avatar" class="smd-modal-avatar" alt="">
            <div>
              <h3 id="smd-target-title" class="smd-target-title"></h3>
            </div>
          </div>
          <div class="smd-header-right">
            <span class="smd-platform-chip ${chipClass}">${platformLabel}</span>
            <button id="smd-modal-close" class="smd-close-btn" aria-label="${t('closeModal')}">&times;</button>
          </div>
        </div>

        <!-- Scanner Bar -->
        <div class="smd-scanner-bar">
          <button id="smd-scan-all" class="smd-btn-action smd-btn-primary">${t('scanAll')}</button>
          ${scanButtons}
        </div>

        <!-- Scan Status Box -->
        <div id="smd-status-box" class="smd-status-box" style="display: none;">
          <div>
            <span class="smd-spinner"></span><span class="smd-status-dot" style="display: none;"></span><span id="smd-status-text" aria-live="polite">${t('scanning')}</span>
          </div>
          <button id="smd-cancel-scan" class="smd-cancel-btn">${t('stopScan')}</button>
        </div>

        <!-- Filter Tabs -->
        <div class="smd-filter-bar">
          <div class="smd-filter-tabs smd-segmented" role="tablist" aria-label="${t('filterLabel')}">
            <button class="smd-tab active" data-filter="all">${t('tabAll')} <span id="smd-t-all">(0)</span></button>
            <button class="smd-tab" data-filter="image">${t('tabPhotos')} <span id="smd-t-image">(0)</span></button>
            <button class="smd-tab" data-filter="video">${t('tabVideos')} <span id="smd-t-video">(0)</span></button>
            ${extraFilterTabs}
          </div>
        </div>

        <!-- Selection Bar -->
        <div class="smd-selection-bar">
          <div>
            <button id="smd-select-all" class="smd-link-btn">${t('selectAll')}</button>
            <span style="margin: 0 4px;">•</span>
            <button id="smd-deselect-all" class="smd-link-btn">${t('deselectAll')}</button>
          </div>
          <span id="smd-selection-summary">0 of 0 selected</span>
        </div>

        <!-- Media Grid -->
        <div id="smd-grid" class="smd-grid"></div>

        <!-- Empty State -->
        <div id="smd-empty" class="smd-empty-state" style="display: none;">
          <p>${t('emptyStateTitle')}</p>
          <small>${t('emptyStateDesc')}</small>
        </div>

        <!-- Progress Box -->
        <div id="smd-download-progress-box" class="smd-progress-card" style="display: none;">
          <div class="smd-progress-header">
            <span id="smd-progress-status-text">${t('downloading')}</span>
            <span id="smd-progress-percentage">0%</span>
          </div>
          <div class="smd-progress-track">
            <div id="smd-progress-bar-fill" class="smd-progress-fill" style="width: 0%;"></div>
          </div>
          <button id="smd-btn-retry-download" class="smd-cancel-btn" style="display: none; align-self: flex-end; margin-top: 4px; border-color: #9e9ea7; color: #9e9ea7;">${t('retryBtn')}</button>
          <button id="smd-btn-cancel-download" class="smd-cancel-btn" style="align-self: flex-end; margin-top: 4px;">${t('cancelBtn')}</button>
          <div id="smd-receipt-actions" class="smd-receipt-actions" style="display: none;">
            <button id="smd-btn-show-folder" class="smd-cancel-btn" style="border-color: #9e9ea7; color: #9e9ea7;">${t('showInFolder')}</button>
          </div>
        </div>

        <!-- Footer -->
        <div class="smd-modal-footer">
          <div class="smd-footer-options">
            <div class="smd-segmented" role="radiogroup" aria-label="${t('formatLabel')}">
              <label class="smd-segment">
                <input type="radio" name="smd-modal-format" value="zip" checked>
                <span class="smd-segment-face">${t('formatZip')}</span>
              </label>
              <label class="smd-segment">
                <input type="radio" name="smd-modal-format" value="individual">
                <span class="smd-segment-face">${t('formatFolders')}</span>
              </label>
            </div>
            <div class="smd-dedup-options">
              <label class="smd-checkbox-label" title="${t('dedupExactTooltip')}">
                <input type="checkbox" id="smd-dedup-toggle">
                <span>${t('dedupExactLabel')}</span>
              </label>
              <div id="smd-historical-dedup-container" class="smd-nested-option" style="display: none;">
                <label class="smd-checkbox-label" title="${t('dedupHistoricalDesc')}">
                  <input type="checkbox" id="smd-historical-dedup-toggle">
                  <span>${t('dedupHistoricalLabel')}</span>
                </label>
              </div>
            </div>
          </div>
          <button id="smd-btn-start-download" class="smd-btn-download" disabled>
            <span id="smd-download-text">${t('downloadBtnDefault')}</span>
          </button>
        </div>
      </div>
    `;

    uiShadow.appendChild(floatingModal);
    updateModalTitle();
    updateAvatarUI();

    // Load persisted settings
    chrome.runtime.sendMessage({ type: 'GET_SETTINGS' }, (res) => {
      if (res && res.success && res.settings) {
        const dedupEl = uiGetById('smd-dedup-toggle');
        const histEl = uiGetById('smd-historical-dedup-toggle');
        const histContainer = uiGetById('smd-historical-dedup-container');
        if (dedupEl) dedupEl.checked = !!res.settings.deduplicate;
        if (histEl) histEl.checked = !!res.settings.historicalDedup;
        if (histContainer) histContainer.style.display = res.settings.deduplicate ? 'inline-flex' : 'none';
      }
    });

    uiGetById('smd-dedup-toggle')?.addEventListener('change', (e) => {
      const isChecked = /** @type {HTMLInputElement} */ (e.target).checked;
      const histContainer = uiGetById('smd-historical-dedup-container');
      if (histContainer) histContainer.style.display = isChecked ? 'inline-flex' : 'none';
      const histEl = uiGetById('smd-historical-dedup-toggle');
      chrome.runtime.sendMessage({
        type: 'SAVE_SETTINGS',
        payload: {
          deduplicate: isChecked,
          historicalDedup: isChecked && (histEl?.checked || false)
        }
      });
    });

    uiGetById('smd-historical-dedup-toggle')?.addEventListener('change', (e) => {
      const isHistChecked = /** @type {HTMLInputElement} */ (e.target).checked;
      const dedupEl = uiGetById('smd-dedup-toggle');
      chrome.runtime.sendMessage({
        type: 'SAVE_SETTINGS',
        payload: {
          deduplicate: dedupEl?.checked || false,
          historicalDedup: isHistChecked
        }
      });
    });

    // Event listeners
    uiGetById('smd-modal-close')?.addEventListener('click', toggleModal);
    uiGetById('smd-scan-all')?.addEventListener('click', scanAll);

    if (isInstagram) {
      uiGetById('smd-scan-posts')?.addEventListener('click', () => scanAllPosts(true));
      uiGetById('smd-scan-stories')?.addEventListener('click', () => scanStories(true));
      uiGetById('smd-scan-highlights')?.addEventListener('click', () => scanHighlights(true));
      uiGetById('smd-scan-avatar')?.addEventListener('click', () => scanProfileAvatar(true));
    } else if (isFacebook) {
      uiGetById('smd-scan-fb-page')?.addEventListener('click', scanFacebookCurrentPage);
      uiGetById('smd-scan-fb-tabs')?.addEventListener('click', scanFacebookAllTabs);
    } else if (isReddit) {
      uiGetById('smd-scan-reddit')?.addEventListener('click', redditScanAll);
    }

    uiGetById('smd-cancel-scan')?.addEventListener('click', () => {
      // Only Instagram's injected script implements cancellable scans; for other
      // platforms the local isScanning flag stops the loop on the next tick.
      if (isInstagram) {
        sendToInjected('CANCEL_SCAN');
      }
      state.isScanning = false;
      updateScanStatusUI(false);
    });
    uiGetById('smd-btn-retry-download')?.addEventListener('click', () => {
      uiGetById('smd-btn-start-download')?.click();
    });

    uiGetById('smd-btn-show-folder')?.addEventListener('click', () => {
      const receiptId = state.lastReceiptDownloadId;
      if (typeof chrome !== 'undefined' && chrome.downloads && typeof receiptId === 'number') {
        chrome.downloads.show(receiptId);
      }
    });

    // Esc closes the modal; Tab cycles inside it while open.
    floatingModal.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape') {
        ev.stopPropagation();
        toggleModal();
        return;
      }
      if (ev.key === 'Tab') {
        const focusables = uiShadow.querySelectorAll('.smd-modal-overlay button:not([style*="display: none"]):not([disabled]), .smd-modal-overlay [role="button"][tabindex="0"], .smd-modal-overlay input');
        if (!focusables.length) return;
        const list = Array.from(focusables).filter((el) => el.offsetParent !== null || el === document.activeElement);
        if (!list.length) return;
        const first = list[0];
        const last = list[list.length - 1];
        if (ev.shiftKey && document.activeElement === first) {
          ev.preventDefault();
          last.focus();
        } else if (!ev.shiftKey && document.activeElement === last) {
          ev.preventDefault();
          first.focus();
        }
      }
    });

    uiGetById('smd-btn-cancel-download')?.addEventListener('click', () => {
      chrome.runtime.sendMessage({ type: 'CANCEL_DOWNLOAD' });
    });

    uiGetById('smd-select-all')?.addEventListener('click', () => {
      state.autoSelectAll = true;
      state.media.forEach((item) => {
        if (matchesActiveFilter(item)) state.selectedIds.add(item.id);
      });
      renderModalGrid();
    });

    uiGetById('smd-deselect-all')?.addEventListener('click', () => {
      state.autoSelectAll = false;
      if (state.activeFilter === 'all') {
        state.selectedIds.clear();
      } else {
        state.media.forEach((item) => {
          if (matchesActiveFilter(item)) state.selectedIds.delete(item.id);
        });
      }
      renderModalGrid();
    });

    floatingModal.querySelectorAll('.smd-tab').forEach((tab) => {
      tab.setAttribute('role', 'tab');
      tab.addEventListener('click', () => {
        floatingModal.querySelectorAll('.smd-tab').forEach((tEl) => {
          tEl.classList.remove('active');
          tEl.setAttribute('aria-selected', 'false');
        });
        tab.classList.add('active');
        tab.setAttribute('aria-selected', 'true');
        state.activeFilter = tab.getAttribute('data-filter') || 'all';
        renderModalGrid();
      });
    });

    uiGetById('smd-btn-start-download')?.addEventListener('click', () => {
      if (state.isDownloading) return;
      const format = floatingModal.querySelector('input[name="smd-modal-format"]:checked')?.value || 'zip';
      const deduplicate = uiGetById('smd-dedup-toggle')?.checked || false;
      const historicalDedup = deduplicate && (uiGetById('smd-historical-dedup-toggle')?.checked || false);
      const selected = Array.from(state.media.values()).filter((m) => state.selectedIds.has(m.id));
      if (!selected.length) return;

      state.isDownloading = true;
      chrome.runtime.sendMessage({
        type: 'START_DOWNLOAD',
        platform: state.platform,
        targetName: state.username || state.targetName,
        items: selected,
        format,
        options: { deduplicate, historicalDedup }
      }, (res) => {
        if (chrome.runtime.lastError || !res?.success) {
          state.isDownloading = false;
          updateDownloadProgressUI(null);
          updateScanStatusUI(true, t('errorDownloading'));
          setScanStatusError(true);
        }
      });
    });
  }

  function updateModalTitle() {
    const titleEl = uiGetById('smd-target-title');
    if (titleEl) {
      titleEl.textContent = '';
      titleEl.textContent = isInstagram && state.username ? `@${state.username}` : state.targetName;
    }
  }

  function updateFloatingWidgetBadge() {
    if (!floatingWidget) createFloatingUI();
    const badge = floatingWidget?.querySelector('.smd-badge');
    if (badge) badge.textContent = String(state.media.size);
  }

  function toggleModal() {
    if (!floatingModal) createFloatingUI();
    const isVisible = floatingModal.style.display !== 'none';
    floatingModal.style.display = isVisible ? 'none' : 'flex';
    if (!isVisible) {
      detectTarget();
      updateModalTitle();
      updateAvatarUI();
      renderModalGrid();
    }
  }

  function setScanStatusError(isError) {
    const statusBox = uiGetById('smd-status-box');
    const spinner = statusBox?.querySelector('.smd-spinner');
    const dot = statusBox?.querySelector('.smd-status-dot');
    const stopBtn = uiGetById('smd-cancel-scan');
    if (statusBox) statusBox.classList.toggle('smd-status-box--error', isError);
    if (spinner) spinner.style.display = isError ? 'none' : '';
    if (dot) dot.style.display = isError ? 'inline-block' : 'none';
    if (stopBtn) stopBtn.style.display = isError ? 'none' : '';
  }

  function updateScanStatusUI(isScanning, statusText = '', isError = false) {
    const statusBox = uiGetById('smd-status-box');
    const textEl = uiGetById('smd-status-text');
    if (statusBox) statusBox.style.display = isScanning ? 'flex' : 'none';
    if (textEl && statusText) textEl.textContent = statusText;
    setScanStatusError(isError && isScanning);

    const actionButtons = uiShadow?.querySelectorAll('.smd-btn-action') || [];
    actionButtons.forEach((btn) => {
      btn.disabled = isScanning && !isError;
    });
  }

  function matchesActiveFilter(item) {
    if (!item) return false;
    if (state.activeFilter === 'all') return true;
    if (state.activeFilter === 'image') return item.type === 'image';
    if (state.activeFilter === 'video') return item.type === 'video';
    if (state.activeFilter === 'stories') return item.category === 'stories' || item.metadata?.category === 'stories';
    if (state.activeFilter === 'highlights') return item.category === 'highlights' || item.metadata?.category === 'highlights';
    if (state.activeFilter === 'gallery') return item.sourceType === 'reddit_gallery' || item.metadata?.isGallery;
    if (state.activeFilter === 'redgifs') return item.sourceType === 'redgifs' || item.metadata?.isRedGifs;
    return true;
  }

  let cardImageObserver = null;
  function getCardImageObserver(rootContainer) {
    if (!cardImageObserver) {
      cardImageObserver = new IntersectionObserver((entries, observer) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            const img = entry.target;
            const src = img.dataset.src;
            if (src) {
              img.src = src;
              img.removeAttribute('data-src');
            }
            observer.unobserve(img);
          }
        });
      }, {
        root: rootContainer,
        rootMargin: '250px 0px 250px 0px'
      });
    }
    return cardImageObserver;
  }

  function renderModalGrid() {
    if (!floatingModal) return;

    // Update tab counts
    let all = 0, img = 0, vid = 0, st = 0, hl = 0, gal = 0, rg = 0;
    state.media.forEach((m) => {
      all++;
      if (m.type === 'video') vid++; else img++;
      const cat = m.category || m.metadata?.category;
      if (cat === 'stories') st++;
      if (cat === 'highlights') hl++;
      if (m.sourceType === 'reddit_gallery' || m.metadata?.isGallery) gal++;
      if (m.sourceType === 'redgifs' || m.metadata?.isRedGifs) rg++;
    });

    const setTabCount = (id, count) => {
      const el = uiGetById(id);
      if (el) el.textContent = `(${count})`;
    };
    setTabCount('smd-t-all', all);
    setTabCount('smd-t-image', img);
    setTabCount('smd-t-video', vid);
    setTabCount('smd-t-stories', st);
    setTabCount('smd-t-highlights', hl);
    setTabCount('smd-t-gallery', gal);
    setTabCount('smd-t-redgifs', rg);

    const grid = uiGetById('smd-grid');
    const empty = uiGetById('smd-empty');

    if (!grid || !empty) return;

    // Skip building DOM cards if modal is hidden
    if (floatingModal.style.display === 'none') return;

    const filtered = Array.from(state.media.values()).filter(matchesActiveFilter);

    if (filtered.length === 0) {
      grid.style.display = 'none';
      empty.style.display = 'flex';
    } else {
      if (cardImageObserver) {
        cardImageObserver.disconnect();
      }
      grid.textContent = '';
      grid.style.display = 'grid';
      empty.style.display = 'none';
      const fragment = document.createDocumentFragment();
      const observer = getCardImageObserver(grid);

      filtered.forEach((item) => {
        const isSelected = state.selectedIds.has(item.id);
        const card = document.createElement('div');
        card.className = `smd-grid-item ${isSelected ? 'selected' : ''}`;
        card.setAttribute('role', 'button');
        card.tabIndex = 0;
        card.setAttribute('aria-pressed', String(isSelected));
        card.setAttribute('aria-label', item.width && item.height ? `${item.width}x${item.height}` : t('mediaItemLabel'));
        // Remote data is attached via DOM properties/text only (no innerHTML).
        const thumb = item.thumbnailUrl || item.url;
        if (isAllowedMediaUrl(thumb)) {
          const img = document.createElement('img');
          img.dataset.src = thumb;
          img.alt = 'Preview';
          img.loading = 'lazy';
          img.decoding = 'async';
          img.width = 130;
          img.height = 130;
          card.appendChild(img);
          if (observer) {
            observer.observe(img);
          } else {
            img.src = thumb;
          }
        }

        const check = document.createElement('div');
        check.className = 'smd-check-overlay';
        if (isSelected) check.textContent = '✓';
        card.appendChild(check);

        const isVid = item.type === 'video';
        if (isVid) {
          const tag = document.createElement('span');
          tag.className = 'smd-tag smd-tag-format';
          tag.textContent = 'VIDEO';
          card.appendChild(tag);
        }

        const slideIndex = item.slideIndex || item.metadata?.slideIndex;
        const slideTotal = item.slideTotal || item.metadata?.slideTotal;
        if (item.isCarousel || item.metadata?.isCarousel) {
          const tag = document.createElement('span');
          tag.className = 'smd-tag smd-tag-format';
          tag.textContent = `${slideIndex || 1}/${slideTotal || 1}`;
          card.appendChild(tag);
        }

        if (item.width && item.height) {
          const tag = document.createElement('span');
          tag.className = 'smd-tag smd-tag-res';
          tag.textContent = `${item.width}x${item.height}`;
          card.appendChild(tag);
        }

        card.addEventListener('click', () => {
          const nowSelected = !state.selectedIds.has(item.id);
          if (nowSelected) {
            state.selectedIds.add(item.id);
          } else {
            state.selectedIds.delete(item.id);
          }
          card.classList.toggle('selected', nowSelected);
          card.setAttribute('aria-pressed', String(nowSelected));
          const check = card.querySelector('.smd-check-overlay');
          if (check) check.textContent = nowSelected ? '✓' : '';
          updateSelectionSummary();
        });

        card.addEventListener('keydown', (ev) => {
          if (ev.key === 'Enter' || ev.key === ' ') {
            ev.preventDefault();
            card.click();
          }
        });

        fragment.appendChild(card);
      });

      grid.appendChild(fragment);
    }

    updateSelectionSummary();
  }

  function updateSelectionSummary() {
    const selectedCount = state.selectedIds.size;
    const totalCount = state.media.size;
    const summary = uiGetById('smd-selection-summary');
    const btnDownload = uiGetById('smd-btn-start-download');

    const downloadText = uiGetById('smd-download-text');

    if (summary) summary.textContent = t('selectedSummary', [String(selectedCount), String(totalCount)]) || `${selectedCount} of ${totalCount} selected`;
    if (btnDownload && downloadText) {
      if (selectedCount > 0) {
        btnDownload.disabled = false;
        downloadText.textContent = t('downloadMediaBtn', [String(selectedCount)]) || `Download (${selectedCount})`;
      } else {
        btnDownload.disabled = true;
        downloadText.textContent = t('downloadBtnDefault');
      }
    }
  }

  function updateDownloadProgressUI(job) {
    const box = uiGetById('smd-download-progress-box');
    const statusText = uiGetById('smd-progress-status-text');

    if (typeof job.receiptDownloadId === 'number') {
      state.lastReceiptDownloadId = job.receiptDownloadId;
    }
    const percentage = uiGetById('smd-progress-percentage');
    const fill = uiGetById('smd-progress-bar-fill');
    const btnCancel = uiGetById('smd-btn-cancel-download');
    const btnRetry = uiGetById('smd-btn-retry-download');
    const receiptActions = uiGetById('smd-receipt-actions');

    if (!box || !statusText || !percentage || !fill) return;

    if (!job) {
      box.style.display = 'none';
      state.isDownloading = false;
      if (btnRetry) btnRetry.style.display = 'none';
      if (receiptActions) receiptActions.style.display = 'none';
      return;
    }

    box.style.display = 'block';
    const isPackaging = job.status === 'PACKAGING_ZIP';
    const pct = isPackaging && typeof job.zipPercent === 'number'
      ? job.zipPercent
      : (job.total > 0 ? Math.round((job.completed / job.total) * 100) : 0);

    percentage.textContent = isPackaging ? `${pct}%` : `${pct}% (${job.completed}/${job.total})`;
    fill.style.width = `${pct}%`;

    const isRunning = ['DOWNLOADING', 'DOWNLOADING_BLOBS', 'PACKAGING_ZIP'].includes(job.status);
    const isFailed = job.status === 'FAILED' || job.status === 'FAILED_SIZE';
    const isTerminal = !isRunning && !isFailed;

    if (btnCancel) btnCancel.style.display = isRunning ? 'inline-block' : 'none';
    if (btnRetry) btnRetry.style.display = isFailed ? 'inline-block' : 'none';

    const btnStart = uiGetById('smd-btn-start-download');
    if (btnStart) btnStart.disabled = isRunning;

    if (receiptActions) {
      const canShow = isTerminal && typeof chrome !== 'undefined' && chrome.downloads && typeof job.receiptDownloadId === 'number';
      receiptActions.style.display = canShow ? 'flex' : 'none';
    }

    if (isFailed) {
      state.isDownloading = false;
      statusText.textContent = job.status === 'FAILED_SIZE'
        ? t('zipTooLarge')
        : (job.error ? `${t('errorDownloading')} (${job.error})` : t('errorDownloading'));
      return;
    }

    if (isRunning) {
      statusText.textContent = isPackaging ? t('packagingZip') : t('downloading');
      return;
    }

    // Terminal: COMPLETED or CANCELLED
    state.isDownloading = false;
    if (job.status === 'COMPLETED') {
      const parts = [];
      if (job.failed > 0) parts.push(t('itemsFailedLabel', [String(job.failed)]));
      if (typeof job.skippedDuplicates === 'number' && job.skippedDuplicates > 0) {
        parts.push(t('duplicatesSkipped', [String(job.skippedDuplicates)]));
      }
      const suffix = parts.length > 0 ? ` (${parts.join(', ')})` : '';
      statusText.textContent = job.filenameOverridden ? `${t('filenameOverriddenWarning')}${suffix}` : `${t('downloadComplete')}${suffix}`;
    } else {
      statusText.textContent = t('downloadCancelled');
    }
  }

  // 9. Initialize immediately on page load
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      createFloatingUI();
      if (isInstagram && state.username) scanProfileAvatar();
    });
  } else {
    createFloatingUI();
    if (isInstagram && state.username) scanProfileAvatar();
  }

  // 10. Message Listeners (popup + background)
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message) return;
    const type = message.type || message.action;

    switch (type) {
      case 'TOGGLE_MODAL': {
        toggleModal();
        sendResponse({ success: true });
        return true;
      }

      case 'GET_PAGE_STATE':
      case 'GET_PAGE_CONTEXT': {
        detectTarget();
        sendResponse({
          platform: state.platform,
          targetName: state.targetName,
          username: state.username,
          isScanning: state.isScanning,
          media: Array.from(state.media.values())
        });
        return true;
      }

      case 'TRIGGER_SCAN_ALL': {
        scanAll().then(() => {
          sendResponse({ success: true, count: state.media.size });
        });
        return true;
      }

      case 'TRIGGER_SCAN_POSTS': {
        (isInstagram ? scanAllPosts() : Promise.resolve()).then(() => sendResponse({ success: true }));
        return true;
      }

      case 'TRIGGER_SCAN_STORIES': {
        (isInstagram ? scanStories() : Promise.resolve()).then(() => sendResponse({ success: true }));
        return true;
      }

      case 'TRIGGER_SCAN_HIGHLIGHTS': {
        (isInstagram ? scanHighlights() : Promise.resolve()).then(() => sendResponse({ success: true }));
        return true;
      }

      case 'TRIGGER_SCAN_AVATAR': {
        (isInstagram ? scanProfileAvatar() : Promise.resolve()).then(() => sendResponse({ success: true }));
        return true;
      }

      // Reddit quick scanners (previously dead triggers).
      case 'TRIGGER_SCAN_GALLERIES':
      case 'TRIGGER_SCAN_VIDEOS':
      case 'TRIGGER_SCAN_REDGIFS': {
        (isReddit ? redditScanAll() : Promise.resolve()).then(() => sendResponse({ success: true }));
        return true;
      }

      case 'DOWNLOAD_PROGRESS_UPDATE': {
        if (message.job) updateDownloadProgressUI(message.job);
        break;
      }
    }
  });
})();
