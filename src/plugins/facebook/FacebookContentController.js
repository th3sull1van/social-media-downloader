/**
 * Social Media Downloader — Facebook Content-Script Controller
 * Uses FacebookDetector, FacebookNormalizer, MetaCdn, and MetaNode as single
 * source of truth. Owns Facebook multi-tab photo navigation, Comet GraphQL
 * harvesting, profile header picture/cover extraction, and DOM fallback.
 * Loaded lazily only on facebook.com.
 */
import { FacebookDetector, FB_GENERIC_ROUTES } from './FacebookDetector.js';
import { FacebookNormalizer } from './FacebookNormalizer.js';
import { MetaCdn } from '../meta-shared/MetaCdn.js';
import { MetaNode } from '../meta-shared/MetaNode.js';

export const FACEBOOK_UI_CONFIG = {
  id: 'facebook',
  label: 'Facebook',
  fabThemeClass: 'smd-fab-fb',
  modalThemeClass: 'smd-fb-theme',
  chipClass: 'smd-chip-fb',
  scanActions: [
    { id: 'smd-scan-fb-page', labelKey: 'scanPage', action: 'fb_page' },
    { id: 'smd-scan-fb-tabs', labelKey: 'scanPhotoTabs', action: 'fb_tabs' }
  ],
  filterTabs: [
    { id: 'all', labelKey: 'tabAll' },
    { id: 'image', labelKey: 'tabPhotos' }
  ]
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
export function createFacebookContentController({ env, runtime, bridge, navTracker, overlay, fallbackIconUrl }) {
  const win = env.window || globalThis;
  const doc = env.document || document;
  const setTimer = env.setTimeout || setTimeout;
  const log = env.console || console;
  const jsonParse = env.JSON?.parse || JSON.parse;
  const EventCtor = env.Event || globalThis.Event;
  const MouseEventCtor = env.MouseEvent || globalThis.MouseEvent;
  const PointerEventCtor = env.PointerEvent || globalThis.PointerEvent;
  const PopStateEventCtor = env.PopStateEvent || globalThis.PopStateEvent;
  const getStyle = env.getComputedStyle || (typeof getComputedStyle === 'function' ? getComputedStyle : null);

  const {
    state,
    isAllowedMediaUrl,
    isExtensionContextValid,
    t,
    rememberTargetAvatar,
    addMediaItems,
    readImageSource,
    elementAccessibleText
  } = runtime;

  let lastTargetKey = null;
  let scanTargetKey = '';
  const fullByPhotoId = new Map();
  const dedicatedMediaIds = new Set();
  let sweptScripts = typeof WeakSet === 'function' ? new WeakSet() : new Set();
  let displayName = '';
  let displayNameTarget = '';

  function targetKey(url = win.location?.href || '') {
    return FacebookDetector.getTargetKey(url, win.location?.origin || 'https://www.facebook.com');
  }

  function isCollectionRoute() {
    return FacebookDetector.isCollectionRoute(win.location?.pathname || '');
  }

  function normalizeIdentity(value) {
    return String(value || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  }

  function nameLooksRouteDerived(name, href = win.location?.href || '') {
    const routeName = FacebookDetector.nameFromUrl(href);
    if (!name || !routeName) return false;
    const normalizedName = normalizeIdentity(name);
    const normalizedRoute = normalizeIdentity(routeName);
    return normalizedName === normalizedRoute || normalizedName.startsWith(`${normalizedRoute} `);
  }

  function resetState(reason) {
    runtime.resetMediaState(reason, () => {
      const hadFb = fullByPhotoId.size > 0;
      fullByPhotoId.clear();
      dedicatedMediaIds.clear();
      sweptScripts = typeof WeakSet === 'function' ? new WeakSet() : new Set();
      if (reason === 'target changed') {
        displayName = '';
        displayNameTarget = '';
      }
      return hadFb;
    });
  }

  function detectTarget() {
    let name = FacebookDetector.cleanTitle(doc.title);

    if (!name) {
      const h1 = doc.querySelector('div[role="main"] h1, main h1, h1[dir="auto"], h1');
      const text = (h1?.textContent || '').trim();
      if (text && !FacebookDetector.isGenericTerm(text)) {
        name = text;
      }
    }

    if (!name) {
      const ogTitle = doc.querySelector('meta[property="og:title"]')?.getAttribute('content');
      if (ogTitle) {
        const cleanedOg = FacebookDetector.cleanTitle(ogTitle);
        if (cleanedOg && !FacebookDetector.isGenericTerm(cleanedOg)) {
          name = cleanedOg;
        }
      }
    }

    if (!name) {
      name = FacebookDetector.nameFromUrl(win.location?.href || '');
    }

    const currentTarget = targetKey();
    if (displayName && displayNameTarget === currentTarget &&
        (!name || nameLooksRouteDerived(name))) {
      name = displayName;
    }
    if (displayName && isCollectionRoute() &&
        (!currentTarget || currentTarget === displayNameTarget)) {
      name = displayName;
    }

    if (!name) {
      const previous = state.username || state.targetName || '';
      if (previous && previous !== 'Facebook_Media') {
        name = previous;
      }
    }

    if (!name || FacebookDetector.isGenericTerm(name)) {
      name = 'Facebook_Media';
    }

    const nextTarget = name.replace(/^slug:/i, '').trim() || 'Facebook_Media';
    state.targetName = nextTarget;
    state.username = nextTarget;
    state.targetType = isCollectionRoute() ? 'album' : 'profile';
    if (currentTarget && !isCollectionRoute() && !FacebookDetector.isGenericTerm(nextTarget)) {
      displayName = nextTarget;
      displayNameTarget = currentTarget;
    }
  }

  function imageDimensions(url) {
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

  function registerFullResolution(id, url, width, height) {
    if (!url || typeof url !== 'string') return;
    const cleanUrl = MetaCdn.upgradeUrl(url, 'facebook');
    const record = { url: cleanUrl, width: width || 0, height: height || 0 };

    if (id) fullByPhotoId.set(String(id), record);

    try {
      const parsed = new URL(cleanUrl);
      const filename = parsed.pathname.split('/').filter(Boolean).pop();
      if (filename) {
        fullByPhotoId.set(filename, record);
        const nameWithoutExt = filename.replace(/\.[a-z0-9]+$/i, '');
        fullByPhotoId.set(nameWithoutExt, record);
        fullByPhotoId.set(nameWithoutExt.replace(/[^a-zA-Z0-9_-]/g, '_'), record);
      }
    } catch (e) {}
  }

  function lookupFullRes(itemId, src, href) {
    if (itemId && fullByPhotoId.has(String(itemId))) {
      return fullByPhotoId.get(String(itemId));
    }
    if (href) {
      const m = href.match(/[?&]fbid=(\d+)/) || href.match(/\/photo(?:\.php)?\/?\?.*fbid=(\d+)/) || href.match(/\/photo\/(\d+)/);
      if (m && m[1] && fullByPhotoId.has(m[1])) {
        return fullByPhotoId.get(m[1]);
      }
    }
    if (src) {
      try {
        const u = new URL(src);
        const fn = u.pathname.split('/').filter(Boolean).pop();
        if (fn) {
          if (fullByPhotoId.has(fn)) return fullByPhotoId.get(fn);
          const noExt = fn.replace(/\.[a-z0-9]+$/i, '');
          if (fullByPhotoId.has(noExt)) return fullByPhotoId.get(noExt);
          const norm = noExt.replace(/[^a-zA-Z0-9_-]/g, '_');
          if (fullByPhotoId.has(norm)) return fullByPhotoId.get(norm);
        }
      } catch (e) {}
    }
    return null;
  }

  function stablePhotoId(src, href) {
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

  function targetIdentity(href = win.location?.href || '') {
    const identity = { ids: new Set(), names: new Set() };
    const addId = (value) => {
      const id = String(value || '').trim();
      if (/^\d{5,}$/.test(id)) identity.ids.add(id);
    };
    const addName = (value) => {
      const name = normalizeIdentity(value);
      if (!name || FacebookDetector.isGenericTerm(name)) return;
      if (/^profile \d+$/.test(name)) return;
      identity.names.add(name);
    };

    try {
      const url = new URL(href, win.location?.origin || 'https://www.facebook.com');
      addId(url.searchParams.get('id'));
      const setParts = String(url.searchParams.get('set') || '').split('.');
      if (/^(?:pb|t)$/i.test(setParts[0] || '')) addId(setParts[1]);

      const parts = url.pathname.split('/').filter(Boolean);
      const first = String(parts[0] || '').toLowerCase();
      if (first === 'pages') {
        addName(parts[1]);
        addId(parts[2]);
      } else if (first === 'people') {
        addName(parts[1]);
      } else if (parts[0] && !FB_GENERIC_ROUTES.has(first)) {
        addName(parts[0].replace(/\.\d+$/, '').replace(/[._+-]+/g, ' '));
      }
    } catch (e) {}

    addName(state.targetName);
    addName(state.username);
    return identity;
  }

  function objectMatchesTarget(obj, identity = targetIdentity()) {
    if (!obj || typeof obj !== 'object') return false;

    const objectIds = [
      obj.id, obj.page_id, obj.profile_id, obj.user_id,
      obj.owner?.id, obj.page?.id, obj.profile?.id, obj.user?.id
    ].map((value) => String(value || '').trim());
    if (objectIds.some((id) => id && identity.ids.has(id))) return true;

    const objectUrls = [obj.url, obj.profile_url, obj.permalink_url, obj.link, obj.href];
    for (const rawUrl of objectUrls) {
      if (!rawUrl) continue;
      const value = String(rawUrl);
      if ([...identity.ids].some((id) => value.includes(id))) return true;
      const normalizedUrl = normalizeIdentity(value.replace(/^https?:\/\/[^/]+/i, '').replace(/[/?#=&]+/g, ' '));
      if (normalizedUrl && [...identity.names].some((name) => normalizedUrl.includes(name))) return true;
    }

    const objectNames = [obj.name, obj.title, obj.display_name, obj.username, obj.short_name]
      .map(normalizeIdentity)
      .filter(Boolean);
    return objectNames.some((name) => identity.names.has(name));
  }

  function profileImageCandidate(obj) {
    const fields = [
      ['profilePicLarge', 100],
      ['profilePic160', 95],
      ['profile_picture', 90],
      ['profilePicture', 90],
      ['profile_pic', 90],
      ['profile_picture_for_sticky_bar', 35],
      ['profilePicMedium', 30],
      ['profilePicSmall', 20],
      ['profile_photo', 15]
    ];
    let best = null;

    for (const [field, score] of fields) {
      const value = obj?.[field];
      const values = typeof value === 'string'
        ? [value]
        : [value?.uri, value?.url, value?.src];
      for (const candidate of values) {
        const rawUrl = String(candidate || '').replace(/&amp;/g, '&').trim();
        if (!isAllowedMediaUrl(rawUrl)) continue;
        const url = MetaCdn.upgradeUrl(rawUrl, 'facebook');
        const dimensions = imageDimensions(url);
        const next = {
          field,
          rawUrl,
          url,
          score,
          width: Number(value?.width) || dimensions.width || 0,
          height: Number(value?.height) || dimensions.height || 0
        };
        if (!best || next.score > best.score ||
            (next.score === best.score && next.width * next.height > best.width * best.height)) {
          best = next;
        }
      }
    }

    return best;
  }

  function adoptTargetDisplayName(obj) {
    if (!objectMatchesTarget(obj)) return;
    if (!profileImageCandidate(obj) && !obj.cover_photo) return;

    const candidate = FacebookDetector.cleanTitle(obj?.name || obj?.display_name || obj?.short_name || '');
    if (!candidate) return;

    const tKey = targetKey();
    if (!tKey) return;
    displayName = candidate;
    displayNameTarget = tKey;
    state.targetName = candidate;
    state.username = candidate;
  }

  function targetMediaKey(obj, fallback = 'target') {
    const raw = obj?.id || obj?.profile_id || obj?.user_id || obj?.page_id || fallback;
    return String(raw).replace(/[^a-zA-Z0-9_-]/g, '_') || fallback;
  }

  function captureProfileMedia(obj, collectedItems) {
    if (!objectMatchesTarget(obj)) return;

    adoptTargetDisplayName(obj);

    const identity = targetIdentity();
    const identityFallback = [...identity.ids][0] || [...identity.names][0] || 'target';
    const tKey = targetMediaKey(obj, identityFallback);
    const profile = profileImageCandidate(obj);
    if (profile) {
      const profileId = `facebook_profile_picture_${tKey}`;
      dedicatedMediaIds.add(profileId);
      collectedItems.push({
        schemaVersion: 1,
        id: profileId,
        platform: 'facebook',
        type: 'image',
        sourceType: 'facebook_profile_picture',
        url: profile.url,
        downloadUrl: profile.url,
        thumbnailUrl: profile.rawUrl,
        width: profile.width || undefined,
        height: profile.height || undefined,
        category: 'facebook_profile_picture',
        capabilities: { directDownload: true, requiresMuxing: false, requiresAuth: false, supportsThumbnail: true },
        metadata: {
          category: 'facebook_profile_picture',
          profileId: obj?.id || obj?.profile_id || obj?.user_id || '',
          source: 'profile_header',
          sourceField: profile.field
        }
      });

      const avatar = rememberTargetAvatar(profile.url);
      if (avatar) overlay.updateAvatarUI();
    }

    const cover = obj?.cover_photo?.photo || obj?.coverPhoto?.photo || obj?.coverPhoto;
    const coverValue = cover?.image || cover?.viewer_image;
    const coverRawUrl = [coverValue?.uri, coverValue?.url, coverValue?.src]
      .map((value) => String(value || '').replace(/&amp;/g, '&').trim())
      .find((value) => isAllowedMediaUrl(value)) || '';
    if (!coverRawUrl) return;

    const coverId = String(cover?.id || stablePhotoId(coverRawUrl, cover?.url) || `facebook_cover_photo_${tKey}`);
    dedicatedMediaIds.add(coverId);
    const coverUrl = MetaCdn.upgradeUrl(coverRawUrl, 'facebook');
    const coverWidth = Number(coverValue?.width) || imageDimensions(coverUrl).width || 0;
    const coverHeight = Number(coverValue?.height) || imageDimensions(coverUrl).height || 0;
    collectedItems.push({
      schemaVersion: 1,
      id: coverId,
      platform: 'facebook',
      type: 'image',
      sourceType: 'facebook_cover_photo',
      url: coverUrl,
      downloadUrl: coverUrl,
      thumbnailUrl: coverRawUrl,
      width: coverWidth || undefined,
      height: coverHeight || undefined,
      category: 'facebook_cover_photo',
      capabilities: { directDownload: true, requiresMuxing: false, requiresAuth: false, supportsThumbnail: true },
      metadata: {
        category: 'facebook_cover_photo',
        photoId: cover?.id || '',
        profileId: obj?.id || obj?.profile_id || obj?.user_id || '',
        source: 'profile_header'
      }
    });
  }

  function walkAndHarvest(obj, collectedItems, depth = 0, videoAncestor = false, visited = new Set()) {
    if (!obj || typeof obj !== 'object' || depth > 40) return;
    if (visited.has(obj)) return;
    visited.add(obj);

    if (Array.isArray(obj)) {
      for (let i = 0; i < obj.length; i++) {
        walkAndHarvest(obj[i], collectedItems, depth + 1, videoAncestor, visited);
      }
      return;
    }

    const isCollectionTile = MetaNode.isCollectionTile(obj);
    const isVideoNode = MetaNode.isVideoNode(obj);
    const inVideoSubtree = videoAncestor || isVideoNode;
    const hasId = !!(obj.id || obj.photo_id);
    const hasProfilePicture = !!(obj.profile_picture || obj.profilePicture || obj.profile_pic);
    captureProfileMedia(obj, collectedItems);
    const isDedicatedMedia = hasId && dedicatedMediaIds.has(String(obj.id || obj.photo_id));
    if (!isCollectionTile && !inVideoSubtree && !hasProfilePicture && !isDedicatedMedia && hasId) {
      const selected = FacebookNormalizer.selectBestRender(obj, (u) => isAllowedMediaUrl(u, 'facebook'));
      if (selected) {
        const id = String(obj.id || obj.photo_id);
        const cleanUrl = MetaCdn.upgradeUrl(selected.uri, 'facebook');
        const dims = imageDimensions(cleanUrl);
        const w = selected.width || dims.width || 0;
        const h = selected.height || dims.height || 0;
        registerFullResolution(id, cleanUrl, w, h);

        if (isAllowedMediaUrl(cleanUrl, 'facebook')) {
          collectedItems.push({
            schemaVersion: 1,
            id,
            platform: 'facebook',
            type: 'image',
            sourceType: 'facebook_photo',
            url: cleanUrl,
            downloadUrl: cleanUrl,
            thumbnailUrl: obj.thumbnail_image?.uri || obj.image?.uri || cleanUrl,
            width: w || undefined,
            height: h || undefined,
            category: 'facebook_album',
            capabilities: { directDownload: true, requiresMuxing: false, requiresAuth: false, supportsThumbnail: true },
            metadata: { category: 'facebook_album', photoId: id, source: 'graphql_payload' }
          });
        }
      }
    }

    const keys = Object.keys(obj);
    for (const key of keys) {
      if (key === 'extensions' || (key === 'viewer' && depth > 2)) continue;
      walkAndHarvest(obj[key], collectedItems, depth + 1, inVideoSubtree, visited);
    }
  }

  function processGraphQLText(text) {
    if (!text || typeof text !== 'string') return;
    if (!targetKey() && !isCollectionRoute()) return;
    const clean = text.replace(/^for\s*\(;;\);/, '');
    const lines = clean.split('\n').filter(Boolean);
    const collectedItems = [];

    for (const line of lines) {
      try {
        const data = jsonParse(line);
        walkAndHarvest(data, collectedItems);
      } catch (e) {}
    }

    if (collectedItems.length > 0) {
      addMediaItems(collectedItems);
    }
  }

  function isGenuinePhotoLink(link) {
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

  function harvestDomPhotos() {
    const items = [];
    const main = doc.querySelector('div[role="main"]') || doc.body;
    if (!main) return;

    const pushItem = (img, href, itemId) => {
      const src = img.currentSrc || img.src;
      if (!src || !src.includes('fbcdn.net') || src.includes('/rsrc.php/') || src.includes('emoji.php')) return;
      if (!isAllowedMediaUrl(src)) return;

      const fullRecord = lookupFullRes(itemId, src, href);
      const upgradedSrc = MetaCdn.upgradeUrl(src, 'facebook');
      if (!fullRecord && MetaCdn.isDownscaledRender(upgradedSrc) && !(new URL(upgradedSrc).searchParams.has('cstp'))) return;
      const highRes = fullRecord ? fullRecord.url : upgradedSrc;
      const dims = imageDimensions(highRes);
      const width = fullRecord?.width || dims.width || img.naturalWidth || 0;
      const height = fullRecord?.height || dims.height || img.naturalHeight || 0;

      items.push({
        schemaVersion: 1,
        id: itemId,
        platform: 'facebook',
        type: 'image',
        sourceType: 'facebook_photo',
        url: highRes,
        downloadUrl: highRes,
        thumbnailUrl: src,
        width: width || undefined,
        height: height || undefined,
        category: 'facebook_album',
        capabilities: { directDownload: true, requiresMuxing: false, requiresAuth: false, supportsThumbnail: true },
        metadata: {
          category: 'facebook_album',
          photoId: itemId,
          pageHref: href || '',
          source: 'dom_harvest'
        }
      });
    };

    const photoLinks = main.querySelectorAll('a[href*="/photo.php"], a[href*="/photo/"], a[href*="fbid="], a[href*="/photos/"], a[href*="/media/set/"]');
    for (const link of photoLinks) {
      if (!isGenuinePhotoLink(link)) continue;
      const img = link.querySelector('img');
      if (!img) continue;
      const src = img.currentSrc || img.src;
      const href = link.getAttribute('href') || '';
      const itemId = stablePhotoId(src, href);
      if (!itemId) continue;
      pushItem(img, href, itemId);
    }

    const allImgs = main.querySelectorAll('img[src*="fbcdn.net"], img[data-visualcompletion]');
    for (const rawImg of allImgs) {
      const img = /** @type {HTMLImageElement} */ (rawImg);
      const src = img.currentSrc || img.src;
      const w = img.naturalWidth || img.clientWidth || 0;
      const h = img.naturalHeight || img.clientHeight || 0;
      if (w > 0 && w < 80 && h > 0 && h < 80) continue;

      const parentLink = img.closest('a');
      if (!parentLink || !isGenuinePhotoLink(parentLink)) continue;

      const href = parentLink.getAttribute('href') || '';
      const itemId = stablePhotoId(src, href);
      if (!itemId) continue;
      pushItem(img, href, itemId);
    }

    if (items.length) addMediaItems(items);
  }

  function sweepScriptTags() {
    const items = [];
    const scripts = doc.querySelectorAll('script[type="application/json"]');
    for (const s of scripts) {
      if (sweptScripts.has(s)) continue;
      sweptScripts.add(s);
      const text = s.textContent;
      if (!text || !text.includes('fbcdn.net')) continue;
      try {
        const data = jsonParse(text);
        walkAndHarvest(data, items);
      } catch (e) {}
    }
    if (items.length) addMediaItems(items);
  }

  function resolveAvatarUrl() {
    if (isAllowedMediaUrl(state.targetAvatarUrl)) return state.targetAvatarUrl;
    const main = doc.querySelector('div[role="main"]') || doc.body;
    const images = main?.querySelectorAll?.('img, image') || [];
    const profileWords = /profile\s*(?:picture|photo|image)|foto\s*(?:de|do)\s*perfil|imagem\s*(?:de|do)\s*perfil|photo\s*de\s*profil|profil(?:bild|foto)|avatar/i;
    const identity = targetIdentity();
    let best = { score: 0, url: '' };

    for (const image of images) {
      const src = readImageSource(image);
      if (!src || !isAllowedMediaUrl(src) || /(?:emoji\.php|rsrc\.php)/i.test(src)) continue;

      let score = 0;
      const accessibleName = elementAccessibleText(image);
      if (profileWords.test(accessibleName)) score += 100;

      const profileLink = image.closest?.('a[href]')?.getAttribute?.('href') || '';
      if (profileLink && objectMatchesTarget({ url: profileLink }, identity)) score += 80;
      if ([...identity.names].some((name) => accessibleName.includes(name))) score += 45;

      try {
        if (image.closest?.('header, [role="banner"], [data-pagelet*="profile" i], [data-testid*="profile" i]')) score += 30;
      } catch (e) {}

      const rect = image.getBoundingClientRect?.();
      if (rect && rect.width > 0 && rect.height > 0) {
        const ratio = rect.width / rect.height;
        if (ratio >= 0.75 && ratio <= 1.25) score += 24;
        if (ratio > 1.5) score -= 35;
      }

      const clipPath = image.getAttribute?.('clip-path') || image.parentElement?.getAttribute?.('clip-path');
      if (clipPath) score += 25;
      try {
        const radius = getStyle ? getStyle(image).borderRadius : '';
        if (radius === '50%' || radius.includes('9999px')) score += 25;
      } catch (e) {}

      if (/\/v\/t[^/]+-1\//i.test(src)) score += 8;
      if (image.getAttribute?.('aria-hidden') === 'true') score -= 35;

      if (score > best.score) best = { score, url: src };
    }

    if (best.url && best.score >= 25) return rememberTargetAvatar(best.url);
    return fallbackIconUrl;
  }

  function getBaseProfileUrl(rawUrl = win.location?.href || '') {
    try {
      const origin = win.location?.origin || 'https://www.facebook.com';
      const u = new URL(rawUrl, origin);
      const id = u.searchParams.get('id');
      if (id) return `${origin}/profile.php?id=${id}`;
      const pathParts = u.pathname.split('/').filter(Boolean);
      const first = (pathParts[0] || '').toLowerCase();
      if (first === 'people') {
        if (pathParts[2] && /^\d+$/.test(pathParts[2])) return `${origin}/profile.php?id=${pathParts[2]}`;
        if (pathParts[1]) return `${origin}/people/${pathParts[1]}`;
      }
      if (first === 'pages' && pathParts[1]) {
        return pathParts[2] && /^\d+$/.test(pathParts[2])
          ? `${origin}/pages/${pathParts[1]}/${pathParts[2]}`
          : `${origin}/pages/${pathParts[1]}`;
      }
      if (pathParts.length > 0) {
        const slug = pathParts[0];
        if (!['photos', 'photos_by', 'photos_of', 'photos_albums', 'media', 'groups', 'watch', 'marketplace', 'home.php'].includes(slug.toLowerCase())) {
          return `${origin}/${slug}`;
        }
      }
      return origin;
    } catch (e) {
      return win.location?.origin || 'https://www.facebook.com';
    }
  }

  function buildSubtabUrl(baseProfileUrl, subtab) {
    if (!baseProfileUrl) return '';
    if (baseProfileUrl.includes('profile.php?id=')) return `${baseProfileUrl}&sk=${subtab}`;
    return `${baseProfileUrl.replace(/\/$/, '')}/${subtab}`;
  }

  function getCanonicalTabKey(elOrUrl) {
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

  function clickElement(el) {
    if (!el) return;
    try { el.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); } catch (e) {}
    const target = el.querySelector('span') || el.querySelector('div') || el;
    try {
      const rect = target.getBoundingClientRect();
      const baseEventInit = {
        bubbles: true,
        cancelable: true,
        composed: true,
        view: win,
        clientX: rect.left + rect.width / 2,
        clientY: rect.top + rect.height / 2,
        button: 0,
        buttons: 1
      };
      const pointerInit = { ...baseEventInit, pointerId: 1, pointerType: 'mouse', isPrimary: true, pressure: 0.5 };
      target.dispatchEvent(new PointerEventCtor('pointerover', pointerInit));
      target.dispatchEvent(new PointerEventCtor('pointerenter', pointerInit));
      target.dispatchEvent(new PointerEventCtor('pointerdown', pointerInit));
      target.dispatchEvent(new MouseEventCtor('mousedown', baseEventInit));
      target.dispatchEvent(new PointerEventCtor('pointerup', { ...pointerInit, buttons: 0, pressure: 0 }));
      target.dispatchEvent(new MouseEventCtor('mouseup', { ...baseEventInit, buttons: 0 }));
      target.dispatchEvent(new MouseEventCtor('click', { ...baseEventInit, buttons: 0 }));
    } catch (e) {
      try { target.click(); } catch (err) {}
    }
  }

  async function tryDomTabNavigation(el, tKey) {
    if (!el) return false;
    const beforeKey = navTracker.currentNavigationKey();
    const preventNativeNavigation = (event) => event.preventDefault();
    try { el.addEventListener?.('click', preventNativeNavigation, true); } catch (e) {}
    try {
      clickElement(el);
    } finally {
      try { el.removeEventListener?.('click', preventNativeNavigation, true); } catch (e) {}
    }
    await new Promise((r) => setTimer(r, 150));
    return navTracker.currentNavigationKey() !== beforeKey || getCanonicalTabKey(win.location?.href) === tKey;
  }

  async function scrollCurrentTab() {
    let lastMediaCount = state.media.size;
    let unchangedRounds = 0;
    let stalledScrollRounds = 0;
    const maxSteps = 400;

    win.scrollTo({ top: 0, behavior: 'instant' });
    await new Promise((r) => setTimer(r, 200));

    sweepScriptTags();
    harvestDomPhotos();

    for (let i = 0; i < maxSteps; i++) {
      if (!state.isScanning) break;

      const prevScrollY = win.scrollY;
      const scrollStep = Math.min(Math.round((win.innerHeight || 900) * 0.8), 650);
      win.scrollBy({ top: scrollStep, behavior: 'instant' });

      try {
        win.dispatchEvent(new EventCtor('scroll', { bubbles: true }));
      } catch (e) {}

      const main = doc.querySelector('div[role="main"]') || doc.body;
      const actionButtons = main?.querySelectorAll('[role="button"]') || [];
      for (const btn of actionButtons) {
        const text = (btn.textContent || '').trim().toLowerCase();
        if (text === 'carregar mais fotos' || text === 'carregar mais' || text === 'ver mais' || text === 'tentar novamente' || text === 'load more' || text === 'see more' || text === 'retry') {
          clickElement(btn);
          break;
        }
      }

      const isLoading = !!main?.querySelector('[role="progressbar"], div[data-visualcompletion="loading-state"]');
      const waitTime = isLoading ? 700 : 400;
      await new Promise((r) => setTimer(r, waitTime));

      sweepScriptTags();
      harvestDomPhotos();

      const count = state.media.size;
      const currentScrollY = win.scrollY;
      const didNotScroll = Math.abs(currentScrollY - prevScrollY) < 5;

      if (count > lastMediaCount) {
        lastMediaCount = count;
        unchangedRounds = 0;
        stalledScrollRounds = 0;
      } else {
        if (didNotScroll) {
          stalledScrollRounds++;
          if (stalledScrollRounds >= 3 && !isLoading) break;
        } else {
          stalledScrollRounds = 0;
        }

        unchangedRounds++;
        if (unchangedRounds >= 8 && !isLoading) break;
        if (unchangedRounds >= 15) break;
      }
    }
  }

  function findAlbumLinks() {
    const main = doc.querySelector('div[role="main"]') || doc.body;
    const links = main?.querySelectorAll('a[href*="/media/set/"], a[href*="/albums/"]') || [];
    const albumList = [];
    const seenSets = new Set();

    for (const rawLink of links) {
      const link = /** @type {HTMLAnchorElement} */ (rawLink);
      const href = link.getAttribute('href') || link.href || '';
      if (!href) continue;
      if (href.includes('/places/') || href.includes('/reviews/') || href.includes('checkin')) continue;

      const setMatch = href.match(/[?&]set=([a-z0-9._]+)/i) || href.match(/\/albums\/(\d+)/i);
      const setKey = setMatch ? setMatch[1] : href;
      if (!seenSets.has(setKey)) {
        seenSets.add(setKey);
        const albumName = (link.innerText || link.textContent || '').trim().split('\n')[0] || `Album ${setKey}`;
        const targetUrl = new URL(href, win.location?.origin || 'https://www.facebook.com').href;
        albumList.push({
          key: `album_${setKey}`,
          url: targetUrl,
          label: albumName
        });
      }
    }
    return albumList;
  }

  async function navigateToTab(tKey, targetUrl, label = '') {
    if (!state.isScanning) return;
    overlay.updateScanStatusUI(true, `${label || tKey}...`);
    const scanTarget = targetKey(targetUrl) || scanTargetKey;
    scanTargetKey = scanTarget;
    lastTargetKey = scanTarget || lastTargetKey;

    const currentKey = getCanonicalTabKey(win.location?.href);
    if (currentKey !== tKey) {
      win.scrollTo({ top: 0, behavior: 'instant' });
      await new Promise((r) => setTimer(r, 200));

      let routed = false;
      const domLink = doc.querySelector(
        `a[href*="/${tKey}"], a[href*="sk=${tKey}"], div[role="tablist"] a[href*="${tKey}"]`
      );
      if (domLink) {
        domLink.scrollIntoView({ behavior: 'instant', block: 'center' });
        await new Promise((r) => setTimer(r, 100));
        routed = await tryDomTabNavigation(domLink, tKey);
      } else {
        const allTabs = Array.from(doc.querySelectorAll('a[role="tab"], div[role="tablist"] a, div[role="tablist"] [role="tab"], div[role="tablist"] div[role="button"]'));
        for (const tabEl of allTabs) {
          if (getCanonicalTabKey(tabEl) === tKey) {
            tabEl.scrollIntoView({ behavior: 'instant', block: 'center' });
            await new Promise((r) => setTimer(r, 100));
            routed = await tryDomTabNavigation(tabEl, tKey);
            break;
          }
        }
      }

      if (!routed && targetUrl) {
        try {
          const res = await bridge.send('NAVIGATE_FB_TAB', { href: targetUrl });
          if (res && res.success && res.payload && res.payload.navigated) routed = true;
        } catch (e) {}
      }

      if (!routed && targetUrl) {
        try {
          const u = new URL(targetUrl, win.location?.origin || 'https://www.facebook.com');
          win.history.pushState(null, '', u.pathname + u.search);
          win.dispatchEvent(new PopStateEventCtor('popstate'));
        } catch (e) {}
      }

      await new Promise((r) => setTimer(r, 1500));
    }

    win.scrollTo({ top: 0, behavior: 'instant' });
    await new Promise((r) => setTimer(r, 200));
    await scrollCurrentTab();
  }

  async function scanAllTabs(isIndependent = true) {
    if (isIndependent && state.isScanning) return true;
    let failed = false;
    if (isIndependent) {
      state.isScanning = true;
      overlay.updateScanStatusUI(true, t('scanning'));
    }
    detectTarget();
    scanTargetKey = targetKey();
    if (scanTargetKey && !FacebookDetector.isGenericTerm(state.targetName)) {
      displayName = state.targetName;
      displayNameTarget = scanTargetKey;
    }
    try {
      const visitedTabKeys = new Set();
      const baseProfileUrl = getBaseProfileUrl();

      const primaryTabs = [
        { key: 'photos_of', label: t('tabPhotosOf'), subtab: 'photos_of' },
        { key: 'photos_by', label: t('tabPhotosBy') || t('tabPhotos'), subtab: 'photos_by' },
        { key: 'photos_albums', label: t('tabAlbums'), subtab: 'photos_albums' }
      ];

      for (const tab of primaryTabs) {
        if (!state.isScanning) break;
        visitedTabKeys.add(tab.key);
        const targetUrl = buildSubtabUrl(baseProfileUrl, tab.subtab);
        await navigateToTab(tab.key, targetUrl, tab.label);
      }

      if (state.isScanning) {
        const albums = findAlbumLinks();
        for (const album of albums) {
          if (!state.isScanning) break;
          if (visitedTabKeys.has(album.key)) continue;
          visitedTabKeys.add(album.key);
          await navigateToTab(album.key, album.url, album.label);
        }
      }

      win.scrollTo({ top: 0, behavior: 'smooth' });
      return true;
    } catch (e) {
      failed = true;
      log?.warn?.('[SMD Content] Facebook multi-tab scan failed:', e);
      overlay.updateScanStatusUI(true, t('scanFailed'), true);
      return false;
    } finally {
      scanTargetKey = '';
      if (isIndependent) {
        state.isScanning = false;
        if (!failed) overlay.updateScanStatusUI(false);
        else overlay.setScanActionButtonsDisabled(false);
      }
    }
  }

  function scanCurrentPage() {
    let failed = false;
    try {
      state.isScanning = true;
      overlay.updateScanStatusUI(true, t('scanning'));
      sweepScriptTags();
      harvestDomPhotos();
    } catch (e) {
      failed = true;
      log?.warn?.('[SMD Content] Facebook current page scan failed:', e);
      overlay.updateScanStatusUI(true, t('scanFailed'), true);
    } finally {
      state.isScanning = false;
      if (!failed) overlay.updateScanStatusUI(false);
      else overlay.setScanActionButtonsDisabled(false);
    }
  }

  function scheduleAvatarRefresh() {
    if (!isExtensionContextValid()) return;
    for (const delay of [250, 1000, 2500]) {
      setTimer(() => {
        if (isExtensionContextValid()) overlay.updateAvatarUI();
      }, delay);
    }
  }

  return {
    id: 'facebook',
    uiConfig: FACEBOOK_UI_CONFIG,
    isDownscaledUrl: (url) => MetaCdn.isDownscaledRender(url),
    detectTarget,
    init() {
      // Handshake with main-world script so buffered pre-handshake GraphQL batches flush.
      setTimer(() => bridge.send('PING').catch(() => {}), 0);
      sweepScriptTags();
      harvestDomPhotos();
      scheduleAvatarRefresh();
    },
    resolveAvatarUrl,
    scanAll: () => scanAllTabs(true),
    runAction(action) {
      if (action === 'fb_page') {
        scanCurrentPage();
        return Promise.resolve(true);
      }
      if (action === 'fb_tabs') return scanAllTabs(true);
      return Promise.resolve(false);
    },
    cancelScan() {
      state.isScanning = false;
      overlay.updateScanStatusUI(false);
    },
    onBridgeMessage(data) {
      const { source, payload } = data;
      if (source === 'SMD_FB_NAVIGATION_CHANGED') {
        setTimer(navTracker.check, 10);
        return;
      }
      if (source === 'SMD_FB_BATCH_PHOTOS' && payload?.text) {
        navTracker.check();
        processGraphQLText(payload.text);
      }
    },
    onNavigation() {
      const previousTarget = lastTargetKey || scanTargetKey || targetKey();
      detectTarget();
      const nextTarget = targetKey();
      lastTargetKey = nextTarget || previousTarget;
      const changedProfile = previousTarget !== nextTarget;
      if (changedProfile && !state.isScanning) resetState('target changed');
      scheduleAvatarRefresh();
    },
    handleMessage(type, sendResponse) {
      if (type === 'TRIGGER_SCAN_PAGE') {
        scanCurrentPage();
        sendResponse({ success: true, count: state.media.size });
        return true;
      }
      return false;
    }
  };
}

export const uiConfig = FACEBOOK_UI_CONFIG;
export const createController = createFacebookContentController;
