/**
 * Social Media Downloader — Facebook Media Normalizer
 * Traverses Facebook Comet GraphQL structures and extracts uncropped high-resolution photo items.
 */
import { MediaItemModel } from '../../core/domain/MediaItem.js';
import { MetaCdn } from '../meta-shared/MetaCdn.js';
import { MetaNode } from '../meta-shared/MetaNode.js';

export class FacebookNormalizer {
  /**
   * Selects the highest-resolution render available for a Photo node.
   *
   * Facebook delivers several signed CDN renders of the same photo:
   * `viewer_image` (the on-screen render, often downscaled to fit a container),
   * `image` (frequently the original/full render), `thumbnail_image` (small), and
   * sometimes an `images[]` array of explicit resolutions. Signed URLs carry an HMAC
   * over their params (oh/_nc_*), so a downscaled `ctp` can NEVER be upgraded by
   * rewriting the URL — doing so yields HTTP 403. The only safe way to get max
   * resolution is to pick the already-signed URL of the largest render the payload
   * provides (see AGENTS.md §49 / MetaCdn upgradeUrl contract).
   *
   * @param {any} photo
   * @returns {{ uri: string, width: number, height: number } | null}
   */
  static selectBestRender(photo) {
    /** @type {Array<{ uri: string, width: number, height: number }>} */
    const candidates = [];
    for (const field of ['viewer_image', 'image']) {
      const v = photo[field];
      if (v && v.uri && /fbcdn\.net/i.test(v.uri)) {
        candidates.push({ uri: v.uri, width: Number(v.width) || 0, height: Number(v.height) || 0 });
      }
    }
    if (Array.isArray(photo.images)) {
      for (const im of photo.images) {
        if (im && im.uri && /fbcdn\.net/i.test(im.uri)) {
          candidates.push({ uri: im.uri, width: Number(im.width) || 0, height: Number(im.height) || 0 });
        }
      }
    }
    if (candidates.length === 0) return null;

    // Primary metric: cstp = the maximum render the CDN guarantees for this
    // image. Prefer it because (a) it's the canonical size, (b) it survives
    // when the same image is offered with multiple thumbnails. Fallback to
    // the object's width*height when cstp is absent (bare image.url etc.).
    const renderArea = (/** @type {{ uri: string, width: number, height: number }} */ c) => {
      const m = /[?&]cstp=(?:mx?|s)?(\d+)x(\d+)/i.exec(c.uri) || /[?&]cstp=(?:mx?|s)?(\d+)/i.exec(c.uri);
      return m ? Number(m[1]) * Number(m[2] || m[1]) : (c.width * c.height);
    };
    // Tiebreak: when cstp ties, prefer the URL whose ctp equals its cstp
    // (the already-signed full render) over a downscaled sibling.
    const isFullCtp = (/** @type {string} */ uri) => {
      const ctp = /[?&]ctp=s?(\d+)x(\d+)/i.exec(uri);
      const cstp = /[?&]cstp=(?:mx?|s)?(\d+)x(\d+)/i.exec(uri) || /[?&]cstp=(?:mx?|s)?(\d+)/i.exec(uri);
      if (!ctp || !cstp) return false;
      return Number(ctp[1]) * Number(ctp[2]) >= Number(cstp[1]) * Number(cstp[2] || cstp[1]);
    };

    let best = candidates[0];
    for (const c of candidates) {
      const area = renderArea(c);
      const bestArea = renderArea(best);
      const beats = area > bestArea ||
        (area === bestArea && isFullCtp(c.uri) && !isFullCtp(best.uri));
      if (beats) best = c;
    }
    return best;
  }

  /**
   * Normalizes a single photo object from Comet GraphQL node.
   * @param {any} edgeOrNode
   * @returns {import('../../core/domain/MediaItem.js').MediaItem | null}
   */
  static normalizePhoto(edgeOrNode) {
    if (!edgeOrNode) return null;
    const item = edgeOrNode.node || edgeOrNode;
    const photo = (item.node && item.node.__typename === 'Photo') ? item.node : item;

    const id = photo.id || photo.photo_id;

    const selected = FacebookNormalizer.selectBestRender(photo);
    let highResUrl;
    let width = 0;
    let height = 0;
    if (selected) {
      highResUrl = selected.uri;
      width = selected.width;
      height = selected.height;
    } else if (photo.url && /fbcdn\.net/i.test(photo.url)) {
      highResUrl = photo.url;
    }

    if (!highResUrl) return null;

    const cleanUrl = MetaCdn.upgradeUrl(highResUrl, 'facebook');

    return MediaItemModel.create({
      id: String(id || `fb_${Math.random().toString(36).slice(2, 9)}`),
      platform: 'facebook',
      type: 'image',
      sourceType: 'facebook_photo',
      url: cleanUrl,
      downloadUrl: cleanUrl,
      thumbnailUrl: cleanUrl,
      width: width || undefined,
      height: height || undefined,
      metadata: {
        photoId: id,
        category: 'facebook_album'
      }
    });
  }

  /**
   * Recursively walks Facebook GraphQL payload to extract all photo items.
   * @param {any} root
   * @returns {import('../../core/domain/MediaItem.js').MediaItem[]}
   */
  static extractPhotosFromGraphQL(root) {
    if (!root || typeof root !== 'object') return [];
    /** @type {Map<string, import('../../core/domain/MediaItem.js').MediaItem>} */
    const resultsMap = new Map();
    const visited = new Set();

    function walk(obj, depth = 0, videoAncestor = false) {
      // Full-size Photo nodes nest deep inside TimelineAppCollection tiles
      // (measured depth > 20 in 2026-08-28 captures); the content-script sweep
      // matches this cap at 40.
      if (!obj || typeof obj !== 'object' || depth > 40) return;
      if (visited.has(obj)) return;
      visited.add(obj);

      if (Array.isArray(obj)) {
        for (let i = 0; i < obj.length; i++) {
          walk(obj[i], depth + 1, videoAncestor);
        }
        return;
      }
      const hasCollectionTile = MetaNode.isCollectionTile(obj);
      // Reels / videos carry viewer_image (their cover thumbnail) and an images[] of
      // frame previews. Without this filter the walker would emit a photo MediaItem
      // for every Reel cover on the timeline — duplicated as "miniaturas".
      // Shared with the content-script walker via meta-shared/MetaNode so both
      // paths stay in sync.
      const isVideoNode = MetaNode.isVideoNode(obj);
      // Track whether ANY ancestor in the current recursion chain is a Video/Reel.
      // Reel sub-objects (media.preferred_thumbnail, media.image_preview_payload)
      // have `image.uri` + `id` but NO `playable_url` and NO `__typename: 'Video'`,
      // so the per-node check above misses them. Ancestor context catches every
      // descendant without an extra tag on the source payload.
      const inVideoSubtree = videoAncestor || isVideoNode;
      const isPhoto = (obj.__typename === 'Photo' || !!obj.viewer_image?.uri) && !hasCollectionTile && !inVideoSubtree;
      // Album-cover tiles (TimelineAppCollectionItem) carry image.uri + id + a page URL;
      // they must not be treated as photos (they would download HTML as .jpg).
      const hasImageWithId = !!(obj.image?.uri && (obj.id || obj.photo_id) && !obj.profile_picture) && !hasCollectionTile && !inVideoSubtree;

      if (isPhoto || hasImageWithId) {
        const item = FacebookNormalizer.normalizePhoto(obj);
        if (item && item.url) {
          const existing = resultsMap.get(item.id);
          const isHighRes = !!obj.viewer_image?.uri;
          const existingIsHighRes = existing ? !MetaCdn.isDownscaledRender(existing.downloadUrl) : false;
          if (!existing || (isHighRes && !existingIsHighRes) || ((item.width || 0) > (existing.width || 0))) {
            resultsMap.set(item.id, item);
          }
        }
      }

      if (obj.node && typeof obj.node === 'object') {
        walk(obj.node, depth + 1, inVideoSubtree);
      }

      const keys = Object.keys(obj);
      for (const key of keys) {
        if (key === 'extensions' || (key === 'viewer' && depth > 2)) continue;
        walk(obj[key], depth + 1, inVideoSubtree);
      }
    }

    walk(root);
    return Array.from(resultsMap.values());
  }
}
